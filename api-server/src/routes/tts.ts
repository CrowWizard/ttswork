import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { Prisma, TtsJobStatus } from "@prisma/client";
import type { AppConfig } from "../lib/config";
import { requireCurrentUser } from "../lib/auth";
import { errorResponse } from "../lib/http";
import { buildErrorLogContext, loggerError } from "../lib/logger";
import { uploadBuffer } from "../lib/minio";
import { prisma } from "../lib/prisma";
import { synthesizePureSpeech, synthesizeSceneSpeech } from "../lib/qwen";
import { getTtsScene, listTtsScenes } from "../lib/scene";
import { normalizeUsageCodeInput } from "../lib/usage-code";
import { ttsRequestSchema, usageCodeRedeemRequestSchema } from "../lib/validation";

function getRequestId(c: Context) {
  return (c as Context & { get: (key: string) => unknown }).get("requestId") as string | undefined;
}

export function createTtsRoutes(cfg: AppConfig) {
  const tts = new Hono();

  const TTS_HISTORY_LIMIT = 3;
  const USAGE_CODE_MODULE = "VOICE_TO_TEXT";
  const TTS_COST_POINTS = 20;
  const USAGE_CODE_REDEEM_POINTS = 200;

  tts.get("/scenes", async (c) => {
    return c.json(listTtsScenes());
  });

  tts.get("/usage", async (c) => {
    const currentUser = await requireCurrentUser(c, cfg);

    return c.json({
      isAuthenticated: Boolean(currentUser),
      pointsBalance: currentUser?.pointsBalance ?? 0,
      ttsCostPoints: TTS_COST_POINTS,
      usageCodeRedeemPoints: USAGE_CODE_REDEEM_POINTS,
    });
  });

  class ActiveVoiceUnavailableError extends Error {}
  class ActiveVoiceChangedError extends Error {}

  tts.post("/usage/redeem", async (c) => {
    const currentUser = await requireCurrentUser(c, cfg);

    if (!currentUser) {
      return errorResponse(c, "请先登录后兑换积分", 401);
    }

    const body = await c.req.json().catch(() => null);
    const parsedBody = usageCodeRedeemRequestSchema.safeParse(body);

    if (!parsedBody.success) {
      return errorResponse(c, parsedBody.error.issues[0]?.message ?? "请求参数无效");
    }

    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const usageCodeValue = normalizeUsageCodeInput(parsedBody.data.usageCode);
          const usageCode = await tx.usageCode.findFirst({
            where: {
              code: usageCodeValue,
              module: USAGE_CODE_MODULE,
              consumedAt: null,
            },
            select: { id: true },
          });

          if (!usageCode) {
            throw new ActiveVoiceUnavailableError("使用码无效或已使用");
          }

          const consumed = await tx.usageCode.updateMany({
            where: { id: usageCode.id, consumedAt: null },
            data: {
              consumedAt: new Date(),
              consumedByUserId: currentUser.id,
            },
          });

          if (consumed.count !== 1) {
            throw new ActiveVoiceUnavailableError("使用码无效或已使用");
          }

          const updatedUser = await tx.user.update({
            where: { id: currentUser.id },
            data: { pointsBalance: { increment: USAGE_CODE_REDEEM_POINTS } },
            select: { pointsBalance: true },
          });

          await tx.pointTransaction.create({
            data: {
              userId: currentUser.id,
              type: "USAGE_CODE_REDEEM",
              delta: USAGE_CODE_REDEEM_POINTS,
              balanceAfter: updatedUser.pointsBalance,
              usageCodeId: usageCode.id,
            },
          });

          return { pointsBalance: updatedUser.pointsBalance };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      return c.json({
        ...result,
        redeemedPoints: USAGE_CODE_REDEEM_POINTS,
        ttsCostPoints: TTS_COST_POINTS,
      });
    } catch (error) {
      if (error instanceof ActiveVoiceUnavailableError) {
        return errorResponse(c, error.message, 400);
      }

      loggerError("tts_usage.redeem_failed", {
        requestId: getRequestId(c),
        userId: currentUser.id,
        ...buildErrorLogContext(error),
      });

      return errorResponse(c, "兑换失败，请稍后重试", 500);
    }
  });

  tts.get("/", async (c) => {
    const currentUser = await requireCurrentUser(c, cfg);

    if (!currentUser) {
      return c.json([]);
    }

    const jobs = await prisma.ttsJob.findMany({
      where: { userId: currentUser.id, status: TtsJobStatus.READY },
      orderBy: { createdAt: "desc" },
      take: TTS_HISTORY_LIMIT,
      select: {
        id: true,
        text: true,
        status: true,
        createdAt: true,
        profileKind: true,
        sceneKey: true,
        instruction: true,
        accessKind: true,
      },
    });

    return c.json(
      jobs.map((job) => ({
        jobId: job.id,
        text: job.text,
        status: job.status,
        createdAt: job.createdAt,
        profileKind: job.profileKind,
        sceneKey: job.sceneKey,
        instruction: job.instruction,
        accessKind: job.accessKind,
        downloadUrl: `/api/tts/${job.id}/download`,
      })),
    );
  });

  tts.post("/", async (c) => {
    const currentUser = await requireCurrentUser(c, cfg);

    const body = await c.req.json().catch(() => null);
    const parsedBody = ttsRequestSchema.safeParse(body);

    if (!parsedBody.success) {
      return errorResponse(c, parsedBody.error.issues[0]?.message ?? "请求参数无效");
    }

    if (!currentUser) {
      return errorResponse(c, "请先登录后使用积分生成", 401);
    }

    let job;

    try {
      job = await prisma.$transaction(
        async (tx) => {
          const scene = parsedBody.data.profileKind === "SCENE" ? getTtsScene(parsedBody.data.sceneKey) : null;
          const voiceProfile = await tx.voiceProfile.findFirst({
            where: { userId: currentUser.id },
          });
          const activeVoiceEnrollmentId = parsedBody.data.profileKind === "PURE"
            ? voiceProfile?.activePureVoiceEnrollmentId
            : voiceProfile?.activeSceneVoiceEnrollmentId;

          if (parsedBody.data.profileKind === "SCENE" && !scene) {
            throw new ActiveVoiceUnavailableError("请选择有效场景后再合成");
          }

          if (!activeVoiceEnrollmentId) {
            throw new ActiveVoiceUnavailableError("当前没有可用的 active voice");
          }

          const activeVoice = await tx.voiceEnrollment.findUnique({
            where: { id: activeVoiceEnrollmentId },
          });

          if (!activeVoice || !activeVoice.voiceId || activeVoice.isInvalidated) {
            throw new ActiveVoiceUnavailableError("当前没有可用的 active voice");
          }

          if (activeVoice.profileKind !== parsedBody.data.profileKind) {
            throw new ActiveVoiceChangedError("所选声纹类型已发生变化，请重试");
          }

          if (activeVoice.userId !== currentUser.id) {
            throw new ActiveVoiceChangedError("当前 active voice 已发生变化，请重试");
          }

          const charged = await tx.user.updateMany({
            where: {
              id: currentUser.id,
              pointsBalance: { gte: TTS_COST_POINTS },
            },
            data: { pointsBalance: { decrement: TTS_COST_POINTS } },
          });

          if (charged.count !== 1) {
            throw new ActiveVoiceUnavailableError("积分余额不足，请先兑换积分");
          }

          const chargedUser = await tx.user.findUniqueOrThrow({
            where: { id: currentUser.id },
            select: { pointsBalance: true },
          });

          const createdJob = await tx.ttsJob.create({
            data: {
              userId: currentUser.id,
              anonymousUserId: null,
              voiceEnrollmentId: activeVoice.id,
              profileKind: parsedBody.data.profileKind,
              accessKind: "POINTS",
              usageCodeId: null,
              usageCodeModule: null,
              usageCodeValue: null,
              voiceIdSnapshot: activeVoice.voiceId,
              text: parsedBody.data.text,
              sceneKey: parsedBody.data.sceneKey,
              instruction: parsedBody.data.instruction,
              status: TtsJobStatus.PENDING,
            },
          });

          await tx.pointTransaction.create({
            data: {
              userId: currentUser.id,
              type: "TTS_CONSUME",
              delta: -TTS_COST_POINTS,
              balanceAfter: chargedUser.pointsBalance,
              ttsJobId: createdJob.id,
            },
          });

          return createdJob;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof ActiveVoiceUnavailableError) {
        return errorResponse(c, error.message, 400);
      }

      if (error instanceof ActiveVoiceChangedError) {
        return errorResponse(c, error.message, 409);
      }

      loggerError("tts_job.create_failed", {
        requestId: getRequestId(c),
        ownerId: currentUser.id,
        profileKind: parsedBody.data.profileKind,
        sceneKey: parsedBody.data.sceneKey,
        textLength: parsedBody.data.text.length,
        ...buildErrorLogContext(error),
      });

      return errorResponse(c, error instanceof Error ? error.message : "创建语音任务失败", 500);
    }

    try {
      const qwenResult = job.profileKind === "PURE"
        ? await synthesizePureSpeech(cfg.qwen, {
            text: parsedBody.data.text,
            voiceId: job.voiceIdSnapshot,
          })
        : await synthesizeSceneSpeech(cfg.qwen, {
            text: parsedBody.data.text,
            voiceId: job.voiceIdSnapshot,
            instruction: job.instruction ?? undefined,
          });

      const extension = qwenResult.extension || "wav";
      const outputObjectKey = `tts/${currentUser.id}/${Date.now()}-${randomUUID()}.${extension}`;
      const storedOutput = await uploadBuffer(cfg.minio, {
        objectKey: outputObjectKey,
        buffer: qwenResult.audioBuffer,
        contentType: qwenResult.contentType,
      });

      const updated = await prisma.ttsJob.update({
        where: { id: job.id },
        data: {
          status: TtsJobStatus.READY,
          outputContentType: qwenResult.contentType,
          bucket: storedOutput.bucket,
          objectKey: storedOutput.objectKey,
          minioUri: storedOutput.minioUri,
          errorMessage: null,
        },
      });

      return c.json({
        jobId: updated.id,
        status: updated.status,
        downloadUrl: `/api/tts/${updated.id}/download`,
        voiceIdSnapshot: updated.voiceIdSnapshot,
        profileKind: updated.profileKind,
        sceneKey: updated.sceneKey,
        instruction: updated.instruction,
        accessKind: updated.accessKind,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "语音合成失败";

      loggerError("tts_job.qwen_failed", {
        requestId: getRequestId(c),
        jobId: job.id,
        ownerId: currentUser.id,
        profileKind: job.profileKind,
        sceneKey: job.sceneKey,
        synthesizeMode: job.profileKind === "PURE" ? "pure-direct-tts" : "scene-instruction-tts",
        voiceIdSnapshot: job.voiceIdSnapshot,
        textLength: job.text.length,
        ...buildErrorLogContext(error),
      });

      await prisma.$transaction(async (tx) => {
        await tx.ttsJob.update({
          where: { id: job.id },
          data: {
            status: TtsJobStatus.FAILED,
            errorMessage: message,
          },
        });

        const refundedUser = await tx.user.update({
          where: { id: currentUser.id },
          data: { pointsBalance: { increment: TTS_COST_POINTS } },
          select: { pointsBalance: true },
        });

        await tx.pointTransaction.create({
          data: {
            userId: currentUser.id,
            type: "TTS_CONSUME",
            delta: TTS_COST_POINTS,
            balanceAfter: refundedUser.pointsBalance,
            ttsJobId: job.id,
          },
        });
      });

      return errorResponse(c, message, 502, {
        details: {
          jobId: job.id,
          profileKind: job.profileKind,
          sceneKey: job.sceneKey,
        },
      });
    }
  });

  return tts;
}
