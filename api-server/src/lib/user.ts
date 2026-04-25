import { prisma } from "./prisma";

/**
 * 确保匿名用户记录存在。
 * 使用 findUnique + create 替代 upsert，避免并发时 P2002 唯一约束冲突。
 */
export async function ensureAnonymousUserRecord(userId: string) {
  const existing = await prisma.anonymousUser.findUnique({ where: { id: userId } });
  if (existing) {
    return existing;
  }

  try {
    return await prisma.anonymousUser.create({ data: { id: userId } });
  } catch (error: any) {
    // 并发情况下另一个请求可能已创建，重新查询即可
    if (error?.code === "P2002") {
      return prisma.anonymousUser.findUniqueOrThrow({ where: { id: userId } });
    }
    throw error;
  }
}
