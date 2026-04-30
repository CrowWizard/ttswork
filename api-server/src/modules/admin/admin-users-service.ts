import { Prisma } from "@prisma/client";
import { buildPaginatedResponse } from "../../lib/pagination";
import { prisma } from "../../lib/prisma";

type AdminUsersListInput = {
  page: number;
  pageSize: number;
  userId?: string;
  phoneNumber?: string;
  inviteCode?: string;
  anonymousId?: string;
};

function toNumber(value: bigint | number | null | undefined) {
  return Number(value ?? 0);
}

async function resolveMatchedUserIds(input: AdminUsersListInput) {
  let matchedByInviteCode: string[] | null = null;
  let matchedByAnonymousId: string[] | null = null;

  if (input.inviteCode) {
    const rows = await prisma.usageCode.findMany({
      where: {
        code: { contains: input.inviteCode, mode: "insensitive" },
        consumedByUserId: { not: null },
      },
      select: { consumedByUserId: true },
    });

    matchedByInviteCode = Array.from(new Set(rows.map((row) => row.consumedByUserId).filter((value): value is string => Boolean(value))));
  }

  if (input.anonymousId) {
    const rows = await prisma.analyticsVisitor.findMany({
      where: {
        anonymousId: { contains: input.anonymousId, mode: "insensitive" },
        userId: { not: null },
      },
      select: { userId: true },
    });

    matchedByAnonymousId = Array.from(new Set(rows.map((row) => row.userId).filter((value): value is string => Boolean(value))));
  }

  return { matchedByInviteCode, matchedByAnonymousId };
}

async function loadUserListAggregates(userIds: string[]) {
  if (userIds.length === 0) {
    return {
      latestReadyEnrollmentMap: new Map<string, Date>(),
      pureEnrollmentMap: new Map<string, boolean>(),
      sceneEnrollmentMap: new Map<string, boolean>(),
      ttsStatsMap: new Map<string, { count: number; latestAt: Date | null }>(),
      latestInviteCodeMap: new Map<string, { code: string; consumedAt: Date | null }>(),
      lastActiveMap: new Map<string, Date>(),
    };
  }

  const [latestReadyEnrollments, pureEnrollments, sceneEnrollments, ttsStats, inviteCodes, analyticsVisitors] = await Promise.all([
    prisma.$queryRaw<Array<{ userId: string; latestAt: Date }>>(Prisma.sql`
      SELECT "userId", MAX("createdAt") AS "latestAt"
      FROM "VoiceEnrollment"
      WHERE "status" = 'READY' AND "userId" IN (${Prisma.join(userIds)})
      GROUP BY "userId"
    `),
    prisma.$queryRaw<Array<{ userId: string }>>(Prisma.sql`
      SELECT DISTINCT "userId"
      FROM "VoiceEnrollment"
      WHERE "status" = 'READY' AND "profileKind" = 'PURE' AND "userId" IN (${Prisma.join(userIds)})
    `),
    prisma.$queryRaw<Array<{ userId: string }>>(Prisma.sql`
      SELECT DISTINCT "userId"
      FROM "VoiceEnrollment"
      WHERE "status" = 'READY' AND "profileKind" = 'SCENE' AND "userId" IN (${Prisma.join(userIds)})
    `),
    prisma.$queryRaw<Array<{ userId: string; count: bigint | number; latestAt: Date | null }>>(Prisma.sql`
      SELECT "userId", COUNT(*)::bigint AS count, MAX("createdAt") AS "latestAt"
      FROM "TtsJob"
      WHERE "userId" IN (${Prisma.join(userIds)})
      GROUP BY "userId"
    `),
    prisma.usageCode.findMany({
      where: {
        consumedByUserId: { in: userIds },
      },
      orderBy: [
        { consumedAt: "desc" },
        { createdAt: "desc" },
      ],
      select: {
        consumedByUserId: true,
        code: true,
        consumedAt: true,
      },
    }),
    prisma.$queryRaw<Array<{ userId: string; latestAt: Date }>>(Prisma.sql`
      SELECT "userId", MAX("lastSeenAt") AS "latestAt"
      FROM "AnalyticsVisitor"
      WHERE "userId" IN (${Prisma.join(userIds)})
      GROUP BY "userId"
    `),
  ]);

  const latestReadyEnrollmentMap = new Map(latestReadyEnrollments.map((row) => [row.userId, row.latestAt]));
  const pureEnrollmentMap = new Map(pureEnrollments.map((row) => [row.userId, true]));
  const sceneEnrollmentMap = new Map(sceneEnrollments.map((row) => [row.userId, true]));
  const ttsStatsMap = new Map(ttsStats.map((row) => [row.userId, { count: toNumber(row.count), latestAt: row.latestAt } ]));
  const latestInviteCodeMap = new Map<string, { code: string; consumedAt: Date | null }>();
  const lastActiveMap = new Map(analyticsVisitors.map((row) => [row.userId, row.latestAt]));

  for (const inviteCode of inviteCodes) {
    if (!inviteCode.consumedByUserId || latestInviteCodeMap.has(inviteCode.consumedByUserId)) {
      continue;
    }

    latestInviteCodeMap.set(inviteCode.consumedByUserId, {
      code: inviteCode.code,
      consumedAt: inviteCode.consumedAt,
    });
  }

  return {
    latestReadyEnrollmentMap,
    pureEnrollmentMap,
    sceneEnrollmentMap,
    ttsStatsMap,
    latestInviteCodeMap,
    lastActiveMap,
  };
}

