import { Hono } from "hono";
import type { AppConfig } from "../lib/config";
import { requireCurrentUser, unauthorizedResponse } from "../lib/auth";
import { prisma } from "../lib/prisma";

export function createVoiceProfileRoutes(cfg: AppConfig) {
  const voiceProfile = new Hono();

  voiceProfile.get("/", async (c) => {
    const currentUser = await requireCurrentUser(c, cfg);

    if (!currentUser) {
      return unauthorizedResponse(c);
    }

    const profile = await prisma.user.findUnique({
      where: { id: currentUser.id },
      include: {
        activeVoiceEnrollment: true,
        voiceEnrollments: {
          orderBy: { createdAt: "desc" },
          take: 5,
        },
      },
    });

    return c.json({
      userId: currentUser.id,
      activeVoice: profile?.activeVoiceEnrollment
        ? {
            id: profile.activeVoiceEnrollment.id,
            voiceId: profile.activeVoiceEnrollment.voiceId,
            status: profile.activeVoiceEnrollment.status,
            durationSeconds: profile.activeVoiceEnrollment.durationSeconds,
            createdAt: profile.activeVoiceEnrollment.createdAt,
            playbackUrl:
              profile.activeVoiceEnrollment.status === "READY" && !profile.activeVoiceEnrollment.isInvalidated
                ? `/api/voice/enrollments/${profile.activeVoiceEnrollment.id}/audio`
                : null,
            isInvalidated: profile.activeVoiceEnrollment.isInvalidated,
          }
        : null,
      recentEnrollments:
        profile?.voiceEnrollments.map((item) => ({
          id: item.id,
          status: item.status,
          voiceId: item.voiceId,
          durationSeconds: item.durationSeconds,
          createdAt: item.createdAt,
          errorMessage: item.errorMessage,
          isInvalidated: item.isInvalidated,
        })) ?? [],
    });
  });

  return voiceProfile;
}
