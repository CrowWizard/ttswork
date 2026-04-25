import { Hono } from "hono";
import type { AppConfig } from "../lib/config";
import { requireCurrentUser, unauthorizedResponse } from "../lib/auth";
import { errorResponse } from "../lib/http";
import { getObjectBuffer } from "../lib/minio";
import { prisma } from "../lib/prisma";

export function createEnrollmentAudioRoutes(cfg: AppConfig) {
  const enrollmentAudio = new Hono();

  enrollmentAudio.get("/:enrollmentId/audio", async (c) => {
    const currentUser = await requireCurrentUser(c, cfg);

    if (!currentUser) {
      return unauthorizedResponse(c);
    }

    const enrollmentId = c.req.param("enrollmentId");
    const enrollment = await prisma.voiceEnrollment.findFirst({
      where: {
        id: enrollmentId,
        userId: currentUser.id,
      },
    });
    const user = await prisma.user.findUnique({
      where: { id: currentUser.id },
      select: { activeVoiceEnrollmentId: true },
    });

    if (!enrollment) {
      return errorResponse(c, "建声记录不存在", 404);
    }

    if (user?.activeVoiceEnrollmentId !== enrollment.id) {
      return errorResponse(c, "当前仅允许回放正在启用的声纹", 409);
    }

    if (enrollment.status !== "READY") {
      return errorResponse(c, "当前声纹尚未准备完成，无法回放", 409);
    }

    if (enrollment.isInvalidated) {
      return errorResponse(c, "当前声纹已作废，无法回放", 410);
    }

    const audioBuffer = await getObjectBuffer(cfg.minio, enrollment.objectKey);
    const filename = enrollment.originalFilename ?? `${enrollment.id}.webm`;

    return new Response(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": enrollment.inputContentType,
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  });

  return enrollmentAudio;
}
