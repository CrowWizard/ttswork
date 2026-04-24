import { PrismaClient } from "@prisma/client";

declare global {
  var prismaGlobal: PrismaClient | undefined;
}

// 延迟初始化：确保 DATABASE_URL 在 PrismaClient 实例化前已设置
let _prisma: PrismaClient | undefined;

export function initPrisma(databaseUrl: string): PrismaClient {
  if (_prisma) {
    return _prisma;
  }

  process.env.DATABASE_URL = databaseUrl;

  _prisma = globalThis.prismaGlobal ?? new PrismaClient();

  if (process.env.NODE_ENV !== "production") {
    globalThis.prismaGlobal = _prisma;
  }

  return _prisma;
}

/**
 * 延迟代理：所有对 prisma 的属性访问都会自动触发初始化检查。
 * 这样所有现有 import { prisma } 无需修改，只要 index.ts 先调用 initPrisma() 即可。
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop: string | symbol) {
    if (!_prisma) {
      throw new Error(
        "PrismaClient 未初始化，请先在入口文件调用 initPrisma(databaseUrl)"
      );
    }
    return Reflect.get(_prisma, prop);
  },
});
