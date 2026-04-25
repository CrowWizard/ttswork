import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { EnrollmentStatus } from "@prisma/client";
import type { AppConfig } from "../lib/config";
import { isRecordDurationAccepted } from "../lib/audio";
import { getAudioExtension, isSupportedAudioMimeType, normalizeSupportedAudioMimeType } from "../lib/audio-format";
import { errorResponse } from "../lib/http";
import { INPUT_AUDIO_FIELD, MIN_RECORD_SECONDS, RECORD_DURATION_SECONDS_FIELD } from "../lib/constants";
import { uploadBuffer } from "../lib/minio";
import { prisma } from "../lib/prisma";
import { enrollVoice } from "../lib/qwen";
import { ensureAnonymousUserCookie } from "../lib/session";
import { ensureAnonymousUserRecord } from "../lib/user";

export function createVoiceEnrollRoutes(cfg: AppConfig) {
  const voiceEnroll = new Hono();

  voiceEnroll.post("/", async (c) => {
    const userId = await ensureAnonymousUserCookie(c, cfg.cookie);
    await ensureAnonymousUserRecord(userId);

    const formData = await c.req.formData();
    const audioFile = formData.get(INPUT_AUDIO_FIELD);
    const recordDurationValue = formData.get(RECORD_DURATION_SECONDS_FIELD);

    if (!(audioFile instanceof File)) {
      return errorResponse(c, "缺少录音文件");
    }

    if (typeof recordDurationValue !== "string") {
      return errorResponse(c, "缺少录音时长");
    }

    const rawMimeType = audioFile.type || "application/octet-stream";
    const mimeType = normalizeSupportedAudioMimeType(rawMimeType);

    console.info("[voice enroll] received file", {
      userId,
      name: audioFile.name,
      type: audioFile.type,
      normalizedMimeType: mimeType,
      size: audioFile.size,
      recordDurationValue,
    });

    if (!isSupportedAudioMimeType(rawMimeType)) {
      console.warn("[voice enroll] unsupported mime type", {
        userId,
        name: audioFile.name,
        type: audioFile.type,
        normalizedMimeType: mimeType,
        size: audioFile.size,
      });

      return errorResponse(c, "录音格式仅支持 WAV、MP3、M4A", 400);
    }

    const audioBuffer = Buffer.from(await audioFile.arrayBuffer());
    const durationSeconds = Number(recordDurationValue);

    if (!isRecordDurationAccepted(durationSeconds)) {
      return errorResponse(c, `录音时长必须不少于 ${MIN_RECORD_SECONDS} 秒`, 400);
    }

    const extension = getAudioExtension(mimeType);
    const inputObjectKey = `voices/${userId}/${Date.now()}-${randomUUID()}.${extension}`;
    const storedInput = await uploadBuffer(cfg.minio, {
      objectKey: inputObjectKey,
      buffer: audioBuffer,
      contentType: mimeType,
    });

    const enrollment = await prisma.voiceEnrollment.create({
      data: {
        userId,
        status: EnrollmentStatus.PENDING,
        durationSeconds,
        originalFilename: audioFile.name,
        inputContentType: mimeType,
        bucket: storedInput.bucket,
        objectKey: storedInput.objectKey,
        minioUri: storedInput.minioUri,
      },
    });

    try {
      const qwenResult = await enrollVoice(cfg.qwen, { audioBuffer, mimeType });

      const updated = await prisma.$transaction(async (tx) => {
        const readyEnrollment = await tx.voiceEnrollment.update({
          where: { id: enrollment.id },
          data: {
            status: EnrollmentStatus.READY,
            voiceId: qwenResult.voiceId,
            errorMessage: null,
          },
        });

        await tx.anonymousUser.update({
          where: { id: userId },
          data: {
            activeVoiceEnrollmentId: readyEnrollment.id,
          },
        });

        return readyEnrollment;
      });

      return c.json({
        enrollmentId: updated.id,
        voiceId: updated.voiceId,
        durationSeconds: updated.durationSeconds,
        status: updated.status,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "建声失败";

      console.error("[Qwen enroll] failed", error);

      await prisma.voiceEnrollment.update({
        where: { id: enrollment.id },
        data: {
          status: EnrollmentStatus.FAILED,
          errorMessage: message,
        },
      });

      return errorResponse(c, "接口繁忙", 502);
    }
  });

  return voiceEnroll;
}
