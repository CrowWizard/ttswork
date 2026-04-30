import { Prisma } from "@prisma/client";
import { buildPaginatedResponse } from "../../lib/pagination";
import { prisma } from "../../lib/prisma";
import { generateUsageCode } from "../../lib/usage-code";

type InviteCodeListInput = {
  page: number;
  pageSize: number;
  startAt?: Date;
  endAt?: Date;
  status: "all" | "unused" | "used";
  code?: string;
};

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function listAdminInviteCodes(input: InviteCodeListInput) {
  const where = {
    ...(input.startAt || input.endAt
      ? {
          createdAt: {
            gte: input.startAt,
            lte: input.endAt,
          },
        }
      : {}),
    ...(input.status === "unused" ? { consumedAt: null } : {}),
    ...(input.status === "used" ? { consumedAt: { not: null as null | Date } } : {}),
    ...(input.code ? { code: { contains: input.code, mode: "insensitive" as const } } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.usageCode.count({ where }),
    prisma.usageCode.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
  ]);

  return buildPaginatedResponse(items.map((item) => ({
    id: item.id,
    module: item.module,
    code: item.code,
    status: item.consumedAt ? "used" : "unused",
    consumedAt: item.consumedAt,
    consumedByUserId: item.consumedByUserId,
    consumedTtsJobId: item.consumedTtsJobId,
    createdAt: item.createdAt,
  })), input.page, input.pageSize, total);
}

export async function getAdminInviteCodeTtsJobs(codeId: string) {
  const code = await prisma.usageCode.findUnique({ where: { id: codeId } });

  if (!code) return null;

  const ttsJobs = await prisma.ttsJob.findMany({
    where: { usageCodeId: codeId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      status: true,
      profileKind: true,
      accessKind: true,
      text: true,
      usageCodeValue: true,
    },
  });

  const user = code.consumedByUserId
    ? await prisma.user.findUnique({
        where: { id: code.consumedByUserId },
        select: { id: true, phoneNumber: true },
      })
    : null;

  return {
    code: {
      id: code.id,
      code: code.code,
      consumedAt: code.consumedAt,
      consumedByUserId: code.consumedByUserId,
      user,
    },
    ttsJobs,
  };
}

export async function generateAdminInviteCodes(count: number) {
  const generated: Array<{ id: string; code: string; createdAt: Date }> = [];

  while (generated.length < count) {
    const code = generateUsageCode();

    try {
      const created = await prisma.usageCode.create({
        data: {
          module: "VOICE_TO_TEXT",
          code,
        },
      });

      generated.push({
        id: created.id,
        code: created.code,
        createdAt: created.createdAt,
      });
    } catch (error) {
      if (isUniqueConflict(error)) {
        continue;
      }

      throw error;
    }
  }

  return {
    count: generated.length,
    items: generated,
  };
}
