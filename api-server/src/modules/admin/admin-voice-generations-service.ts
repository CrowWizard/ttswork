import { buildPaginatedResponse } from "../../lib/pagination";
import { prisma } from "../../lib/prisma";

type VoiceGenerationsListInput = {
  page: number;
  pageSize: number;
  startAt?: Date;
  endAt?: Date;
  userId?: string;
  phoneNumber?: string;
  hasUsageCode?: boolean;
  status?: "PENDING" | "READY" | "FAILED";
};

async function resolveUserIdsByPhoneNumber(phoneNumber: string): Promise<string[] | null> {
  if (!phoneNumber) return null;
  const users = await prisma.user.findMany({
    where: { phoneNumber: { contains: phoneNumber, mode: "insensitive" } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

function buildWhere(input: VoiceGenerationsListInput, phoneUserIds?: string[] | null) {
  return {
    ...(input.startAt || input.endAt
      ? {
          createdAt: {
            gte: input.startAt,
            lte: input.endAt,
          },
        }
      : {}),
    ...(input.userId ? { userId: input.userId } : {}),
    ...(phoneUserIds !== undefined && phoneUserIds !== null ? { userId: { in: phoneUserIds } } : {}),
    ...(input.hasUsageCode === true ? { usageCodeValue: { not: null as string | null } } : {}),
    ...(input.hasUsageCode === false ? { usageCodeValue: null } : {}),
    ...(input.status ? { status: input.status } : {}),
  };
}

export async function listAdminVoiceGenerations(input: VoiceGenerationsListInput) {
  const phoneUserIds = input.phoneNumber ? await resolveUserIdsByPhoneNumber(input.phoneNumber) : undefined;

  if (phoneUserIds !== undefined && phoneUserIds !== null && phoneUserIds.length === 0) {
    return buildPaginatedResponse([], input.page, input.pageSize, 0);
  }

  const where = buildWhere(input, phoneUserIds);
  const [total, jobs] = await Promise.all([
    prisma.ttsJob.count({ where }),
    prisma.ttsJob.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
  ]);

  const userIds = Array.from(new Set(jobs.map((job) => job.userId).filter((value): value is string => Boolean(value))));
  const enrollmentIds = Array.from(new Set(jobs.map((job) => job.voiceEnrollmentId).filter((value): value is string => Boolean(value))));

  const [users, enrollments] = await Promise.all([
    userIds.length > 0
      ? prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, phoneNumber: true },
        })
      : Promise.resolve([]),
    enrollmentIds.length > 0
      ? prisma.voiceEnrollment.findMany({
          where: { id: { in: enrollmentIds } },
          select: { id: true, status: true, voiceId: true, isInvalidated: true, profileKind: true },
        })
      : Promise.resolve([]),
  ]);

  const userMap = new Map(users.map((user) => [user.id, user]));
  const enrollmentMap = new Map(enrollments.map((enrollment) => [enrollment.id, enrollment]));

  return buildPaginatedResponse(jobs.map((job) => ({
    id: job.id,
    userId: job.userId,
    userPhoneNumber: job.userId ? userMap.get(job.userId)?.phoneNumber ?? null : null,
    anonymousUserId: job.anonymousUserId,
    voiceEnrollmentId: job.voiceEnrollmentId,
    createdAt: job.createdAt,
    status: job.status,
    profileKind: job.profileKind,
    accessKind: job.accessKind,
    usageCodeValue: job.usageCodeValue,
    sceneKey: job.sceneKey,
    instruction: job.instruction,
    voiceEnrollment: job.voiceEnrollmentId ? enrollmentMap.get(job.voiceEnrollmentId) ?? null : null,
  })), input.page, input.pageSize, total);
}

export async function getAdminVoiceGenerationDetail(id: string) {
  const job = await prisma.ttsJob.findUnique({
    where: { id },
  });

  if (!job) {
    return null;
  }

  const [user, anonymousUser, voiceEnrollment, usageCode] = await Promise.all([
    job.userId
      ? prisma.user.findUnique({
          where: { id: job.userId },
          select: { id: true, phoneNumber: true, createdAt: true },
        })
      : Promise.resolve(null),
    job.anonymousUserId
      ? prisma.anonymousUser.findUnique({
          where: { id: job.anonymousUserId },
          select: { id: true, createdAt: true, lastSeenAt: true },
        })
      : Promise.resolve(null),
    job.voiceEnrollmentId
      ? prisma.voiceEnrollment.findUnique({
          where: { id: job.voiceEnrollmentId },
        })
      : Promise.resolve(null),
    job.usageCodeId
      ? prisma.usageCode.findUnique({
          where: { id: job.usageCodeId },
          select: { id: true, code: true, consumedAt: true, consumedByUserId: true },
        })
      : Promise.resolve(null),
  ]);

  return {
    id: job.id,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    status: job.status,
    profileKind: job.profileKind,
    accessKind: job.accessKind,
    usageCodeId: job.usageCodeId,
    usageCodeValue: job.usageCodeValue,
    usageCode,
    text: job.text,
    sceneKey: job.sceneKey,
    instruction: job.instruction,
    voiceIdSnapshot: job.voiceIdSnapshot,
    outputContentType: job.outputContentType,
    errorMessage: job.errorMessage,
    bucket: job.bucket,
    objectKey: job.objectKey,
    minioUri: job.minioUri,
    user,
    anonymousUser,
    voiceEnrollment,
  };
}
