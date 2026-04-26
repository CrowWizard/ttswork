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

  // 阿里云要求 prefix 不超过 10 个字符，这里为场景版使用更短前缀避免超限。
  return `${profileKind === "PURE" ? "pure" : "scn"}${randomPart}`;
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

    try {
      const result = parsedBody.data.profileKind === "PURE"
        ? await enrollPureVoice(cfg.qwen, {
            audioBuffer: await getObjectBuffer(cfg.minio, recording.objectKey),
            mimeType: recording.inputContentType,
          })
        : await enrollSceneVoice(cfg.qwen, {
            publicAudioUrl: buildPublicObjectUrl(cfg.minio, recording.objectKey),
            prefix: buildVoicePrefix(parsedBody.data.profileKind),
          });

      const updated = await prisma.$transaction(async (tx) => {
        const readyEnrollment = await tx.voiceEnrollment.update({
          where: { id: enrollment.id },
          data: {
            status: EnrollmentStatus.READY,
            voiceId: result.voiceId,
            errorMessage: null,
          },
        });

        if (currentUser) {
          await tx.user.update({
            where: { id: currentUser.id },
            data: parsedBody.data.profileKind === "PURE"
              ? { activePureVoiceEnrollmentId: readyEnrollment.id }
              : { activeSceneVoiceEnrollmentId: readyEnrollment.id },
          });
        }

        if (anonymousUser) {
          await tx.anonymousUser.update({
            where: { id: anonymousUser.id },
            data: parsedBody.data.profileKind === "PURE"
              ? { activePureVoiceEnrollmentId: readyEnrollment.id }
              : { activeSceneVoiceEnrollmentId: readyEnrollment.id },
          });
        }

        return readyEnrollment;
      });

      return c.json({
        enrollmentId: updated.id,
        voiceId: updated.voiceId,
        status: updated.status,
        profileKind: updated.profileKind,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "建声失败";

      loggerError("voice_enrollment.qwen_failed", {
        requestId: getRequestId(c),
        enrollmentId: enrollment.id,
        recordingId: recording.id,
        profileKind: parsedBody.data.profileKind,
        enrollMode: parsedBody.data.profileKind === "PURE" ? "pure-direct-audio" : "scene-public-url",
        publicAudioUrl: parsedBody.data.profileKind === "SCENE" ? buildPublicObjectUrl(cfg.minio, recording.objectKey) : undefined,
        ...buildErrorLogContext(error),
      });

      await prisma.voiceEnrollment.update({
        where: { id: enrollment.id },
        data: {
          status: EnrollmentStatus.FAILED,
          errorMessage: message,
        },
      });

      return errorResponse(c, message, 502, {
        details: {
          enrollmentId: enrollment.id,
          recordingId: recording.id,
          profileKind: parsedBody.data.profileKind,
        },
      });
    }
  });

  return voiceEnrollments;
}
