import { Hono } from "hono";
import type { AppConfig } from "../lib/config";
import { requireCurrentUser, resolveAnonymousUser } from "../lib/auth";
import { prisma } from "../lib/prisma";

export function createVoiceProfileRoutes(cfg: AppConfig) {
  const voiceProfile = new Hono();

  function buildVoiceSummary(
    enrollment: {
      id: string;
      voiceId: string | null;
      status: string;
      durationSeconds: number;
      createdAt: Date;
      isInvalidated: boolean;
      recordingId: string;
      profileKind: string;
    } | null,
  ) {
    if (!enrollment) {
      return null;
    }

    return {
      id: enrollment.id,
      voiceId: enrollment.voiceId,
      status: enrollment.status,
      durationSeconds: enrollment.durationSeconds,
      createdAt: enrollment.createdAt,
      isInvalidated: enrollment.isInvalidated,
      profileKind: enrollment.profileKind,
      recordingId: enrollment.recordingId,
    };
  }

  voiceProfile.get("/", async (c) => {
    const currentUser = await requireCurrentUser(c, cfg);
    const anonymousUser = currentUser ? null : await resolveAnonymousUser(c, cfg, { createIfMissing: true });

    if (!currentUser && !anonymousUser) {
      return c.json({
        userId: null,
        anonymousUserId: null,
        activeVoices: {
          pure: null,
          scene: null,
        },
        recordings: [],
        recentEnrollments: [],
      });
    }

    const voiceProfileRow = await prisma.voiceProfile.findFirst({
      where: currentUser
        ? { userId: currentUser.id }
        : { anonymousUserId: anonymousUser?.id },
    });

    const activePureEnrollment = voiceProfileRow?.activePureVoiceEnrollmentId
      ? await prisma.voiceEnrollment.findUnique({
          where: { id: voiceProfileRow.activePureVoiceEnrollmentId },
        })
      : null;
    const activeSceneEnrollment = voiceProfileRow?.activeSceneVoiceEnrollmentId
      ? await prisma.voiceEnrollment.findUnique({
          where: { id: voiceProfileRow.activeSceneVoiceEnrollmentId },
        })
      : null;

    const recordings = await prisma.voiceRecording.findMany({
      where: currentUser ? { userId: currentUser.id } : { anonymousUserId: anonymousUser?.id },
      orderBy: { createdAt: "desc" },
      take: 1,
    });

    const recentEnrollments = await prisma.voiceEnrollment.findMany({
      where: currentUser ? { userId: currentUser.id } : { anonymousUserId: anonymousUser?.id },
      orderBy: { createdAt: "desc" },
      take: 5,
    });

    return c.json({
      userId: currentUser?.id ?? null,
      anonymousUserId: anonymousUser?.id ?? null,
      activeVoices: {
        pure: buildVoiceSummary(activePureEnrollment),
        scene: buildVoiceSummary(activeSceneEnrollment),
      },
      recordings: recordings.map((item) => ({
        id: item.id,
        status: item.status,
        durationSeconds: item.durationSeconds,
        createdAt: item.createdAt,
        playbackUrl: `/api/voice/enrollments/recordings/${item.id}/audio`,
        originalFilename: item.originalFilename,
      })),
      recentEnrollments: recentEnrollments.map((item) => ({
        id: item.id,
        status: item.status,
        voiceId: item.voiceId,
        durationSeconds: item.durationSeconds,
        createdAt: item.createdAt,
        errorMessage: item.errorMessage,
        isInvalidated: item.isInvalidated,
        profileKind: item.profileKind,
        recordingId: item.recordingId,
      })),
    });
  });

  return voiceProfile;
}
