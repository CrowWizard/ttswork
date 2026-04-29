import { Prisma } from "@prisma/client";
import { buildDatabaseUrl, loadConfig } from "../lib/config";
import { initPrisma, prisma } from "../lib/prisma";
import { generateUsageCode } from "../lib/usage-code";

const DEFAULT_USAGE_CODE_MODULE = "VOICE_TO_TEXT" as const;

function readCount() {
  const index = process.argv.indexOf("--count");
  const raw = index >= 0 ? process.argv[index + 1] : "50";
  const count = Number(raw);

  if (!Number.isInteger(count) || count <= 0 || count > 10000) {
    throw new Error("--count 必须是 1 到 10000 之间的整数");
  }

  return count;
}

function readModule() {
  const index = process.argv.indexOf("--module");
  const usageModule = index >= 0 ? process.argv[index + 1] : DEFAULT_USAGE_CODE_MODULE;

  if (usageModule !== DEFAULT_USAGE_CODE_MODULE) {
    throw new Error("当前仅支持 VOICE_TO_TEXT 模块");
  }

  return DEFAULT_USAGE_CODE_MODULE;
}

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

const cfg = loadConfig();
initPrisma(buildDatabaseUrl(cfg.database));

const count = readCount();
const usageModule = readModule();
const generated: string[] = [];

try {
  while (generated.length < count) {
    const code = generateUsageCode();

    try {
      await prisma.usageCode.create({
        data: {
          module: usageModule,
          code,
        },
      });
      generated.push(code);
    } catch (error) {
      if (isUniqueConflict(error)) {
        continue;
      }

      throw error;
    }
  }

  console.log(generated.join("\n"));
} finally {
  await prisma.$disconnect();
}
