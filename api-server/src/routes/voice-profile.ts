import { Hono } from "hono";
import type { AppConfig } from "../lib/config";
import { requireCurrentUser, resolveAnonymousUser } from "../lib/auth";
import { prisma } from "../lib/prisma";

export function createVoiceProfileRoutes(cfg: AppConfig) {
  const voiceProfile = new Hono();

  voiceProfile.get("/", async (c) => {
    const currentUser = await requireCurrentUser(c, cfg);
    const anonymousUser = currentUser ? null : await resolveAnonymousUser(c, cfg, { createIfMissing: true });

    if (!currentUser && !anonymousUser) {
      return c.json({
        userId: null,
        anonymousUserId: null,
        activeVoice: null,
        recentEnrollments: [],
      });
    }

    const activeVoiceEnrollmentId = currentUser
      ? (await prisma.user.findUnique({ where: { id: currentUser.id } }))?.activeVoiceEnrollmentId
      : anonymousUser?.activeVoiceEnrollmentId;

    const activeEnrollment = activeVoiceEnrollmentId
      ? await prisma.voiceEnrollment.findUnique({
          where: { id: activeVoiceEnrollmentId },
        })
      : null;

    const recentEnrollments = await prisma.voiceEnrollment.findMany({
      where: currentUser ? { userId: currentUser.id } : { anonymousUserId: anonymousUser?.id },
      orderBy: { createdAt: "desc" },
      take: 5,
    });

    return c.json({
      userId: currentUser?.id ?? null,
      anonymousUserId: anonymousUser?.id ?? null,
      activeVoice: activeEnrollment
        ? {
            id: activeEnrollment.id,
            voiceId: activeEnrollment.voiceId,
            status: activeEnrollment.status,
            durationSeconds: activeEnrollment.durationSeconds,
            createdAt: activeEnrollment.createdAt,
            playbackUrl:
              activeEnrollment.status === "READY" && !activeEnrollment.isInvalidated
                ? `/api/voice/enrollments/${activeEnrollment.id}/audio`
                : null,
            isInvalidated: activeEnrollment.isInvalidated,
          }
        : null,
      recentEnrollments: recentEnrollments.map((item) => ({
        id: item.id,
        status: item.status,
        voiceId: item.voiceId,
        durationSeconds: item.durationSeconds,
        createdAt: item.createdAt,
        errorMessage: item.errorMessage,
        isInvalidated: item.isInvalidated,
      })),
    });
  });

  return voiceProfile;
}
