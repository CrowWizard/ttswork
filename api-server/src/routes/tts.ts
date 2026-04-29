import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { Prisma, TtsJobStatus } from "@prisma/client";
import type { AppConfig } from "../lib/config";
import { requireCurrentUser, resolveAnonymousUser } from "../lib/auth";
import { errorResponse } from "../lib/http";
import { buildErrorLogContext, loggerError } from "../lib/logger";
import { uploadBuffer } from "../lib/minio";
import { prisma } from "../lib/prisma";
import { synthesizePureSpeech, synthesizeSceneSpeech } from "../lib/qwen";
import { getTtsScene, listTtsScenes } from "../lib/scene";
import { normalizeUsageCodeInput } from "../lib/usage-code";
import { ttsRequestSchema } from "../lib/validation";

function getRequestId(c: Context) {
  return (c as Context & { get: (key: string) => unknown }).get("requestId") as string | undefined;
}

export function createTtsRoutes(cfg: AppConfig) {
  const tts = new Hono();

  const TTS_HISTORY_LIMIT = 3;
  const FREE_TTS_TEXT_LIMIT = 30;
  const USAGE_CODE_MODULE = "VOICE_TO_TEXT";
  const generalUsageCode = normalizeUsageCodeInput(cfg.usageCode.generalCode);

  tts.get("/scenes", async (c) => {
    return c.json(listTtsScenes());
  });

  tts.get("/usage", async (c) => {
    const currentUser = await requireCurrentUser(c, cfg);
    const anonymousUser = currentUser ? null : await resolveAnonymousUser(c, cfg, { createIfMissing: true });
    const freeTtsUsedAt = currentUser?.freeTtsUsedAt ?? anonymousUser?.freeTtsUsedAt ?? null;

    return c.json({
      isAuthenticated: Boolean(currentUser),
      freeTtsUsedAt,
      freeUsesRemaining: freeTtsUsedAt ? 0 : 1,
      requiresLoginForNextUse: !currentUser && Boolean(freeTtsUsedAt),
      requiresUsageCode: Boolean(currentUser && freeTtsUsedAt),
      usageCodeModule: currentUser && freeTtsUsedAt ? USAGE_CODE_MODULE : null,
    });
  });

  tts.get("/", async (c) => {
    const currentUser = await requireCurrentUser(c, cfg);
    const anonymousUser = currentUser ? null : await resolveAnonymousUser(c, cfg, { createIfMissing: true });

    if (!currentUser && !anonymousUser) {
      return c.json([]);
    }

    const jobs = await prisma.ttsJob.findMany({
      where: currentUser
        ? { userId: currentUser.id, status: TtsJobStatus.READY }
        : { anonymousUserId: anonymousUser?.id, status: TtsJobStatus.READY },
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

  class ActiveVoiceUnavailableError extends Error {}
  class ActiveVoiceChangedError extends Error {}

  tts.post("/", async (c) => {
    const currentUser = await requireCurrentUser(c, cfg);
    const anonymousUser = currentUser ? null : await resolveAnonymousUser(c, cfg, { createIfMissing: true });
    const ownerId = currentUser?.id ?? anonymousUser?.id;

    const body = await c.req.json().catch(() => null);
    const parsedBody = ttsRequestSchema.safeParse(body);

    if (!parsedBody.success) {
      return errorResponse(c, parsedBody.error.issues[0]?.message ?? "请求参数无效");
    }

    if (!ownerId) {
      return errorResponse(c, "无法建立匿名会话", 500);
    }

    let job;

    try {
      job = await prisma.$transaction(
        async (tx) => {
          const scene = parsedBody.data.profileKind === "SCENE" ? getTtsScene(parsedBody.data.sceneKey) : null;
          const activeVoiceEnrollmentId = currentUser
            ? parsedBody.data.profileKind === "PURE"
              ? (
                  await tx.user.findUnique({
                    where: { id: currentUser.id },
                    select: { activePureVoiceEnrollmentId: true },
                  })
                )?.activePureVoiceEnrollmentId
              : (
                  await tx.user.findUnique({
                    where: { id: currentUser.id },
                    select: { activeSceneVoiceEnrollmentId: true },
                  })
                )?.activeSceneVoiceEnrollmentId
            : parsedBody.data.profileKind === "PURE"
              ? anonymousUser?.activePureVoiceEnrollmentId
              : anonymousUser?.activeSceneVoiceEnrollmentId;

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

          if (currentUser && activeVoice.userId !== currentUser.id) {
            throw new ActiveVoiceChangedError("当前 active voice 已发生变化，请重试");
          }

          if (anonymousUser && activeVoice.anonymousUserId !== anonymousUser.id) {
            throw new ActiveVoiceChangedError("当前 active voice 已发生变化，请重试");
          }

          const now = new Date();
          const usageCodeInput = parsedBody.data.usageCode;
          const isGeneralUsageCode = Boolean(
            currentUser && usageCodeInput && usageCodeInput === generalUsageCode,
          );
          let accessKind: "FREE_TRIAL" | "GENERAL_USAGE_CODE" | "USAGE_CODE" = "FREE_TRIAL";
          let usageCodeId: string | null = null;
          let usageCodeValue: string | null = null;

          if (!currentUser) {
            if (usageCodeInput) {
              throw new ActiveVoiceUnavailableError("匿名用户不能使用使用码，请先登录");
            }

            if (parsedBody.data.text.length > FREE_TTS_TEXT_LIMIT) {
              throw new ActiveVoiceUnavailableError(`文本长度不能超过 ${FREE_TTS_TEXT_LIMIT} 字`);
            }

            const freshAnonymousUser = await tx.anonymousUser.findUnique({
              where: { id: anonymousUser?.id ?? "" },
              select: { freeTtsUsedAt: true },
            });

            if (freshAnonymousUser?.freeTtsUsedAt) {
              throw new ActiveVoiceUnavailableError("免费次数已用完，请先登录后继续使用");
            }

            await tx.anonymousUser.update({
              where: { id: anonymousUser!.id },
              data: { freeTtsUsedAt: now },
            });
          } else if (isGeneralUsageCode) {
            accessKind = "GENERAL_USAGE_CODE";
            usageCodeValue = usageCodeInput ?? null;
          } else if (usageCodeInput) {
            const usageCode = await tx.usageCode.findFirst({
              where: {
                code: usageCodeInput,
                module: USAGE_CODE_MODULE,
                consumedAt: null,
              },
              select: { id: true },
            });

            if (!usageCode) {
              throw new ActiveVoiceUnavailableError("使用码无效或已使用");
            }

            accessKind = "USAGE_CODE";
            usageCodeId = usageCode.id;
            usageCodeValue = usageCodeInput ?? null;
          } else {
            if (parsedBody.data.text.length > FREE_TTS_TEXT_LIMIT) {
              throw new ActiveVoiceUnavailableError(`文本长度不能超过 ${FREE_TTS_TEXT_LIMIT} 字`);
            }

            const freshUser = await tx.user.findUnique({
              where: { id: currentUser.id },
              select: { freeTtsUsedAt: true },
            });

            if (freshUser?.freeTtsUsedAt) {
              throw new ActiveVoiceUnavailableError("免费次数已用完，请输入使用码继续生成");
            }

            await tx.user.update({
              where: { id: currentUser.id },
              data: { freeTtsUsedAt: now },
            });
          }

          const createdJob = await tx.ttsJob.create({
            data: {
              userId: currentUser?.id,
              anonymousUserId: anonymousUser?.id,
              voiceEnrollmentId: activeVoice.id,
              profileKind: parsedBody.data.profileKind,
              accessKind,
              usageCodeId,
              usageCodeModule: accessKind === "FREE_TRIAL" ? null : USAGE_CODE_MODULE,
              usageCodeValue,
              voiceIdSnapshot: activeVoice.voiceId,
              text: parsedBody.data.text,
              sceneKey: parsedBody.data.sceneKey,
              instruction: parsedBody.data.instruction,
              status: TtsJobStatus.PENDING,
            },
          });

          if (usageCodeId) {
            const consumed = await tx.usageCode.updateMany({
              where: {
                id: usageCodeId,
                consumedAt: null,
              },
              data: {
                consumedAt: now,
                consumedByUserId: currentUser!.id,
                consumedTtsJobId: createdJob.id,
              },
            });

            if (consumed.count !== 1) {
              throw new ActiveVoiceUnavailableError("使用码无效或已使用");
            }
          }

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
        ownerId,
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
      const outputObjectKey = `tts/${ownerId}/${Date.now()}-${randomUUID()}.${extension}`;
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
        ownerId,
        profileKind: job.profileKind,
        sceneKey: job.sceneKey,
        synthesizeMode: job.profileKind === "PURE" ? "pure-direct-tts" : "scene-instruction-tts",
        voiceIdSnapshot: job.voiceIdSnapshot,
        textLength: job.text.length,
        ...buildErrorLogContext(error),
      });

      await prisma.ttsJob.update({
        where: { id: job.id },
        data: {
          status: TtsJobStatus.FAILED,
          errorMessage: message,
        },
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
