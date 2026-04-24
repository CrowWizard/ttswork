import { PrismaClient } from "@prisma/client";

declare global {
  var prismaGlobal: PrismaClient | undefined;
}

export function createPrismaClient(databaseUrl: string): PrismaClient {
  process.env.DATABASE_URL = databaseUrl;

  return new PrismaClient();
}

export const prisma = globalThis.prismaGlobal ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.prismaGlobal = prisma;
}
