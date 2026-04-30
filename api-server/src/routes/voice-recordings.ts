import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { EnrollmentStatus, Prisma, RecordingStatus } from "@prisma/client";
import type { AppConfig } from "../lib/config";
import { requireCurrentUser, resolveAnonymousUser, unauthorizedResponse } from "../lib/auth";
import { isRecordDurationAccepted } from "../lib/audio";
import { getAudioExtension, resolveSupportedAudioMimeType } from "../lib/audio-format";
import { errorResponse } from "../lib/http";
import { INPUT_AUDIO_FIELD, MIN_RECORD_SECONDS, RECORD_DURATION_SECONDS_FIELD } from "../lib/constants";
import { buildPublicObjectUrl, getObjectBuffer, removeObject, uploadBuffer } from "../lib/minio";
import { prisma } from "../lib/prisma";
import { buildErrorLogContext, loggerError } from "../lib/logger";
import { enrollPureVoice, enrollSceneVoice } from "../lib/qwen";

function buildVoicePrefix(profileKind: "PURE" | "SCENE") {
  const randomPart = randomUUID().replace(/-/g, "").slice(0, 6);
  return `${profileKind === "PURE" ? "pure" : "scn"}${randomPart}`;
}

async function processEnrollmentAsync(
  cfg: AppConfig,
  params: {
    enrollmentId: string;
    recordingId: string;
    profileKind: "PURE" | "SCENE";
    userId?: string | null;
    anonymousUserId?: string | null;
  },
) {
  try {
    const recording = await prisma.voiceRecording.findUnique({
      where: { id: params.recordingId },
    });

    if (!recording) {
      throw new Error("录音记录不存在");
    }

    const result = params.profileKind === "PURE"
      ? await enrollPureVoice(cfg.qwen, {
          audioBuffer: await getObjectBuffer(cfg.minio, recording.objectKey),
          mimeType: recording.inputContentType,
        })
      : await enrollSceneVoice(cfg.qwen, {
          publicAudioUrl: buildPublicObjectUrl(cfg.minio, recording.objectKey),
          prefix: buildVoicePrefix(params.profileKind),
        });

    await prisma.$transaction(async (tx) => {
      await tx.voiceEnrollment.update({
        where: { id: params.enrollmentId },
        data: {
          status: EnrollmentStatus.READY,
          voiceId: result.voiceId,
          errorMessage: null,
        },
      });

      const updateData = params.profileKind === "PURE"
        ? { activePureVoiceEnrollmentId: params.enrollmentId }
        : { activeSceneVoiceEnrollmentId: params.enrollmentId };

      await tx.voiceProfile.upsert({
        where: params.userId
          ? { userId: params.userId }
          : { anonymousUserId: params.anonymousUserId! },
        create: {
          ...(params.userId ? { userId: params.userId } : { anonymousUserId: params.anonymousUserId }),
          ...updateData,
        },
        update: updateData,
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "建声失败";

    loggerError("voice_enrollment.qwen_failed", {
      enrollmentId: params.enrollmentId,
      recordingId: params.recordingId,
      profileKind: params.profileKind,
      ...buildErrorLogContext(error),
    });

    try {
      await prisma.voiceEnrollment.update({
        where: { id: params.enrollmentId },
        data: {
          status: EnrollmentStatus.FAILED,
          errorMessage: message,
        },
      });
    } catch (updateError) {
      loggerError("voice_enrollment.status_update_failed", {
        enrollmentId: params.enrollmentId,
        ...buildErrorLogContext(updateError),
      });
    }
  }
}

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

    try {
      await prisma.voiceProfile.upsert({
        where: currentUser
          ? { userId: currentUser.id }
          : { anonymousUserId: anonymousUser!.id },
        create: {
          ...(currentUser ? { userId: currentUser.id } : { anonymousUserId: anonymousUser!.id }),
        },
        update: {},
      });
    } catch (error) {
      loggerError("voice_recording.profile_upsert_failed", {
        recordingId: recording.id,
        ...buildErrorLogContext(error),
      });
    }

    const enrollmentBase = {
      recordingId: recording.id,
      userId: currentUser?.id,
      anonymousUserId: anonymousUser?.id,
      status: EnrollmentStatus.PENDING,
      durationSeconds: recording.durationSeconds,
      originalFilename: recording.originalFilename,
      inputContentType: recording.inputContentType,
      bucket: recording.bucket,
      objectKey: recording.objectKey,
      minioUri: recording.minioUri,
    };

    let pureEnrollmentId: string | null = null;
    let sceneEnrollmentId: string | null = null;

    try {
      const [pureEnrollment, sceneEnrollment] = await prisma.$transaction(
        async (tx) => Promise.all([
          tx.voiceEnrollment.create({
            data: { ...enrollmentBase, profileKind: "PURE" as const },
          }),
          tx.voiceEnrollment.create({
            data: { ...enrollmentBase, profileKind: "SCENE" as const },
          }),
        ]),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      pureEnrollmentId = pureEnrollment.id;
      sceneEnrollmentId = sceneEnrollment.id;
    } catch (error) {
      loggerError("voice_recording.auto_enrollment_create_failed", {
        recordingId: recording.id,
        ...buildErrorLogContext(error),
      });
    }

    if (pureEnrollmentId) {
      void processEnrollmentAsync(cfg, {
        enrollmentId: pureEnrollmentId,
        recordingId: recording.id,
        profileKind: "PURE",
        userId: currentUser?.id,
        anonymousUserId: anonymousUser?.id,
      });
    }

    if (sceneEnrollmentId) {
      void processEnrollmentAsync(cfg, {
        enrollmentId: sceneEnrollmentId,
        recordingId: recording.id,
        profileKind: "SCENE",
        userId: currentUser?.id,
        anonymousUserId: anonymousUser?.id,
      });
    }

    return c.json({
      recordingId: recording.id,
      status: recording.status,
      durationSeconds: recording.durationSeconds,
      playbackUrl: `/api/voice/enrollments/recordings/${recording.id}/audio`,
      pureEnrollmentId,
      sceneEnrollmentId,
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

    await prisma.$transaction(async (tx) => {
      const relatedEnrollments = await tx.voiceEnrollment.findMany({
        where: { recordingId: recording.id },
        select: { id: true },
      });
      const relatedEnrollmentIds = relatedEnrollments.map((item) => item.id);

      if (relatedEnrollmentIds.length > 0) {
        await tx.voiceEnrollment.updateMany({
          where: { id: { in: relatedEnrollmentIds } },
          data: { isInvalidated: true },
        });

        await tx.voiceProfile.updateMany({
          where: { activePureVoiceEnrollmentId: { in: relatedEnrollmentIds } },
          data: { activePureVoiceEnrollmentId: null },
        });

        await tx.voiceProfile.updateMany({
          where: { activeSceneVoiceEnrollmentId: { in: relatedEnrollmentIds } },
          data: { activeSceneVoiceEnrollmentId: null },
        });
      }

      await tx.voiceRecording.delete({
        where: { id: recording.id },
      });
    });

    return c.json({
      recordingId: recording.id,
      deleted: true,
    });
  });

  return voiceRecordings;
}
