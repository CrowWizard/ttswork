import { Hono } from "hono";
import type { AppConfig } from "../lib/config";
import { requireCurrentUser, resolveAnonymousUser, unauthorizedResponse } from "../lib/auth";
import { errorResponse } from "../lib/http";
import { prisma } from "../lib/prisma";

export function createEnrollmentInvalidateRoutes(cfg: AppConfig) {
  const enrollmentInvalidate = new Hono();

  enrollmentInvalidate.post("/:enrollmentId/invalidate", async (c) => {
    const currentUser = await requireCurrentUser(c, cfg);
    const anonymousUser = currentUser ? null : await resolveAnonymousUser(c, cfg);

    if (!currentUser && !anonymousUser) {
      return unauthorizedResponse(c);
    }

    const enrollmentId = c.req.param("enrollmentId");
    const enrollment = await prisma.voiceEnrollment.findFirst({
      where: {
        id: enrollmentId,
        ...(currentUser ? { userId: currentUser.id } : { anonymousUserId: anonymousUser?.id }),
      },
    });

    if (!enrollment) {
      return errorResponse(c, "建声记录不存在", 404);
    }

    const voiceProfileRow = await prisma.voiceProfile.findFirst({
      where: currentUser
        ? { userId: currentUser.id }
        : { anonymousUserId: anonymousUser?.id },
    });

    const activeVoiceEnrollmentId = enrollment.profileKind === "PURE"
      ? voiceProfileRow?.activePureVoiceEnrollmentId
      : voiceProfileRow?.activeSceneVoiceEnrollmentId;

    if (activeVoiceEnrollmentId !== enrollment.id) {
      return errorResponse(c, "当前仅允许作废正在启用的声纹", 409);
    }

    if (enrollment.isInvalidated) {
      const clearData = enrollment.profileKind === "PURE"
        ? { activePureVoiceEnrollmentId: null }
        : { activeSceneVoiceEnrollmentId: null };

      if (voiceProfileRow) {
        await prisma.voiceProfile.update({
          where: { id: voiceProfileRow.id },
          data: clearData,
        });
      }

      return c.json({
        enrollmentId: enrollment.id,
        isInvalidated: true,
        activeVoiceCleared: true,
      });
    }

    if (enrollment.status !== "READY") {
      return errorResponse(c, "当前建声尚未完成，无法作废", 409);
    }

    const result = await prisma.$transaction(async (tx) => {
      const updatedEnrollment = await tx.voiceEnrollment.update({
        where: { id: enrollment.id },
        data: { isInvalidated: true },
      });

      const clearData = enrollment.profileKind === "PURE"
        ? { activePureVoiceEnrollmentId: null }
        : { activeSceneVoiceEnrollmentId: null };

      if (voiceProfileRow) {
        await tx.voiceProfile.update({
          where: { id: voiceProfileRow.id },
          data: clearData,
        });
      }

      return updatedEnrollment;
    });

    return c.json({
      enrollmentId: result.id,
      isInvalidated: result.isInvalidated,
      activeVoiceCleared: true,
    });
  });

  return enrollmentInvalidate;
}
