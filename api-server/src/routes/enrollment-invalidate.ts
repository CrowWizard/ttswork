import { Hono } from "hono";
import type { AppConfig } from "../lib/config";
import { errorResponse } from "../lib/http";
import { prisma } from "../lib/prisma";
import { ensureAnonymousUserCookie } from "../lib/session";
import { ensureAnonymousUserRecord } from "../lib/user";

export function createEnrollmentInvalidateRoutes(cfg: AppConfig) {
  const enrollmentInvalidate = new Hono();

  enrollmentInvalidate.post("/:enrollmentId/invalidate", async (c) => {
    const userId = await ensureAnonymousUserCookie(c, cfg.cookie);
    await ensureAnonymousUserRecord(userId);

    const enrollmentId = c.req.param("enrollmentId");
    const enrollment = await prisma.voiceEnrollment.findFirst({
      where: {
        id: enrollmentId,
        userId,
      },
    });
    const user = await prisma.anonymousUser.findUnique({
      where: { id: userId },
      select: { activeVoiceEnrollmentId: true },
    });

    if (!enrollment) {
      return errorResponse(c, "建声记录不存在", 404);
    }

    if (user?.activeVoiceEnrollmentId !== enrollment.id) {
      return errorResponse(c, "当前仅允许作废正在启用的声纹", 409);
    }

    if (enrollment.isInvalidated) {
      await prisma.anonymousUser.updateMany({
        where: {
          id: userId,
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

      await tx.anonymousUser.updateMany({
        where: {
          id: userId,
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
