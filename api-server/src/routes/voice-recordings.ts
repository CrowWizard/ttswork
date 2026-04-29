import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { RecordingStatus } from "@prisma/client";
import type { AppConfig } from "../lib/config";
import { requireCurrentUser, resolveAnonymousUser, unauthorizedResponse } from "../lib/auth";
import { isRecordDurationAccepted } from "../lib/audio";
import { getAudioExtension, resolveSupportedAudioMimeType } from "../lib/audio-format";
import { errorResponse } from "../lib/http";
import { INPUT_AUDIO_FIELD, MIN_RECORD_SECONDS, RECORD_DURATION_SECONDS_FIELD } from "../lib/constants";
import { removeObject, uploadBuffer } from "../lib/minio";
import { prisma } from "../lib/prisma";

export function createVoiceRecordingRoutes(cfg: AppConfig) {
  const voiceRecordings = new Hono();

  voiceRecordings.post("/", async (c) => {
    const currentUser = await requireCurrentUser(c, cfg);
    const anonymousUser = currentUser ? null : await resolveAnonymousUser(c, cfg, { createIfMissing: true });
    const ownerId = currentUser?.id ?? anonymousUser?.id;

    if (!ownerId) {
      return errorResponse(c, "无法建立匿名会话", 500);
    }

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
    const mimeType = resolveSupportedAudioMimeType(rawMimeType, audioFile.name);

    if (!mimeType) {
      return errorResponse(c, "录音格式仅支持 WAV、MP3、W4V", 400);
    }

    const durationSeconds = Number(recordDurationValue);

    if (!isRecordDurationAccepted(durationSeconds)) {
      return errorResponse(c, `录音时长必须不少于 ${MIN_RECORD_SECONDS} 秒`, 400);
    }

    const audioBuffer = Buffer.from(await audioFile.arrayBuffer());
    const extension = getAudioExtension(mimeType);
    const objectKey = `voices/${ownerId}/${Date.now()}-${randomUUID()}.${extension}`;
    const storedInput = await uploadBuffer(cfg.minio, {
      objectKey,
      buffer: audioBuffer,
      contentType: mimeType,
    });
    const recording = await prisma.voiceRecording.create({
      data: {
        userId: currentUser?.id,
        anonymousUserId: anonymousUser?.id,
        status: RecordingStatus.UPLOADED,
        durationSeconds,
        originalFilename: audioFile.name,
        inputContentType: mimeType,
        bucket: storedInput.bucket,
        objectKey: storedInput.objectKey,
        minioUri: storedInput.minioUri,
      },
    });

    return c.json({
      recordingId: recording.id,
      status: recording.status,
      durationSeconds: recording.durationSeconds,
      playbackUrl: `/api/voice/enrollments/recordings/${recording.id}/audio`,
    });
  });

  voiceRecordings.delete("/:recordingId", async (c) => {
    const currentUser = await requireCurrentUser(c, cfg);
    const anonymousUser = currentUser ? null : await resolveAnonymousUser(c, cfg);

    if (!currentUser && !anonymousUser) {
      return unauthorizedResponse(c);
    }

    const recordingId = c.req.param("recordingId");
    const recording = await prisma.voiceRecording.findFirst({
      where: {
        id: recordingId,
        ...(currentUser ? { userId: currentUser.id } : { anonymousUserId: anonymousUser?.id }),
      },
    });

    if (!recording) {
      return errorResponse(c, "录音素材不存在", 404);
    }

    try {
      await removeObject(cfg.minio, recording.objectKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown minio error";
      return errorResponse(c, `删除录音素材失败：${message}`, 502);
    }

    await prisma.voiceRecording.delete({
      where: { id: recording.id },
    });

    return c.json({
      recordingId: recording.id,
      deleted: true,
    });
  });

  return voiceRecordings;
}
