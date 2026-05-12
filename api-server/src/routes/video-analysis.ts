import { Hono } from "hono";
import { Prisma, VideoAnalysisJobStatus, VideoPlatform, VideoSubtitleStatus, VideoTranscriptStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "../lib/config";
import { requireCurrentUser, unauthorizedResponse } from "../lib/auth";
import { errorResponse } from "../lib/http";
import { buildErrorLogContext, loggerDebug, loggerError } from "../lib/logger";
import { getObjectBuffer, uploadBuffer } from "../lib/minio";
import { prisma } from "../lib/prisma";
import { videoAnalysisJobCreateSchema } from "../lib/validation";
import { resolveVideoAnalysisInput } from "../lib/video-analysis-input";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 20;
const WORKSPACE_RECENT_LIMIT = 5;
const PDF_CONTENT_TYPE = "application/pdf";
const REPORT_TEMPLATE_VERSION = "html-report-v3";

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
  reportBucket: true,
  reportObjectKey: true,
  reportMinioUri: true,
  reportContentType: true,
  reportTemplateVersion: true,
  reportGeneratedAt: true,
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
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  createdAt: Date;
  updatedAt: Date;
};

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
    reportGeneratedAt: job.reportGeneratedAt,
    reportTemplateVersion: job.reportTemplateVersion,
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

function stringifyValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return value.trim() || null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    const values = value.map(stringifyValue).filter(Boolean);
    return values.length ? values.join("；") : null;
  }

  if (typeof value === "object") {
    const values = Object.entries(value)
      .map(([key, item]) => {
        const text = stringifyValue(item);
        return text ? `${key}: ${text}` : null;
      })
      .filter(Boolean);

    return values.length ? values.join("；") : null;
  }

  return null;
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function getRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(getRecord).filter((item): item is Record<string, unknown> => Boolean(item)) : [];
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringifyValue).filter((item): item is string => Boolean(item)) : [];
}

