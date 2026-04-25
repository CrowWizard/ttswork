import { Hono } from "hono";
import type { AppConfig } from "../lib/config";
import { requireCurrentUser, unauthorizedResponse } from "../lib/auth";
import { errorResponse } from "../lib/http";
import { prisma } from "../lib/prisma";

export function createEnrollmentInvalidateRoutes(cfg: AppConfig) {
  const enrollmentInvalidate = new Hono();

  enrollmentInvalidate.post("/:enrollmentId/invalidate", async (c) => {
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
      return errorResponse(c, "当前仅允许作废正在启用的声纹", 409);
    }

    if (enrollment.isInvalidated) {
      await prisma.user.updateMany({
        where: {
          id: currentUser.id,
          activeVoiceEnrollmentId: enrollment.id,
        },
        data: {
          activeVoiceEnrollmentId: null,
        },
      });

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

      await tx.user.updateMany({
        where: {
          id: currentUser.id,
          activeVoiceEnrollmentId: enrollment.id,
        },
        data: {
          activeVoiceEnrollmentId: null,
        },
      });

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
