import { Hono } from "hono";
import {
  ContentGenerationDuration,
  ContentGenerationJobStatus,
  ContentGenerationLanguage,
  ContentGenerationPlatform,
  ContentGenerationTone,
  ContentGenerationType,
  ContentGenerationVerbosity,
  Prisma,
} from "@prisma/client";
import type { AppConfig } from "../lib/config";
import { requireCurrentUser, unauthorizedResponse } from "../lib/auth";
import { errorResponse } from "../lib/http";
import { buildErrorLogContext, loggerDebug, loggerError } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { contentGenerationJobCreateSchema } from "../lib/validation";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 20;
const WORKSPACE_RECENT_LIMIT = 5;

const contentGenerationJobSelect = {
  id: true,
  userId: true,
  status: true,
  errorMessage: true,
  topicInput: true,
  type: true,
  platform: true,
  language: true,
  tone: true,
  verbosity: true,
  duration: true,
  generateShots: true,
  heroOpening: true,
  outroClosing: true,
  category: true,
  matchedTopic: true,
  hook: true,
  researchSummary: true,
  directionJson: true,
  structureJson: true,
  contentJson: true,
  finalJson: true,
  metadataJson: true,
  progressLogJson: true,
  modelName: true,
  promptVersion: true,
  workerId: true,
  lockedAt: true,
  retryCount: true,
  nextRetryAt: true,
  currentStage: true,
  currentStageStatus: true,
  currentStageMessage: true,
  currentStageStartedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ContentGenerationJobSelect;

const contentGenerationStageEventSelect = {
  id: true,
  jobId: true,
  stage: true,
  status: true,
  label: true,
  message: true,
  detailsJson: true,
  startedAt: true,
  completedAt: true,
  durationMs: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ContentGenerationStageEventSelect;

type SelectedContentGenerationJob = Prisma.ContentGenerationJobGetPayload<{ select: typeof contentGenerationJobSelect }>;
type SelectedContentGenerationStageEvent = Prisma.ContentGenerationStageEventGetPayload<{ select: typeof contentGenerationStageEventSelect }>;

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

function parsePage(value: string | null) {
  const parsed = Number(value ?? DEFAULT_PAGE);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}

function parsePageSize(value: string | null) {
  const parsed = Number(value ?? DEFAULT_PAGE_SIZE);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_PAGE_SIZE ? parsed : null;
}

function parseStatus(value: string | null) {
  if (!value) return null;
  return Object.values(ContentGenerationJobStatus).includes(value as ContentGenerationJobStatus)
    ? (value as ContentGenerationJobStatus)
    : undefined;
}

function toJsonValue(value: string | null) {
  if (!value) return null;

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function toStageEventDto(event: SelectedContentGenerationStageEvent) {
  return {
    eventId: event.id,
    stage: event.stage,
    status: event.status,
    label: event.label,
    message: event.message,
    details: toJsonValue(event.detailsJson),
    startedAt: event.startedAt,
    completedAt: event.completedAt,
    durationMs: event.durationMs,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

function toJobDetailDto(job: SelectedContentGenerationJob, stageEvents: ReturnType<typeof toStageEventDto>[]) {
  return {
    jobId: job.id,
    status: job.status,
    errorMessage: job.errorMessage,
    currentStage: job.currentStage,
    currentStageStatus: job.currentStageStatus,
    currentStageMessage: job.currentStageMessage,
    currentStageStartedAt: job.currentStageStartedAt,
    workerId: job.workerId,
    lockedAt: job.lockedAt,
    retryCount: job.retryCount,
    nextRetryAt: job.nextRetryAt,
    completedAt: job.completedAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    input: {
      topic: job.topicInput,
      type: job.type,
      platform: job.platform,
      language: job.language,
      tone: job.tone,
      verbosity: job.verbosity,
      duration: job.duration,
      generateShots: job.generateShots,
      heroOpening: job.heroOpening,
      outroClosing: job.outroClosing,
    },
    result: job.finalJson ? toJsonValue(job.finalJson) : null,
    intermediate: {
      category: job.category,
      matchedTopic: job.matchedTopic,
      hook: job.hook,
      researchSummary: job.researchSummary,
      direction: toJsonValue(job.directionJson),
      structure: toJsonValue(job.structureJson),
      content: toJsonValue(job.contentJson),
      metadata: toJsonValue(job.metadataJson),
      progressLog: toJsonValue(job.progressLogJson),
      modelName: job.modelName,
      promptVersion: job.promptVersion,
    },
    stageEvents,
  };
}

function toJobListItemDto(job: SelectedContentGenerationJob) {
  return {
    jobId: job.id,
    status: job.status,
    errorMessage: job.errorMessage,
    topic: job.topicInput,
    platform: job.platform,
    language: job.language,
    currentStage: job.currentStage,
    currentStageStatus: job.currentStageStatus,
    currentStageMessage: job.currentStageMessage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
  };
}

async function loadStageEventsByJobId(jobId: string) {
  const events = await prisma.contentGenerationStageEvent.findMany({
    where: { jobId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: contentGenerationStageEventSelect,
  });

  return events.map(toStageEventDto);
}

export function createContentGenerationRoutes(cfg: AppConfig) {
  const contentGeneration = new Hono();

  contentGeneration.post("/jobs", async (c) => {
    const routeStartedAt = Date.now();
    const currentUser = await requireCurrentUser(c, cfg);

    if (!currentUser) return unauthorizedResponse(c);

    try {
      const body = await c.req.json().catch(() => null);
      const parsedBody = contentGenerationJobCreateSchema.safeParse(body);

      if (!parsedBody.success) {
        return errorResponse(c, parsedBody.error.issues[0]?.message ?? "请求参数无效");
      }

      const job = await prisma.contentGenerationJob.create({
        data: {
          userId: currentUser.id,
          topicInput: parsedBody.data.topic,
          type: ContentGenerationType.VIDEO_SCRIPT,
          platform: DEFAULT_CONTENT_GENERATION_PLATFORM,
          language: DEFAULT_CONTENT_GENERATION_LANGUAGE,
          tone: toneMap[parsedBody.data.tone],
          verbosity: verbosityMap[parsedBody.data.verbosity],
          duration: durationMap[parsedBody.data.duration],
          generateShots: parsedBody.data.generateShots,
          heroOpening: null,
          outroClosing: null,
        },
        select: { id: true, status: true, createdAt: true },
      });

      loggerDebug("content_generation.job.created", {
        userId: currentUser.id,
        jobId: job.id,
        durationMs: Date.now() - routeStartedAt,
      });

      return c.json({ jobId: job.id, status: job.status, createdAt: job.createdAt });
    } catch (error) {
      loggerError("content_generation.job.create.failed", {
        userId: currentUser.id,
        durationMs: Date.now() - routeStartedAt,
        ...buildErrorLogContext(error),
      });
      throw error;
    }
  });

  contentGeneration.get("/jobs/:jobId", async (c) => {
    const currentUser = await requireCurrentUser(c, cfg);
    if (!currentUser) return unauthorizedResponse(c);

    const jobId = c.req.param("jobId");
    const job = await prisma.contentGenerationJob.findFirst({
      where: { id: jobId, userId: currentUser.id },
      select: contentGenerationJobSelect,
    });

    if (!job) return errorResponse(c, "内容生成任务不存在", 404);

    const stageEvents = await loadStageEventsByJobId(job.id);
    return c.json(toJobDetailDto(job, stageEvents));
  });

  contentGeneration.get("/jobs", async (c) => {
    const currentUser = await requireCurrentUser(c, cfg);
    if (!currentUser) return unauthorizedResponse(c);

    const url = new URL(c.req.url);
    const page = parsePage(url.searchParams.get("page"));
    const pageSize = parsePageSize(url.searchParams.get("pageSize"));
    const status = parseStatus(url.searchParams.get("status"));

    if (!page) return errorResponse(c, "page 必须是大于等于 1 的整数");
    if (!pageSize) return errorResponse(c, `pageSize 必须是 1 到 ${MAX_PAGE_SIZE} 之间的整数`);
    if (status === undefined) return errorResponse(c, "status 参数无效");

    const where = { userId: currentUser.id, ...(status ? { status } : {}) } satisfies Prisma.ContentGenerationJobWhereInput;
    const [total, jobs] = await Promise.all([
      prisma.contentGenerationJob.count({ where }),
      prisma.contentGenerationJob.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: contentGenerationJobSelect,
      }),
    ]);

    return c.json({ page, pageSize, total, items: jobs.map(toJobListItemDto) });
  });

  contentGeneration.get("/workspace", async (c) => {
    const currentUser = await requireCurrentUser(c, cfg);
    if (!currentUser) return unauthorizedResponse(c);

    const jobs = await prisma.contentGenerationJob.findMany({
      where: { userId: currentUser.id },
      orderBy: { createdAt: "desc" },
      take: WORKSPACE_RECENT_LIMIT,
      select: contentGenerationJobSelect,
    });
    const currentJob = jobs[0] ?? null;
    const stageEvents = currentJob ? await loadStageEventsByJobId(currentJob.id) : [];

    return c.json({
      currentJob: currentJob ? toJobDetailDto(currentJob, stageEvents) : null,
      recentJobs: jobs.map(toJobListItemDto),
    });
  });

  contentGeneration.get("/jobs/:jobId/events", async (c) => {
    const currentUser = await requireCurrentUser(c, cfg);
    if (!currentUser) return unauthorizedResponse(c);

    const jobId = c.req.param("jobId");
    const job = await prisma.contentGenerationJob.findFirst({
      where: { id: jobId, userId: currentUser.id },
      select: contentGenerationJobSelect,
    });

    if (!job) return errorResponse(c, "内容生成任务不存在", 404);

    const stageEvents = await loadStageEventsByJobId(job.id);
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const event of stageEvents) {
          controller.enqueue(encoder.encode(`event: progress\ndata: ${JSON.stringify({
            step: event.stage,
            ts: new Date(event.createdAt).getTime(),
            message: event.message ?? event.label ?? event.stage,
          })}\n\n`));
        }
        if (job.status === ContentGenerationJobStatus.READY && job.finalJson) {
          controller.enqueue(encoder.encode(`event: complete\ndata: ${JSON.stringify({ final: toJsonValue(job.finalJson) })}\n\n`));
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  });

  return contentGeneration;
}