function escapeHtml(value: unknown) {
  return (stringifyValue(value) ?? "暂无")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatReportDate(value: Date | null | undefined) {
  if (!value) {
    return "暂无";
  }

  return value.toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" });
}

function formatDateShort(value: Date | null | undefined) {
  if (!value) {
    return "暂无";
  }

  return value.toLocaleDateString("zh-CN");
}

function str(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return typeof value === "string" ? value : String(value);
}

function getField(obj: Record<string, unknown> | null, key: string): unknown {
  return obj?.[key] ?? null;
}

function strField(obj: Record<string, unknown> | null, key: string): string | null {
  return str(getField(obj, key));
}

function renderInfoRow(label: string, value: unknown) {
  return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;
}

function renderBadgeList(items: unknown, cssClass: string) {
  const values = getStringArray(items);

  if (!values.length) {
    return `<span style="color:#6b7280;">暂无</span>`;
  }

  return values.map((item) => `<span class="badge ${cssClass}">${escapeHtml(item)}</span>`).join(" ");
}

function buildVideoAnalysisReportHtml(job: SelectedVideoAnalysisJob, source: SelectedVideoSource) {
  const result = toVideoAnalysisResultDto(job);
  const healthCard = result ? getRecord(result.healthCard) : null;
  const packaging = result ? getRecord(result.packagingAnalysis) : null;
  const script = result ? getRecord(result.scriptAnalysis) : null;
  const semantic = result ? getRecord(result.semanticAnalysis) : null;
  const metadata = result ? getRecord(result.metadataJson) : null;
  const creatorPlan = getRecord(metadata?.creator_action_plan);
  const priorityFixes = getRecordArray(creatorPlan?.priority_fixes);
  const sections = result ? getRecordArray(result.structureSections) : [];
  const highlights = result ? getRecordArray(result.highlights) : [];
  const rhetoricalDevices = result ? getRecordArray((semantic as Record<string, unknown> | null)?.rhetorical_devices) : [];
  const interactionDesigns = result ? getRecordArray((semantic as Record<string, unknown> | null)?.interaction_designs) : [];
  const generatedAt = formatReportDate(new Date());
  const title = source.title ?? source.normalizedBvid;
  const durationSeconds = source.durationSeconds;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>视频分析报告</title>
  <style>
    @page { size: A4; margin: 10mm 8mm 10mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: "Noto Sans CJK SC", "Microsoft YaHei", "PingFang SC", sans-serif; line-height: 1.5; color: #1a1a2e; background-color: #ffffff; }
    .container { max-width: 800px; margin: 0 auto; background-color: #ffffff; padding: 0; }
    h1 { font-size: 24px; font-weight: 700; color: #234a42; margin-bottom: 16px; border-bottom: 3px solid #234a42; padding-bottom: 8px; }
    h2 { font-size: 17px; font-weight: 600; color: #234a42; margin-top: 14px; margin-bottom: 8px; border-left: 4px solid #f0c66b; padding-left: 8px; }
    h3 { font-size: 14px; font-weight: 600; color: #2d3748; margin-top: 10px; margin-bottom: 6px; }
    p { margin-bottom: 6px; }
    .card { background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px 14px; margin-bottom: 10px; page-break-inside: auto; }
    .badge { display: inline-block; padding: 2px 7px; border-radius: 3px; font-size: 11px; font-weight: 600; margin-right: 5px; margin-bottom: 4px; }
    .badge-success { background-color: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
    .badge-warning { background-color: #fff3cd; color: #856404; border: 1px solid #ffeeba; }
    .badge-info { background-color: #d1ecf1; color: #0c5460; border: 1px solid #bee5eb; }
    .badge-danger { background-color: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 12px; }
    th, td { border: 1px solid #e2e8f0; padding: 5px 8px; text-align: left; vertical-align: top; }
    th { background-color: #f8f9fa; font-weight: 600; color: #2d3748; width: 120px; }
    table.wide-table th { width: auto; }
    .alert { padding: 8px 10px; border-radius: 4px; margin: 8px 0; font-size: 12px; }
    .alert-warning { background-color: #fff3cd; border: 1px solid #ffeeba; color: #856404; }
    .alert-success { background-color: #d4edda; border: 1px solid #c3e6cb; color: #155724; }
    .alert-info { background-color: #d1ecf1; border: 1px solid #bee5eb; color: #0c5460; }
    ul, ol { margin-left: 16px; margin-bottom: 8px; }
    li { margin-bottom: 3px; font-size: 12px; }
    .fix-card { background-color: #f8f9fa; border: 1px solid #e2e8f0; border-radius: 4px; padding: 10px; margin-bottom: 8px; }
    .p-badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px; font-weight: 700; margin-right: 6px; }
    .p-badge-1 { background-color: #f8d7da; color: #721c24; }
    .p-badge-2 { background-color: #fff3cd; color: #856404; }
    .p-badge-3 { background-color: #d1ecf1; color: #0c5460; }
    .section-tags { margin-top: 6px; }
    @media print { body { padding: 0; background-color: #ffffff; } .container { box-shadow: none; padding: 0; } }
  </style>
</head>
<body>
  <div class="container">
    <h1>视频分析报告</h1>

    <div class="card">
      <h2>视频基础信息</h2>
      <table>
        ${renderInfoRow("标题", title)}
        ${renderInfoRow("UP 主", source.authorName ?? "未获取")}
        ${renderInfoRow("时长", durationSeconds === null ? null : `${Math.round(durationSeconds)} 秒`)}
        ${renderInfoRow("BV 号", source.normalizedBvid)}
        ${source.publishTime ? renderInfoRow("发布时间", formatDateShort(source.publishTime)) : ""}
        ${renderInfoRow("生成时间", generatedAt)}
      </table>
    </div>

    ${result ? `
    <div class="card">
      <h2>内容摘要</h2>
      <p>${escapeHtml(result.summary)}</p>
      ${healthCard?.one_line_summary ? `<p><strong>一句话总结：</strong>${escapeHtml(healthCard.one_line_summary)}</p>` : ""}
      ${healthCard?.core_keywords ? `<div class="section-tags"><strong>核心关键词：</strong>${renderBadgeList(healthCard.core_keywords, "badge-info")}</div>` : ""}
    </div>

    ${priorityFixes.length ? `
    <div class="card">
      <h2>需要修改</h2>
      <div class="alert alert-warning"><p>先处理会影响点击、停留和互动的关键问题。每条建议都包含问题、原因和直接改法。</p></div>
      ${priorityFixes.map((fix, index) => `
        <div class="fix-card">
          <h3><span class="p-badge p-badge-${index + 1}">P${index + 1}</span> 问题</h3>
          <p>${escapeHtml(fix.problem)}</p>
          <h3>原因</h3>
          <p>${escapeHtml(fix.reason)}</p>
          ${fix.rewrite ? `<h3>直接改法</h3><p>${escapeHtml(fix.rewrite)}</p>` : ""}
        </div>
      `).join("")}
    </div>` : ""}

    ${creatorPlan ? `
    ${getStringArray(creatorPlan.keep_points).length ? `
    <div class="card">
      <h2>下次继续保留</h2>
      <ul>${getStringArray(creatorPlan.keep_points).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </div>` : ""}

    ${getStringArray(creatorPlan.reuse_template).length ? `
    <div class="card">
      <h2>下一条视频复用模板</h2>
      <ul>${getStringArray(creatorPlan.reuse_template).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </div>` : ""}` : ""}

    ${sections.length ? `
    <div class="card">
      <h2>语义分段</h2>
      <table class="wide-table">
        <tr><th>时间段</th><th>内容摘要</th></tr>
        ${sections.map((section) => {
          const start = typeof section.startSeconds === "number" ? `${Math.floor(section.startSeconds / 60)}:${String(Math.round(section.startSeconds % 60)).padStart(2, "0")}` : "";
          const end = typeof section.endSeconds === "number" ? `${Math.floor(section.endSeconds / 60)}:${String(Math.round(section.endSeconds % 60)).padStart(2, "0")}` : "";
          const timeLabel = start || end ? `${start} 至 ${end}` : "";
          return `<tr><td>${escapeHtml(timeLabel || section.title || "段落")}</td><td>${escapeHtml(section.summary)}</td></tr>`;
        }).join("")}
      </table>
    </div>` : ""}

    ${packaging ? `
    <div class="card">
      <h2>标题封面分析</h2>
      <table>
        ${packaging.title_formulas ? renderInfoRow("标题公式", packaging.title_formulas) : ""}
        ${packaging.primary_psychology ? renderInfoRow("心理触发", [packaging.primary_psychology, packaging.secondary_psychology]) : ""}
        ${packaging.keyword_density ? renderInfoRow("关键词密度", packaging.keyword_density) : ""}
        ${packaging.cover_text ? renderInfoRow("封面文字", packaging.cover_text) : ""}
      </table>
      ${packaging.title_hook_words || packaging.keywords ? `<div class="section-tags"><strong>关键词：</strong>${renderBadgeList([...getStringArray(packaging.title_hook_words), ...getStringArray(packaging.keywords)], "badge-info")}</div>` : ""}
    </div>` : ""}

    ${script ? `
    <div class="card">
      <h2>脚本结构分析</h2>
      <h3>脚本主线</h3>
      <table>
        ${strField(script, "logic_flow") ? renderInfoRow("逻辑流", strField(script, "logic_flow")) : ""}
        ${(() => {
          const hook = getRecord(getField(script, "visual_hook"));
          if (!hook) return "";
          return renderInfoRow("开头吸引点", [strField(hook, "text"), strField(hook, "type") ? `类型：${strField(hook, "type")}` : "", hook.hook_score != null ? `吸引力评分 ${hook.hook_score} 分，满分 10 分` : ""].filter(Boolean).join("；"));
        })()}
        ${(() => {
          const promise = getRecord(getField(script, "promise_hook"));
          if (!promise) return "";
          return renderInfoRow("内容承诺", [strField(promise, "text"), strField(promise, "type") ? `类型：${strField(promise, "type")}` : "", promise.hook_score != null ? `吸引力评分 ${promise.hook_score} 分，满分 10 分` : ""].filter(Boolean).join("；"));
        })()}
${(() => {
          const cta = getRecord(getField(script, "cta"));
          return cta ? renderInfoRow("引导行动", [strField(cta, "text"), strField(cta, "cta_type") ? `类型：${strField(cta, "cta_type")}` : "", strField(cta, "optimization_hint") ? `优化提示：${strField(cta, "optimization_hint")}` : ""].filter(Boolean).join("；")) : "";
        })()}
      </table>

      ${(() => {
        const blocks = getField(script, "structural_blocks");
        const blockLabels: Record<string, string> = { hook: "开头抓注意力", promise: "内容承诺", re_hook: "二次留存", cta: "引导行动" };
        const entries: Array<{ label: string; summary: string }> = [];
        for (const key of ["hook", "promise", "re_hook", "cta"] as const) {
          const value = getField(getRecord(blocks), key);
          const rec = getRecord(value);
          if (rec) {
            entries.push({ label: blockLabels[key], summary: strField(rec, "summary") ?? "" });
          } else if (typeof value === "string" && value.trim()) {
            entries.push({ label: blockLabels[key], summary: value });
          }
        }
        const meat = getField(getRecord(blocks), "meat");
        if (Array.isArray(meat)) {
          for (const item of meat) {
            const rec = getRecord(item);
            if (rec) {
              entries.push({ label: strField(rec, "name") || "主体内容", summary: strField(rec, "summary") ?? "" });
            }
          }
        }
        return entries.length ? `
          <h3>结构块</h3>
          <table class="wide-table">
            <tr><th>结构块</th><th>摘要</th></tr>
            ${entries.map((entry) => `<tr><td>${escapeHtml(entry.label)}</td><td>${escapeHtml(entry.summary)}</td></tr>`).join("")}
          </table>
        ` : "";
      })()}

      ${(() => {
        const hooks = getField(script, "segment_hooks");
        if (!Array.isArray(hooks) || !hooks.length) return "";
        const usages = ["放在开头承诺之后，用来把观众从好奇心带入正文第一段。", "放在一个观点讲完后，用反差或新问题打开下一段，避免平铺直叙。", "放在信息变密前，提前告诉观众接下来更关键，降低中段流失。", "放在结论或 CTA 前，把前面的内容收束成行动理由。"];
        return `
          <h3>段落转折吸引点</h3>
          <table class="wide-table">
            <tr><th>位置</th><th>当前转折句</th><th>当前作用</th><th>适合用法</th></tr>
            ${hooks.map((item: unknown, index: number) => {
              const h = getRecord(item);
              return `<tr><td>${escapeHtml(strField(h, "time") ?? `第 ${index + 1} 个转折点`)}</td><td>${escapeHtml(strField(h, "text"))}</td><td>${escapeHtml(strField(h, "function") ?? "承接上一段并推动继续观看。")}</td><td>${escapeHtml(usages[index % usages.length])}</td></tr>`;
            }).join("")}
          </table>
        `;
      })()}

      ${highlights.length ? `
        <h3>金句 / 爆点</h3>
        <table class="wide-table">
          <tr><th>节点 / 时间</th><th>内容</th><th>作用</th></tr>
          ${highlights.map((item: Record<string, unknown>) => {
            const ts = item.timestampSeconds;
            const timeLabel = typeof ts === "number" ? `${Math.floor(ts / 60)}:${String(Math.round(ts % 60)).padStart(2, "0")}` : escapeHtml(strField(getRecord(item), "timestampSeconds"));
            return `<tr><td>${timeLabel}</td><td>${escapeHtml(strField(getRecord(item), "quote"))}</td><td>${escapeHtml(strField(getRecord(item), "reason"))}</td></tr>`;
          }).join("")}
        </table>
      ` : ""}
    </div>` : ""}

    ${semantic ? `
    <div class="card">
      <h2>语义与传播机制</h2>

      ${semantic.overload_warnings && Array.isArray(semantic.overload_warnings) && semantic.overload_warnings.length ? `
        <div class="alert alert-warning">
          <p><strong>信息过载风险</strong></p>
          <p>这些片段信息密度较高，观众可能跟不上节奏，适合优先检查是否需要拆句、补解释或放慢节奏。</p>
          <p>${semantic.overload_warnings.map((w: unknown) => escapeHtml(w)).join("；")}</p>
        </div>
      ` : ""}

      <table>
        ${semantic.cognitive_load ? renderInfoRow("理解难度", semantic.cognitive_load) : ""}
      </table>

      <table>
        ${semantic.tone_tags ? renderInfoRow("语言风格", semantic.tone_tags) : ""}
        ${semantic.net_slang ? renderInfoRow("网感词", semantic.net_slang) : ""}
      </table>

      ${semantic.psychological_triggers ? `
        <h3>传播心理</h3>
        <p>先看这条视频主要调用了哪些心理，再对照具体修辞证据，判断点击、停留和转发靠什么成立。</p>
        <div class="section-tags">${renderBadgeList(semantic.psychological_triggers, "badge-danger")}</div>
      ` : ""}

      ${rhetoricalDevices.length ? `
        <h3>修辞证据</h3>
        <table class="wide-table">
          <tr><th>修辞类型</th><th>出现位置</th><th>原句</th><th>传播作用</th></tr>
          ${rhetoricalDevices.map((item) => {
            const timeRange = item.time_range ? (typeof item.time_range === "object" ? [escapeHtml((item.time_range as Record<string, unknown>).start), escapeHtml((item.time_range as Record<string, unknown>).end)].filter(Boolean).join(" 至 ") : escapeHtml(item.time_range)) : "";
            return `<tr><td>${escapeHtml(item.type)}</td><td>${timeRange || "未标注"}</td><td>${escapeHtml(item.text_snippet)}</td><td>${escapeHtml(item.mechanism)}</td></tr>`;
          }).join("")}
        </table>
      ` : ""}

      ${interactionDesigns.length ? `
        <h3>互动设计</h3>
        <table class="wide-table">
          <tr><th>互动类型</th><th>出现时间</th><th>触发文案</th><th>预期反应</th><th>放置策略</th></tr>
          ${interactionDesigns.map((item: Record<string, unknown>) => `<tr><td>${escapeHtml(strField(getRecord(item), "type"))}</td><td>${escapeHtml(strField(getRecord(item), "time"))}</td><td>${escapeHtml(strField(getRecord(item), "trigger_text"))}</td><td>${escapeHtml(strField(getRecord(item), "expected_response"))}</td><td>${escapeHtml(strField(getRecord(item), "placement_strategy"))}</td></tr>`).join("")}
        </table>
      ` : ""}
    </div>` : ""}

    <div class="card">
      <h2>分析结果</h2>

      ${packaging ? `
      <h3>包装层</h3>
      <table class="wide-table">
        <tr><th>结果项</th><th>当前结果</th><th>分析原因</th></tr>
        ${packaging.title_formulas ? `<tr><td>标题公式</td><td>${escapeHtml(packaging.title_formulas)}</td><td>这些元素能让观众更快判断看懂，有利于增加点击率。</td></tr>` : ""}
        ${packaging.primary_psychology ? `<tr><td>心理触发</td><td>${escapeHtml([packaging.primary_psychology, packaging.secondary_psychology].filter(Boolean).join(" / "))}</td><td>明确心理触发后，更容易判断内容靠什么驱动用户点开。</td></tr>` : ""}
        ${packaging.keyword_density ? `<tr><td>关键词密度</td><td>${escapeHtml(packaging.keyword_density)}</td><td>关键词清楚能降低理解成本，也更利于搜索、推荐和记忆。</td></tr>` : ""}
      </table>
      ` : ""}

      ${script ? `
      <h3>脚本层</h3>
      <table class="wide-table">
        <tr><th>结果项</th><th>当前结果</th><th>分析原因</th></tr>
        ${getField(script, "visual_hook") ? `<tr><td>前 3 秒</td><td>${escapeHtml(strField(getRecord(getField(script, "visual_hook")), "text"))}</td><td>前 3 秒抓住注意力，能减少刚进来就划走的流失。</td></tr>` : ""}
        ${getField(script, "promise_hook") ? `<tr><td>3 到 15 秒</td><td>${escapeHtml(strField(getRecord(getField(script, "promise_hook")), "text"))}</td><td>明确收益能把好奇心转成继续观看的理由。</td></tr>` : ""}
        ${strField(script, "logic_flow") ? `<tr><td>正文骨架</td><td>${escapeHtml(strField(script, "logic_flow"))}</td><td>结构清楚能让观众跟住信息推进，降低中途退出概率。</td></tr>` : ""}
        ${Array.isArray(getField(script, "segment_hooks")) ? `<tr><td>段落转折</td><td>${(getField(script, "segment_hooks") as unknown[]).length} 个</td><td>段落间有牵引力，观众更容易从一个观点进入下一个观点。</td></tr>` : ""}
      </table>
      ` : ""}

      ${semantic ? `
      <h3>互动层</h3>
      <table class="wide-table">
        <tr><th>结果项</th><th>当前结果</th><th>分析原因</th></tr>
        ${interactionDesigns.length ? `<tr><td>互动设计</td><td>${interactionDesigns.length} 个</td><td>互动点能把观看行为转成反馈信号，帮助内容继续分发。</td></tr>` : ""}
        ${getField(script ?? {}, "cta") ? `<tr><td>引导行动</td><td>${escapeHtml(strField(getRecord(getField(script ?? {}, "cta")), "text"))}</td><td>明确行动能减少观众犹豫，让内容获得更多后续动作。</td></tr>` : ""}
        ${highlights.length ? `<tr><td>金句数量</td><td>${highlights.length} 个</td><td>金句越容易被摘出，越利于评论区复述和二次传播。</td></tr>` : ""}
        ${semantic ? (getStringArray((semantic as Record<string, unknown>).net_slang).length ? `<tr><td>网感词</td><td>${escapeHtml(getStringArray((semantic as Record<string, unknown>).net_slang).join("、"))}</td><td>语感贴进能降低距离感，让目标观众更愿意互动。</td></tr>` : "") : ""}
      </table>
      ` : ""}
    </div>
    ` : `<div class="card"><p>当前任务暂无可导出的分析结果。</p></div>`}
  </div>
</body>
</html>`;
}

async function createPdfDocument(job: SelectedVideoAnalysisJob, source: SelectedVideoSource) {
  const { chromium } = await import("patchright");
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 1240, height: 1754 } });
    await page.setContent(buildVideoAnalysisReportHtml(job, source), { waitUntil: "load" });
    return Buffer.from(await page.pdf({ format: "A4", printBackground: true }));
  } finally {
    await browser.close();
  }
}

function buildSafeReportFilename(source: SelectedVideoSource) {
  const base = source.normalizedBvid || "video-analysis";
  return `video-analysis-${base.replace(/[^a-zA-Z0-9_-]/g, "")}.pdf`;
}

function buildReportObjectKey(userId: string, jobId: string) {
  return `video-analysis-reports/${userId}/${jobId}-${Date.now()}-${randomUUID()}.pdf`;
}

async function loadCachedReportBuffer(cfg: AppConfig["minio"], job: SelectedVideoAnalysisJob) {
  if (
    !job.reportObjectKey
    || job.reportContentType !== PDF_CONTENT_TYPE
    || job.reportTemplateVersion !== REPORT_TEMPLATE_VERSION
  ) {
    return null;
  }

  try {
    return await getObjectBuffer(cfg, job.reportObjectKey);
  } catch (error) {
    loggerError("video_analysis.job.report.cache_read_failed", {
      jobId: job.id,
      reportObjectKey: job.reportObjectKey,
      stage: "report.cache.read",
      ...buildErrorLogContext(error),
    });
    return null;
  }
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

      const parsedInput = await resolveVideoAnalysisInput(parsedBody.data.input);

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

  videoAnalysis.get("/jobs/:jobId/report", async (c) => {
    const routeStartedAt = Date.now();
    const currentUser = await requireCurrentUser(c, cfg);

    if (!currentUser) {
      return unauthorizedResponse(c);
    }

    try {
      const jobId = c.req.param("jobId");
      const job = await prisma.videoAnalysisJob.findFirst({
        where: {
          id: jobId,
          userId: currentUser.id,
        },
        select: videoAnalysisJobSelect,
      });

      if (!job) {
        return errorResponse(c, "视频分析任务不存在", 404);
      }

      const result = toVideoAnalysisResultDto(job);
      if (job.status !== VideoAnalysisJobStatus.READY || !result) {
        return errorResponse(c, "视频分析报告尚未生成完成", 409);
      }

      const source = await prisma.videoSource.findUnique({
        where: { id: job.videoSourceId },
        select: videoSourceSelect,
      });

      if (!source) {
        return errorResponse(c, "视频源不存在", 404);
      }

      let pdfBuffer = await loadCachedReportBuffer(cfg.minio, job);
      let cacheStatus: "HIT" | "MISS" = pdfBuffer ? "HIT" : "MISS";

      if (!pdfBuffer) {
        pdfBuffer = await createPdfDocument(job, source);
        const storedReport = await uploadBuffer(cfg.minio, {
          objectKey: buildReportObjectKey(currentUser.id, job.id),
          buffer: pdfBuffer,
          contentType: PDF_CONTENT_TYPE,
        });

        await prisma.videoAnalysisJob.update({
          where: { id: job.id },
          data: {
            reportBucket: storedReport.bucket,
            reportObjectKey: storedReport.objectKey,
            reportMinioUri: storedReport.minioUri,
            reportContentType: PDF_CONTENT_TYPE,
            reportTemplateVersion: REPORT_TEMPLATE_VERSION,
            reportGeneratedAt: new Date(),
          },
        });
        cacheStatus = "MISS";
      }

      const filename = buildSafeReportFilename(source);

      loggerDebug("video_analysis.job.report.ready", {
        userId: currentUser.id,
        jobId: job.id,
        sourceId: source.id,
        byteLength: pdfBuffer.byteLength,
        cacheStatus,
        stage: "report.download",
        durationMs: Date.now() - routeStartedAt,
      });

      return new Response(pdfBuffer, {
        status: 200,
        headers: {
          "Content-Type": PDF_CONTENT_TYPE,
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (error) {
      loggerError("video_analysis.job.report.failed", {
        userId: currentUser.id,
        jobId: c.req.param("jobId"),
        stage: "report.download",
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
