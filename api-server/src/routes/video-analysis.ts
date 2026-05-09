import { Hono } from "hono";
import { Prisma, VideoAnalysisJobStatus, VideoPlatform, VideoSubtitleStatus, VideoTranscriptStatus, type VideoInputType } from "@prisma/client";
import type { AppConfig } from "../lib/config";
import { requireCurrentUser, unauthorizedResponse } from "../lib/auth";
import { errorResponse } from "../lib/http";
import { buildErrorLogContext, loggerDebug, loggerError } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { videoAnalysisJobCreateSchema } from "../lib/validation";

const BV_PATTERN = /^BV[0-9A-Za-z]{10}$/;
const BILIBILI_HOSTS = new Set(["www.bilibili.com", "m.bilibili.com", "bilibili.com"]);
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 20;
const WORKSPACE_RECENT_LIMIT = 5;

const videoSourceSelect = {
  id: true,
  platform: true,
  inputType: true,
  inputValue: true,
  normalizedBvid: true,
  normalizedUrl: true,
  title: true,
  authorName: true,
  authorMid: true,
  coverUrl: true,
  durationSeconds: true,
  publishTime: true,
  subtitleStatus: true,
  transcriptStatus: true,
  transcriptSource: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.VideoSourceSelect;

const videoAnalysisJobSelect = {
  id: true,
  userId: true,
  videoSourceId: true,
  status: true,
  errorMessage: true,
  currentStage: true,
  currentStageStatus: true,
  currentStageMessage: true,
  currentStageStartedAt: true,
  summary: true,
  structureSections: true,
  highlights: true,
  copySuggestions: true,
  healthCard: true,
  packagingAnalysis: true,
  scriptAnalysis: true,
  semanticAnalysis: true,
  internalizationSummary: true,
  metadataJson: true,
  modelName: true,
  promptVersion: true,
  workerId: true,
  lockedAt: true,
  retryCount: true,
  nextRetryAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.VideoAnalysisJobSelect;

const videoAnalysisStageEventSelect = {
  id: true,
  jobId: true,
  stage: true,
  status: true,
  message: true,
  detailsJson: true,
  startedAt: true,
  completedAt: true,
  durationMs: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.VideoAnalysisJobStageEventSelect;

type SelectedVideoSource = Prisma.VideoSourceGetPayload<{ select: typeof videoSourceSelect }>;
type SelectedVideoAnalysisJob = Prisma.VideoAnalysisJobGetPayload<{ select: typeof videoAnalysisJobSelect }>;
type SelectedVideoAnalysisStageEvent = Prisma.VideoAnalysisJobStageEventGetPayload<{ select: typeof videoAnalysisStageEventSelect }>;

type ParsedVideoAnalysisInput = {
  inputType: VideoInputType;
  inputValue: string;
  normalizedBvid: string;
  normalizedUrl: string | null;
};

type VideoAnalysisEstimateDto = {
  totalSeconds: number | null;
  remainingSeconds: number | null;
  readyAt: string | null;
  confidence: "low" | "medium" | "high";
  message: string;
};

type StageEventDto = {
  eventId: string;
  stage: string;
  status: string;
  message: string | null;
  details: Record<string, unknown> | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
};

function parseVideoAnalysisInput(rawInput: string): ParsedVideoAnalysisInput | null {
  const inputValue = rawInput.trim();

  if (BV_PATTERN.test(inputValue)) {
    return {
      inputType: "BV",
      inputValue,
      normalizedBvid: inputValue,
      normalizedUrl: `https://www.bilibili.com/video/${inputValue}`,
    };
  }

  try {
    const url = new URL(inputValue);

    if (!BILIBILI_HOSTS.has(url.hostname.toLowerCase())) {
      return null;
    }

    const match = url.pathname.match(/\/video\/(BV[0-9A-Za-z]{10})(?:\/|$)/);

    if (!match) {
      return null;
    }

    const normalizedBvid = match[1];

    return {
      inputType: "URL",
      inputValue,
      normalizedBvid,
      normalizedUrl: `https://www.bilibili.com/video/${normalizedBvid}`,
    };
  } catch {
    return null;
  }
}

function parsePage(value: string | null) {
  const parsed = Number(value ?? DEFAULT_PAGE);

  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }

  return parsed;
}

function parsePageSize(value: string | null) {
  const parsed = Number(value ?? DEFAULT_PAGE_SIZE);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_PAGE_SIZE) {
    return null;
  }

  return parsed;
}

function parseStatus(value: string | null) {
  if (!value) {
    return null;
  }

  return Object.values(VideoAnalysisJobStatus).includes(value as VideoAnalysisJobStatus)
    ? (value as VideoAnalysisJobStatus)
    : undefined;
}

function toJsonArray(value: string | null) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);

    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toJsonObject(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);

    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function toVideoSourceDto(source: SelectedVideoSource) {
  return {
    id: source.id,
    platform: source.platform,
    inputType: source.inputType,
    inputValue: source.inputValue,
    normalizedBvid: source.normalizedBvid,
    normalizedUrl: source.normalizedUrl,
    title: source.title,
    authorName: source.authorName,
    authorMid: source.authorMid,
    coverUrl: source.coverUrl,
    durationSeconds: source.durationSeconds,
    publishTime: source.publishTime,
    subtitleStatus: source.subtitleStatus,
    transcriptStatus: source.transcriptStatus,
    transcriptSource: source.transcriptSource,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
}

function toVideoAnalysisResultDto(job: SelectedVideoAnalysisJob) {
  const structureSections = toJsonArray(job.structureSections);
  const highlights = toJsonArray(job.highlights);
  const copySuggestions = toJsonArray(job.copySuggestions);
  const healthCard = toJsonObject(job.healthCard);
  const packagingAnalysis = toJsonObject(job.packagingAnalysis);
  const scriptAnalysis = toJsonObject(job.scriptAnalysis);
  const semanticAnalysis = toJsonObject(job.semanticAnalysis);
  const internalizationSummary = toJsonObject(job.internalizationSummary);
  const metadataJson = toJsonObject(job.metadataJson);

  if (
    !job.summary
    && !structureSections.length
    && !highlights.length
    && !copySuggestions.length
    && !healthCard
    && !packagingAnalysis
    && !scriptAnalysis
    && !semanticAnalysis
    && !internalizationSummary
    && !metadataJson
    && !job.modelName
    && !job.promptVersion
  ) {
    return null;
  }

  return {
    summary: job.summary,
    structureSections,
    highlights,
    copySuggestions,
    healthCard,
    packagingAnalysis,
    scriptAnalysis,
    semanticAnalysis,
    internalizationSummary,
    metadataJson,
    modelName: job.modelName,
    promptVersion: job.promptVersion,
  };
}

function toVideoAnalysisJobDetailDto(job: SelectedVideoAnalysisJob, source: SelectedVideoSource, stageEvents: StageEventDto[]) {
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
    source: toVideoSourceDto(source),
    result: toVideoAnalysisResultDto(job),
    estimate: buildVideoAnalysisEstimate(job, source, stageEvents),
  };
}

