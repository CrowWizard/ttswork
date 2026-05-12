import {
  ContentGenerationDuration,
  ContentGenerationJobStatus,
  ContentGenerationLanguage,
  ContentGenerationPlatform,
  ContentGenerationTone,
  ContentGenerationType,
  ContentGenerationVerbosity,
} from "@prisma/client";
import { buildDatabaseUrl, ensureLogDir, loadConfig } from "../lib/config";
import { initLogger, loggerInfo } from "../lib/logger";
import { initPrisma, prisma } from "../lib/prisma";
import { contentGenerationJobCreateSchema } from "../lib/validation";
import { contentGenerationWorkerJobSelect } from "../modules/content-generation/content-generation-repository";
import { processContentGenerationJob } from "../modules/content-generation/content-generation-service";

type CliArgs = {
  jobId?: string;
  userId: string;
  topic?: string;
  tone?: string;
  verbosity?: string;
  duration?: string;
  generateShots?: boolean;
};

const DEFAULT_CONTENT_GENERATION_PLATFORM = ContentGenerationPlatform.BILIBILI;
const DEFAULT_CONTENT_GENERATION_LANGUAGE = ContentGenerationLanguage.ZH_CN;

const toneMap = {
  personal: ContentGenerationTone.PERSONAL,
  company: ContentGenerationTone.COMPANY,
  "professional-casual": ContentGenerationTone.PROFESSIONAL_CASUAL,
} as const;

const verbosityMap = {
  concise: ContentGenerationVerbosity.CONCISE,
  detailed: ContentGenerationVerbosity.DETAILED,
} as const;

const durationMap = {
  short: ContentGenerationDuration.SHORT,
  medium: ContentGenerationDuration.MEDIUM,
  long: ContentGenerationDuration.LONG,
} as const;

function parseArgs(argv: string[]): CliArgs {
  const args: Record<string, string> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = "true";
      continue;
    }

    args[key] = next;
    index += 1;
  }

  return {
    jobId: args["job-id"],
    userId: args["user-id"] ?? "local-content-generation-user",
    topic: args.topic,
    tone: args.tone,
    verbosity: args.verbosity,
    duration: args.duration,
    generateShots: args["generate-shots"] === undefined ? undefined : args["generate-shots"] !== "false",
  };
}

async function createJob(args: CliArgs) {
  const parsed = contentGenerationJobCreateSchema.parse({
    topic: args.topic,
    type: "video_script",
    tone: args.tone,
    verbosity: args.verbosity,
    duration: args.duration,
    generateShots: args.generateShots,
  });

  return prisma.contentGenerationJob.create({
    data: {
      userId: args.userId,
      status: ContentGenerationJobStatus.PENDING,
      topicInput: parsed.topic,
      type: ContentGenerationType.VIDEO_SCRIPT,
      platform: DEFAULT_CONTENT_GENERATION_PLATFORM,
      language: DEFAULT_CONTENT_GENERATION_LANGUAGE,
      tone: toneMap[parsed.tone],
      verbosity: verbosityMap[parsed.verbosity],
      duration: durationMap[parsed.duration],
      generateShots: parsed.generateShots,
      heroOpening: null,
      outroClosing: null,
    },
    select: contentGenerationWorkerJobSelect,
  });
}

async function loadJob(jobId: string) {
  const job = await prisma.contentGenerationJob.findUnique({
    where: { id: jobId },
    select: contentGenerationWorkerJobSelect,
  });

  if (!job) {
    throw new Error(`内容生成任务不存在: ${jobId}`);
  }

  return job;
}

async function main() {
  const args = parseArgs(Bun.argv.slice(2));

  if (!args.jobId && !args.topic) {
    throw new Error("请传入 --topic 创建并执行任务，或传入 --job-id 执行已有任务");
  }

  const cfg = loadConfig();
  initPrisma(buildDatabaseUrl(cfg.database));
  ensureLogDir(cfg.server.logDir);
  initLogger(cfg.server);

  const job = args.jobId ? await loadJob(args.jobId) : await createJob(args);
  loggerInfo("content_generation.once.start", { jobId: job.id, topic: job.topicInput });

  await processContentGenerationJob(cfg, job);

  const finished = await prisma.contentGenerationJob.findUnique({
    where: { id: job.id },
    select: { id: true, status: true, errorMessage: true, finalJson: true },
  });

  console.info(JSON.stringify({
    jobId: finished?.id ?? job.id,
    status: finished?.status ?? "UNKNOWN",
    errorMessage: finished?.errorMessage ?? null,
    final: finished?.finalJson ? JSON.parse(finished.finalJson) : null,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
