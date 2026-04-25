import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { Prisma, TtsJobStatus } from "@prisma/client";
import type { AppConfig } from "../lib/config";
import { requireCurrentUser, resolveAnonymousUser } from "../lib/auth";
import { errorResponse } from "../lib/http";
import { uploadBuffer } from "../lib/minio";
import { prisma } from "../lib/prisma";
import { synthesizeSpeech } from "../lib/qwen";
import { ttsRequestSchema } from "../lib/validation";

export function createTtsRoutes(cfg: AppConfig) {
  const tts = new Hono();

  const TTS_HISTORY_LIMIT = 3;
  const ANONYMOUS_TTS_TEXT_LIMIT = 30;

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
      },
    });

    return c.json(
      jobs.map((job) => ({
        jobId: job.id,
        text: job.text,
        status: job.status,
        createdAt: job.createdAt,
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

    if (!currentUser) {
      if (parsedBody.data.text.length > ANONYMOUS_TTS_TEXT_LIMIT) {
        return errorResponse(c, `匿名免费语音最多支持 ${ANONYMOUS_TTS_TEXT_LIMIT} 字，请先登录`, 401);
      }
    }

    let job;

    try {
      job = await prisma.$transaction(
        async (tx) => {
          const activeVoiceEnrollmentId = currentUser
            ? (await tx.user.findUnique({ where: { id: currentUser.id } }))?.activeVoiceEnrollmentId
            : anonymousUser?.activeVoiceEnrollmentId;

          if (!currentUser && !activeVoiceEnrollmentId) {
            return tx.ttsJob.create({
              data: {
                anonymousUserId: anonymousUser?.id,
                voiceIdSnapshot: cfg.qwen.trialVoiceId,
                text: parsedBody.data.text,
                status: TtsJobStatus.PENDING,
              },
            });
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

          if (currentUser && activeVoice.userId !== currentUser.id) {
            throw new ActiveVoiceChangedError("当前 active voice 已发生变化，请重试");
          }

          if (anonymousUser && activeVoice.anonymousUserId !== anonymousUser.id) {
            throw new ActiveVoiceChangedError("当前 active voice 已发生变化，请重试");
          }

          return tx.ttsJob.create({
            data: {
              userId: currentUser?.id,
              anonymousUserId: anonymousUser?.id,
              voiceEnrollmentId: activeVoice.id,
              voiceIdSnapshot: activeVoice.voiceId,
              text: parsedBody.data.text,
              status: TtsJobStatus.PENDING,
            },
          });
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

      return errorResponse(c, "创建语音任务失败", 500);
    }

    try {
      const qwenResult = await synthesizeSpeech(cfg.qwen, {
        text: parsedBody.data.text,
        voiceId: job.voiceIdSnapshot,
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
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "语音合成失败";

      console.error("[Qwen tts] failed", error);

      await prisma.ttsJob.update({
        where: { id: job.id },
        data: {
          status: TtsJobStatus.FAILED,
          errorMessage: message,
        },
      });

      return errorResponse(c, "接口繁忙", 502);
    }
  });

  return tts;
}