export async function listAdminUsers(input: AdminUsersListInput) {
  const { matchedByInviteCode, matchedByAnonymousId } = await resolveMatchedUserIds(input);

  if ((matchedByInviteCode && matchedByInviteCode.length === 0) || (matchedByAnonymousId && matchedByAnonymousId.length === 0)) {
    return buildPaginatedResponse([], input.page, input.pageSize, 0);
  }

  const conditions: Prisma.UserWhereInput[] = [];

  if (input.userId) {
    conditions.push({ id: { contains: input.userId, mode: "insensitive" } });
  }

  if (input.phoneNumber) {
    conditions.push({ phoneNumber: { contains: input.phoneNumber, mode: "insensitive" } });
  }

  if (matchedByInviteCode) {
    conditions.push({ id: { in: matchedByInviteCode } });
  }

  if (matchedByAnonymousId) {
    conditions.push({ id: { in: matchedByAnonymousId } });
  }

  const where = conditions.length > 0 ? { AND: conditions } : {};

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
  ]);

  const userIds = users.map((user) => user.id);
  const { latestReadyEnrollmentMap, pureEnrollmentMap, sceneEnrollmentMap, ttsStatsMap, latestInviteCodeMap, lastActiveMap } = await loadUserListAggregates(userIds);

  return buildPaginatedResponse(users.map((user) => {
    const ttsStats = ttsStatsMap.get(user.id);
    const latestInviteCode = latestInviteCodeMap.get(user.id);

    return {
      id: user.id,
      phoneNumber: user.phoneNumber,
      createdAt: user.createdAt,
      hasCreatedVoiceprint: latestReadyEnrollmentMap.has(user.id),
      hasPureVoiceprint: pureEnrollmentMap.has(user.id),
      hasSceneVoiceprint: sceneEnrollmentMap.has(user.id),
      latestReadyVoiceEnrollmentAt: latestReadyEnrollmentMap.get(user.id) ?? null,
      hasUsedInviteCode: Boolean(latestInviteCode),
      latestInviteCode: latestInviteCode?.code ?? null,
      latestInviteCodeConsumedAt: latestInviteCode?.consumedAt ?? null,
      voiceGenerationCount: ttsStats?.count ?? 0,
      lastVoiceGeneratedAt: ttsStats?.latestAt ?? null,
      lastActiveAt: lastActiveMap.get(user.id) ?? null,
    };
  }), input.page, input.pageSize, total);
}