function toVideoAnalysisStageEventDto(event: SelectedVideoAnalysisStageEvent) {
  return {
    eventId: event.id,
    stage: event.stage,
    status: event.status,
    message: event.message,
    details: toJsonObject(event.detailsJson),
    startedAt: event.startedAt,
    completedAt: event.completedAt,
    durationMs: event.durationMs,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

const ALL_STAGES: string[] = [
  "SOURCE_LOAD",
  "SNAPSHOT_FETCH",
  "METADATA_SYNC",
  "TRANSCRIPT_RESOLVE",
  "ANALYSIS_PARAGRAPH_SUMMARY",
  "ANALYSIS_STRUCTURE",
  "ANALYSIS_SEMANTIC_PACKAGING",
  "ANALYSIS_FINAL_REPORT",
  "RESULT_WRITEBACK",
];

function buildVideoAnalysisEstimate(job: SelectedVideoAnalysisJob, source: SelectedVideoSource, stageEvents: StageEventDto[]): VideoAnalysisEstimateDto | null {
  if (job.status === "READY" || job.status === "FAILED") {
    return null;
  }

  const durationSeconds = source.durationSeconds;
  if (durationSeconds === null || durationSeconds === undefined) {
    return {
      totalSeconds: null,
      remainingSeconds: null,
      readyAt: null,
      confidence: "low",
      message: "正在获取视频信息，拿到时长后会给出更准确的预计时间。",
    };
  }

  const currentStage = job.currentStage;
  const currentStageIndex = currentStage ? ALL_STAGES.indexOf(currentStage) : -1;
  const progressIndex = currentStageIndex >= 0 ? currentStageIndex : 0;

  const succeededMs = stageEvents
    .filter((e) => e.status === "SUCCEEDED" && e.durationMs != null)
    .reduce((sum, e) => sum + (e.durationMs as number), 0);

  let totalSeconds: number;
  if (source.subtitleStatus === "FAILED" || source.transcriptStatus === "FAILED") {
    totalSeconds = 120;
  } else if (source.subtitleStatus === "READY" && source.transcriptStatus === "READY") {
    totalSeconds = Math.max(60, Math.round(durationSeconds * 0.5));
  } else if (source.transcriptSource === "SUBTITLE") {
    totalSeconds = Math.max(60, Math.round(durationSeconds * 0.6));
  } else {
    totalSeconds = Math.max(120, Math.round(durationSeconds * 1.5));
  }

  const totalProgressStages = Math.min(progressIndex + 1, ALL_STAGES.length);
  const estimatedElapsed = Math.round((totalProgressStages / ALL_STAGES.length) * totalSeconds);
  let remainingMs = Math.max(0, (estimatedElapsed * 1000) - succeededMs);

  if (remainingMs < 5000) {
    remainingMs = 5000;
  }

  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const readyAt = new Date(Date.now() + remainingMs).toISOString();

  let confidence: "low" | "medium" | "high" = "low";
  const completedStages = stageEvents.filter((e) => e.status === "SUCCEEDED").length;
  if (completedStages >= 3) {
    confidence = "medium";
  }
  if (completedStages >= 6) {
    confidence = "high";
  }

  const minutes = Math.max(1, Math.round(remainingSeconds / 60));
  const message = `预计还需要约 ${minutes} 分钟，可以先去忙其他，稍后回来查看。`;

  return {
    totalSeconds,
    remainingSeconds,
    readyAt,
    confidence,
    message,
  };
}

function toVideoAnalysisJobListItemDto(job: SelectedVideoAnalysisJob, source: SelectedVideoSource | null) {
  return {
    jobId: job.id,
    status: job.status,
    errorMessage: job.errorMessage,
    currentStage: job.currentStage,
    currentStageStatus: job.currentStageStatus,
    currentStageMessage: job.currentStageMessage,
    currentStageStartedAt: job.currentStageStartedAt,
    normalizedBvid: source?.normalizedBvid ?? null,
    title: source?.title ?? null,
    coverUrl: source?.coverUrl ?? null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
  };
}

async function loadSourcesByIds(sourceIds: string[]) {
  if (!sourceIds.length) {
    return new Map<string, SelectedVideoSource>();
  }

  const sources = await prisma.videoSource.findMany({
    where: { id: { in: sourceIds } },
    select: videoSourceSelect,
  });

  return new Map(sources.map((source) => [source.id, source]));
}

async function loadStageEventsByJobId(jobId: string) {
  const events = await prisma.videoAnalysisJobStageEvent.findMany({
    where: { jobId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: videoAnalysisStageEventSelect,
  });

  return events.map(toVideoAnalysisStageEventDto);
}

export function createVideoAnalysisRoutes(cfg: AppConfig) {
  const videoAnalysis = new Hono();

  videoAnalysis.post("/jobs", async (c) => {
    const routeStartedAt = Date.now();
    const currentUser = await requireCurrentUser(c, cfg);

    if (!currentUser) {
      return unauthorizedResponse(c);
    }

    try {
      loggerDebug("video_analysis.job.create.start", {
        userId: currentUser.id,
        stage: "request.parse",
      });

      const body = await c.req.json().catch(() => null);
      const parsedBody = videoAnalysisJobCreateSchema.safeParse(body);

      if (!parsedBody.success) {
        loggerDebug("video_analysis.job.create.validation_failed", {
          userId: currentUser.id,
          stage: "request.validate",
          durationMs: Date.now() - routeStartedAt,
          issue: parsedBody.error.issues[0]?.message ?? "请求参数无效",
        });
        return errorResponse(c, parsedBody.error.issues[0]?.message ?? "请求参数无效");
      }

      const parsedInput = parseVideoAnalysisInput(parsedBody.data.input);

      if (!parsedInput) {
        loggerDebug("video_analysis.job.create.invalid_input", {
          userId: currentUser.id,
          stage: "input.parse",
          inputLength: parsedBody.data.input.length,
          durationMs: Date.now() - routeStartedAt,
        });
        return errorResponse(c, "仅支持输入 B站视频链接或 BV 号");
      }

      loggerDebug("video_analysis.job.create.parsed_input", {
        userId: currentUser.id,
        stage: "input.parse",
        inputType: parsedInput.inputType,
        normalizedBvid: parsedInput.normalizedBvid,
        hasNormalizedUrl: Boolean(parsedInput.normalizedUrl),
      });

      loggerDebug("video_analysis.source.upsert.start", {
        userId: currentUser.id,
        stage: "source.upsert",
        normalizedBvid: parsedInput.normalizedBvid,
      });
      const source = await prisma.videoSource.upsert({
        where: { normalizedBvid: parsedInput.normalizedBvid },
        update: {
          ...(parsedInput.normalizedUrl ? { normalizedUrl: parsedInput.normalizedUrl } : {}),
        },
        create: {
          platform: VideoPlatform.BILIBILI,
          inputType: parsedInput.inputType,
          inputValue: parsedInput.inputValue,
          normalizedBvid: parsedInput.normalizedBvid,
          normalizedUrl: parsedInput.normalizedUrl,
          subtitleStatus: VideoSubtitleStatus.PENDING,
          transcriptStatus: VideoTranscriptStatus.PENDING,
        },
        select: {
          id: true,
          normalizedBvid: true,
        },
      });

      loggerDebug("video_analysis.source.upserted", {
        userId: currentUser.id,
        stage: "source.upsert",
        sourceId: source.id,
        normalizedBvid: source.normalizedBvid,
        durationMs: Date.now() - routeStartedAt,
      });

      loggerDebug("video_analysis.job.insert.start", {
        userId: currentUser.id,
        stage: "job.insert",
        sourceId: source.id,
        normalizedBvid: source.normalizedBvid,
      });
      const job = await prisma.videoAnalysisJob.create({
        data: {
          userId: currentUser.id,
          videoSourceId: source.id,
          status: VideoAnalysisJobStatus.PENDING,
        },
        select: {
          id: true,
          status: true,
          createdAt: true,
        },
      });

      loggerDebug("video_analysis.job.created", {
        userId: currentUser.id,
        stage: "job.insert",
        jobId: job.id,
        sourceId: source.id,
        normalizedBvid: source.normalizedBvid,
        status: job.status,
        durationMs: Date.now() - routeStartedAt,
      });

      return c.json({
        jobId: job.id,
        status: job.status,
        videoSourceId: source.id,
        normalizedBvid: source.normalizedBvid,
        createdAt: job.createdAt,
      });
    } catch (error) {
      loggerError("video_analysis.job.create.failed", {
        userId: currentUser.id,
        stage: "job.create",
        durationMs: Date.now() - routeStartedAt,
        ...buildErrorLogContext(error),
      });
      throw error;
    }
  });

  videoAnalysis.get("/jobs/:jobId", async (c) => {
    const routeStartedAt = Date.now();
    const currentUser = await requireCurrentUser(c, cfg);

    if (!currentUser) {
      return unauthorizedResponse(c);
    }

    try {
      const jobId = c.req.param("jobId");
      loggerDebug("video_analysis.job.detail.start", {
        userId: currentUser.id,
        jobId,
        stage: "job.load",
      });
      const job = await prisma.videoAnalysisJob.findFirst({
        where: {
          id: jobId,
          userId: currentUser.id,
        },
        select: videoAnalysisJobSelect,
      });

      if (!job) {
        loggerDebug("video_analysis.job.detail.not_found", {
          userId: currentUser.id,
          jobId,
          stage: "job.load",
          durationMs: Date.now() - routeStartedAt,
        });
        return errorResponse(c, "视频分析任务不存在", 404);
      }

      loggerDebug("video_analysis.job.detail.job_loaded", {
        userId: currentUser.id,
        jobId: job.id,
        sourceId: job.videoSourceId,
        status: job.status,
        stage: "job.load",
      });

      const source = await prisma.videoSource.findUnique({
        where: { id: job.videoSourceId },
        select: videoSourceSelect,
      });

      if (!source) {
        loggerDebug("video_analysis.job.detail.source_missing", {
          userId: currentUser.id,
          jobId,
          sourceId: job.videoSourceId,
          stage: "source.load",
          durationMs: Date.now() - routeStartedAt,
        });
        return errorResponse(c, "视频源不存在", 404);
      }

      loggerDebug("video_analysis.job.detail.loaded", {
        userId: currentUser.id,
        jobId: job.id,
        sourceId: source.id,
        status: job.status,
        transcriptStatus: source.transcriptStatus,
        transcriptSource: source.transcriptSource,
        hasResult: Boolean(toVideoAnalysisResultDto(job)),
        stage: "response.build",
        durationMs: Date.now() - routeStartedAt,
      });

      const stageEvents = await loadStageEventsByJobId(job.id);

      return c.json({
        ...toVideoAnalysisJobDetailDto(job, source, stageEvents),
        stageEvents,
      });
    } catch (error) {
      loggerError("video_analysis.job.detail.failed", {
        userId: currentUser.id,
        jobId: c.req.param("jobId"),
        stage: "job.detail",
        durationMs: Date.now() - routeStartedAt,
        ...buildErrorLogContext(error),
      });
      throw error;
    }
  });

  videoAnalysis.get("/jobs", async (c) => {
    const routeStartedAt = Date.now();
    const currentUser = await requireCurrentUser(c, cfg);

    if (!currentUser) {
      return unauthorizedResponse(c);
    }

    try {

      const url = new URL(c.req.url);
      const page = parsePage(url.searchParams.get("page"));
      const pageSize = parsePageSize(url.searchParams.get("pageSize"));
      const status = parseStatus(url.searchParams.get("status"));

      if (!page) {
        return errorResponse(c, "page 必须是大于等于 1 的整数");
      }

      if (!pageSize) {
        return errorResponse(c, `pageSize 必须是 1 到 ${MAX_PAGE_SIZE} 之间的整数`);
      }

      if (status === undefined) {
        return errorResponse(c, "status 参数无效");
      }

      const where = {
        userId: currentUser.id,
        ...(status ? { status } : {}),
      } satisfies Prisma.VideoAnalysisJobWhereInput;

      loggerDebug("video_analysis.job.list.start", {
        userId: currentUser.id,
        stage: "job.list",
        page,
        pageSize,
        status: status ?? null,
      });

      const [total, jobs] = await Promise.all([
        prisma.videoAnalysisJob.count({ where }),
        prisma.videoAnalysisJob.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: videoAnalysisJobSelect,
        }),
      ]);

      const sourceMap = await loadSourcesByIds([...new Set(jobs.map((job) => job.videoSourceId))]);

      loggerDebug("video_analysis.job.list.loaded", {
        userId: currentUser.id,
        stage: "response.build",
        page,
        pageSize,
        status: status ?? null,
        total,
        returnedCount: jobs.length,
        durationMs: Date.now() - routeStartedAt,
      });

      return c.json({
        page,
        pageSize,
        total,
        items: jobs.map((job) => toVideoAnalysisJobListItemDto(job, sourceMap.get(job.videoSourceId) ?? null)),
      });
    } catch (error) {
      loggerError("video_analysis.job.list.failed", {
        userId: currentUser.id,
        stage: "job.list",
        durationMs: Date.now() - routeStartedAt,
        ...buildErrorLogContext(error),
      });
      throw error;
    }
  });

  videoAnalysis.get("/workspace", async (c) => {
    const routeStartedAt = Date.now();
    const currentUser = await requireCurrentUser(c, cfg);

    if (!currentUser) {
      return unauthorizedResponse(c);
    }

    try {
      loggerDebug("video_analysis.workspace.start", {
        userId: currentUser.id,
        stage: "workspace.load",
      });

      const jobs = await prisma.videoAnalysisJob.findMany({
        where: { userId: currentUser.id },
        orderBy: { createdAt: "desc" },
        take: WORKSPACE_RECENT_LIMIT,
        select: videoAnalysisJobSelect,
      });

      const sourceMap = await loadSourcesByIds([...new Set(jobs.map((job) => job.videoSourceId))]);
      const currentJob = jobs[0] ?? null;
      const currentSource = currentJob ? sourceMap.get(currentJob.videoSourceId) ?? null : null;
      const currentStageEvents = currentJob ? await loadStageEventsByJobId(currentJob.id) : [];

      loggerDebug("video_analysis.workspace.loaded", {
        userId: currentUser.id,
        stage: "response.build",
        currentJobId: currentJob?.id ?? null,
        currentStatus: currentJob?.status ?? null,
        recentCount: jobs.length,
        durationMs: Date.now() - routeStartedAt,
      });

      return c.json({
        currentJob: currentJob && currentSource ? toVideoAnalysisJobDetailDto(currentJob, currentSource, currentStageEvents) : null,
        recentJobs: jobs.map((job) => toVideoAnalysisJobListItemDto(job, sourceMap.get(job.videoSourceId) ?? null)),
      });
    } catch (error) {
      loggerError("video_analysis.workspace.failed", {
        userId: currentUser.id,
        stage: "workspace.load",
        durationMs: Date.now() - routeStartedAt,
        ...buildErrorLogContext(error),
      });
      throw error;
    }
  });

  return videoAnalysis;
}
