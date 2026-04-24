import { prisma } from "./prisma";

export async function ensureAnonymousUserRecord(userId: string) {
  return prisma.anonymousUser.upsert({
    where: { id: userId },
    update: {},
    create: { id: userId },
  });
}