export async function getAdminUserDetail(id: string) {
  const user = await prisma.user.findUnique({
    where: { id },
  });

  if (!user) {
    return null;
  }

  const [latestReadyEnrollment, pureEnrollment, sceneEnrollment, usageCodes, ttsJobs, firstVisitor, lastVisitor, linkedVisitors] = await Promise.all([
    prisma.voiceEnrollment.findFirst({
      where: {
        userId: id,
        status: "READY",
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.voiceEnrollment.findFirst({
      where: {
        userId: id,
        status: "READY",
        profileKind: "PURE",
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.voiceEnrollment.findFirst({
      where: {
        userId: id,
        status: "READY",
        profileKind: "SCENE",
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.usageCode.findMany({
      where: { consumedByUserId: id },
      orderBy: { consumedAt: "desc" },
      select: { id: true, code: true, consumedAt: true, consumedTtsJobId: true },
    }),
    prisma.ttsJob.findMany({
      where: { userId: id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        createdAt: true,
        status: true,
        profileKind: true,
        accessKind: true,
        sceneKey: true,
        instruction: true,
        usageCodeValue: true,
      },
    }),
    prisma.analyticsVisitor.findFirst({
      where: { userId: id },
      orderBy: { firstSeenAt: "asc" },
    }),
    prisma.analyticsVisitor.findFirst({
      where: { userId: id },
      orderBy: { lastSeenAt: "desc" },
    }),
    prisma.analyticsVisitor.findMany({
      where: { userId: id },
      orderBy: { firstSeenAt: "asc" },
      select: {
        anonymousId: true,
        firstSeenAt: true,
        lastSeenAt: true,
      },
    }),
  ]);

  return {
    user: {
      id: user.id,
      phoneNumber: user.phoneNumber,
      phoneVerifiedAt: user.phoneVerifiedAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      activePureVoiceEnrollmentId: user.activePureVoiceEnrollmentId,
      activeSceneVoiceEnrollmentId: user.activeSceneVoiceEnrollmentId,
    },
    voiceprint: {
      hasCreatedVoiceprint: Boolean(latestReadyEnrollment),
      latestReadyEnrollmentAt: latestReadyEnrollment?.createdAt ?? null,
      latestReadyEnrollment,
      pureEnrollment: pureEnrollment
        ? { id: pureEnrollment.id, profileKind: pureEnrollment.profileKind, status: pureEnrollment.status, voiceId: pureEnrollment.voiceId, isInvalidated: pureEnrollment.isInvalidated, createdAt: pureEnrollment.createdAt }
        : null,
      sceneEnrollment: sceneEnrollment
        ? { id: sceneEnrollment.id, profileKind: sceneEnrollment.profileKind, status: sceneEnrollment.status, voiceId: sceneEnrollment.voiceId, isInvalidated: sceneEnrollment.isInvalidated, createdAt: sceneEnrollment.createdAt }
        : null,
    },
    inviteCodes: {
      hasUsedInviteCode: usageCodes.length > 0,
      totalUsed: usageCodes.length,
      latestCode: usageCodes[0]?.code ?? null,
      items: usageCodes,
    },
    voiceGenerations: {
      total: ttsJobs.length > 0 ? await prisma.ttsJob.count({ where: { userId: id } }) : 0,
      latestGeneratedAt: ttsJobs[0]?.createdAt ?? null,
      items: ttsJobs,
    },
    analytics: {
      firstSource: firstVisitor
        ? {
            anonymousId: firstVisitor.anonymousId,
            firstSeenAt: firstVisitor.firstSeenAt,
            firstLandingPage: firstVisitor.firstLandingPage,
            firstReferrer: firstVisitor.firstReferrer,
            firstUtmSource: firstVisitor.firstUtmSource,
            firstUtmMedium: firstVisitor.firstUtmMedium,
            firstUtmCampaign: firstVisitor.firstUtmCampaign,
          }
        : null,
      lastActiveAt: lastVisitor?.lastSeenAt ?? null,
      linkedAnonymousIds: linkedVisitors,
    },
  };
}
