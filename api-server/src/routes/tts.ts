import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { Prisma, TtsJobStatus } from "@prisma/client";
import type { AppConfig } from "../lib/config";
import { errorResponse } from "../lib/http";
import { uploadBuffer } from "../lib/minio";
import { prisma } from "../lib/prisma";
import { ensureAnonymousUserCookie } from "../lib/session";
import { synthesizeSpeech } from "../lib/qwen";
import { ttsRequestSchema } from "../lib/validation";
import { ensureAnonymousUserRecord } from "../lib/user";

export function createTtsRoutes(cfg: AppConfig) {
  const tts = new Hono();

  const TTS_HISTORY_LIMIT = 3;

  tts.get("/", async (c) => {
    const userId = await ensureAnonymousUserCookie(c, cfg.cookie);
    await ensureAnonymousUserRecord(userId);

    const jobs = await prisma.ttsJob.findMany({
      where: { userId, status: TtsJobStatus.READY },
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
    const userId = await ensureAnonymousUserCookie(c, cfg.cookie);
    await ensureAnonymousUserRecord(userId);

    const body = await c.req.json().catch(() => null);
    const parsedBody = ttsRequestSchema.safeParse(body);

    if (!parsedBody.success) {
      return errorResponse(c, parsedBody.error.issues[0]?.message ?? "请求参数无效");
    }

    let job;

    try {
      job = await prisma.$transaction(
        async (tx) => {
          const user = await tx.anonymousUser.findUnique({
            where: { id: userId },
            include: { activeVoiceEnrollment: true },
          });

          const activeVoice = user?.activeVoiceEnrollment;

          if (!activeVoice || !activeVoice.voiceId || activeVoice.isInvalidated) {
            throw new ActiveVoiceUnavailableError("当前没有可用的 active voice");
          }

          if (user.activeVoiceEnrollmentId !== activeVoice.id) {
            throw new ActiveVoiceChangedError("当前 active voice 已发生变化，请重试");
          }

          return tx.ttsJob.create({
            data: {
              userId,
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
      const outputObjectKey = `tts/${userId}/${Date.now()}-${randomUUID()}.${extension}`;
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
