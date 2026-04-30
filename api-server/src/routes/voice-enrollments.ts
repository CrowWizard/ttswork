import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { EnrollmentStatus, Prisma } from "@prisma/client";
import type { AppConfig } from "../lib/config";
import { requireCurrentUser, resolveAnonymousUser } from "../lib/auth";
import { errorResponse } from "../lib/http";
import { buildErrorLogContext, loggerError } from "../lib/logger";
import { buildPublicObjectUrl, getObjectBuffer } from "../lib/minio";
import { enrollPureVoice, enrollSceneVoice } from "../lib/qwen";
import { prisma } from "../lib/prisma";
import { voiceEnrollmentCreateSchema } from "../lib/validation";

function getRequestId(c: Context) {
  return (c as Context & { get: (key: string) => unknown }).get("requestId") as string | undefined;
}

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
    requestId?: string;
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
      requestId: params.requestId,
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

export function createVoiceEnrollmentRoutes(cfg: AppConfig) {
  const voiceEnrollments = new Hono();

  voiceEnrollments.post("/", async (c) => {
    const currentUser = await requireCurrentUser(c, cfg);
    const anonymousUser = currentUser ? null : await resolveAnonymousUser(c, cfg, { createIfMissing: true });
    const body = await c.req.json().catch(() => null);
    const parsedBody = voiceEnrollmentCreateSchema.safeParse(body);

    if (!parsedBody.success) {
      return errorResponse(c, parsedBody.error.issues[0]?.message ?? "请求参数无效");
    }

    const recording = await prisma.voiceRecording.findFirst({
      where: {
        id: parsedBody.data.recordingId,
        ...(currentUser ? { userId: currentUser.id } : { anonymousUserId: anonymousUser?.id }),
      },
    });

    if (!recording) {
      return errorResponse(c, "录音记录不存在", 404);
    }

    let enrollment;

    try {
      enrollment = await prisma.$transaction(
        async (tx) => tx.voiceEnrollment.create({
          data: {
            recordingId: recording.id,
            userId: currentUser?.id,
            anonymousUserId: anonymousUser?.id,
            profileKind: parsedBody.data.profileKind,
            status: EnrollmentStatus.PENDING,
            durationSeconds: recording.durationSeconds,
            originalFilename: recording.originalFilename,
            inputContentType: recording.inputContentType,
            bucket: recording.bucket,
            objectKey: recording.objectKey,
            minioUri: recording.minioUri,
          },
        }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      loggerError("voice_enrollment.create_failed", {
        requestId: getRequestId(c),
        recordingId: recording.id,
        profileKind: parsedBody.data.profileKind,
        ...buildErrorLogContext(error),
      });

      return errorResponse(c, error instanceof Error ? error.message : "创建声纹任务失败", 500);
    }

    void processEnrollmentAsync(cfg, {
      enrollmentId: enrollment.id,
      recordingId: recording.id,
      profileKind: parsedBody.data.profileKind,
      userId: currentUser?.id,
      anonymousUserId: anonymousUser?.id,
      requestId: getRequestId(c),
    });

    return c.json({
      enrollmentId: enrollment.id,
      status: EnrollmentStatus.PENDING,
      profileKind: enrollment.profileKind,
    });
  });

  return voiceEnrollments;
}
