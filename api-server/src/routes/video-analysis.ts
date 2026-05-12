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
const REPORT_TEMPLATE_VERSION = "html-report-v1";

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

function renderTags(items: unknown) {
  const values = getStringArray(items);

  if (!values.length) {
    return `<span class="muted">暂无</span>`;
  }

  return values.map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("");
}

function renderList(items: unknown, empty = "暂无") {
  const values = getStringArray(items);

  if (!values.length) {
    return `<p class="muted">${escapeHtml(empty)}</p>`;
  }

  return `<ol>${values.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>`;
}

function renderKeyValue(label: string, value: unknown) {
  return `
    <div class="kv-item">
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(value)}</dd>
    </div>
  `;
}

function buildVideoAnalysisReportHtml(job: SelectedVideoAnalysisJob, source: SelectedVideoSource) {
  const result = toVideoAnalysisResultDto(job);
  const healthCard = result ? getRecord(result.healthCard) : null;
  const packaging = result ? getRecord(result.packagingAnalysis) : null;
  const script = result ? getRecord(result.scriptAnalysis) : null;
  const semantic = result ? getRecord(result.semanticAnalysis) : null;
  const internalization = result ? getRecord(result.internalizationSummary) : null;
  const metadata = result ? getRecord(result.metadataJson) : null;
  const creatorPlan = getRecord(metadata?.creator_action_plan);
  const priorityFixes = getRecordArray(creatorPlan?.priority_fixes);
  const sections = result ? getRecordArray(result.structureSections) : [];
  const highlights = result ? getRecordArray(result.highlights) : [];
  const generatedAt = formatReportDate(new Date());
  const title = source.title ?? source.normalizedBvid;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: A4; margin: 16mm 14mm 18mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: oklch(0.22 0.025 252); font-family: "Noto Sans CJK SC", "Microsoft YaHei", "PingFang SC", sans-serif; line-height: 1.72; background: oklch(0.985 0.006 252); }
    .cover { min-height: 246mm; display: flex; flex-direction: column; justify-content: space-between; padding: 22mm 12mm; border-radius: 24px; background: linear-gradient(135deg, oklch(0.97 0.025 252), oklch(0.94 0.035 78)); }
    .eyebrow { font-size: 11px; font-weight: 800; letter-spacing: 0.18em; color: oklch(0.45 0.085 252); text-transform: uppercase; }
    h1 { margin: 14px 0 0; font-size: 34px; line-height: 1.18; letter-spacing: -0.04em; color: oklch(0.22 0.04 252); }
    h2 { margin: 0 0 14px; font-size: 18px; line-height: 1.35; color: oklch(0.25 0.04 252); }
    h3 { margin: 0 0 8px; font-size: 13px; color: oklch(0.33 0.055 252); }
    p { margin: 0; }
    .summary { max-width: 520px; margin-top: 18px; font-size: 14px; color: oklch(0.38 0.03 252); }
    .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 28px; }
    .meta { padding: 12px 14px; border: 1px solid oklch(0.86 0.025 252); border-radius: 16px; background: oklch(0.995 0.004 252 / 0.78); }
    .meta-label, dt { font-size: 10px; font-weight: 800; letter-spacing: 0.08em; color: oklch(0.52 0.035 252); }
    .meta-value, dd { margin: 2px 0 0; font-size: 12px; color: oklch(0.27 0.035 252); word-break: break-word; }
    .section { break-inside: avoid; margin-top: 18px; padding: 18px; border: 1px solid oklch(0.88 0.018 252); border-radius: 20px; background: oklch(0.995 0.004 252); box-shadow: 0 12px 28px oklch(0.3 0.04 252 / 0.06); }
    .page-break { break-before: page; }
    .kv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .kv-item { padding: 10px 12px; border-radius: 14px; background: oklch(0.965 0.012 252); }
    .highlight { border-color: oklch(0.78 0.11 72); background: oklch(0.965 0.045 78); }
    .fix { margin-top: 10px; padding: 12px 14px; border-radius: 16px; background: oklch(0.995 0.004 252); }
    .fix-index { display: inline-flex; min-width: 30px; justify-content: center; border-radius: 999px; background: oklch(0.48 0.11 72); color: oklch(0.98 0.01 72); font-size: 11px; font-weight: 800; }
    .muted { color: oklch(0.56 0.026 252); }
    .tags { display: flex; flex-wrap: wrap; gap: 7px; }
    .tag { display: inline-flex; padding: 4px 9px; border-radius: 999px; background: oklch(0.93 0.025 252); color: oklch(0.36 0.08 252); font-size: 11px; font-weight: 700; }
    ol { margin: 8px 0 0; padding-left: 20px; }
    li { margin: 5px 0; color: oklch(0.36 0.03 252); }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; }
    th { padding: 8px; text-align: left; background: oklch(0.94 0.016 252); color: oklch(0.34 0.05 252); }
    td { padding: 8px; border-top: 1px solid oklch(0.88 0.018 252); color: oklch(0.38 0.028 252); vertical-align: top; }
    .timeline { position: relative; display: grid; gap: 10px; }
    .timeline-item { padding: 12px 14px 12px 18px; border-left: 3px solid oklch(0.52 0.11 252); border-radius: 14px; background: oklch(0.965 0.012 252); }
    footer { margin-top: 18px; font-size: 10px; color: oklch(0.58 0.022 252); }
  </style>
</head>
<body>
  <section class="cover">
    <div>
      <div class="eyebrow">Creator Review Report</div>
      <h1>B站视频分析报告</h1>
      <p class="summary">${escapeHtml(healthCard?.one_line_summary ?? result?.summary ?? "围绕视频内容、脚本结构和传播机制生成复盘报告。")}</p>
      <div class="meta-grid">
        <div class="meta"><div class="meta-label">视频标题</div><div class="meta-value">${escapeHtml(title)}</div></div>
        <div class="meta"><div class="meta-label">BV 号</div><div class="meta-value">${escapeHtml(source.normalizedBvid)}</div></div>
        <div class="meta"><div class="meta-label">UP 主</div><div class="meta-value">${escapeHtml(source.authorName ?? "未获取")}</div></div>
        <div class="meta"><div class="meta-label">生成时间</div><div class="meta-value">${escapeHtml(generatedAt)}</div></div>
      </div>
    </div>
    <footer>任务 ID：${escapeHtml(job.id)} · 模板版本：${escapeHtml(REPORT_TEMPLATE_VERSION)}</footer>
  </section>

  <section class="section highlight page-break">
    <h2>需要修改</h2>
    ${priorityFixes.length ? priorityFixes.map((fix, index) => `
      <div class="fix">
        <span class="fix-index">P${index + 1}</span>
        <h3>问题</h3><p>${escapeHtml(fix.problem)}</p>
        <h3>原因</h3><p>${escapeHtml(fix.reason)}</p>
        <h3>直接改法</h3><p>${escapeHtml(fix.rewrite)}</p>
      </div>
    `).join("") : `<p class="muted">暂无优先修改建议。</p>`}
  </section>

  <section class="section">
    <h2>视频基础信息</h2>
    <dl class="kv-grid">
      ${renderKeyValue("标题", title)}
      ${renderKeyValue("UP 主", source.authorName ?? "未获取")}
      ${renderKeyValue("时长", source.durationSeconds === null ? null : `${Math.round(source.durationSeconds)} 秒`)}
      ${renderKeyValue("发布时间", formatReportDate(source.publishTime))}
      ${renderKeyValue("视频链接", source.normalizedUrl)}
      ${renderKeyValue("分析完成", formatReportDate(job.completedAt))}
    </dl>
  </section>

  <section class="section">
    <h2>内容摘要</h2>
    <p>${escapeHtml(result?.summary)}</p>
    <h3>核心关键词</h3>
    <div class="tags">${renderTags(healthCard?.core_keywords)}</div>
  </section>

  <section class="section">
    <h2>语义分段</h2>
    <div class="timeline">
      ${sections.length ? sections.map((section, index) => `
        <div class="timeline-item"><h3>${index + 1}. ${escapeHtml(section.title ?? `分段 ${index + 1}`)}</h3><p>${escapeHtml(section.summary)}</p></div>
      `).join("") : `<p class="muted">暂无语义分段。</p>`}
    </div>
  </section>

  <section class="section">
    <h2>标题封面分析</h2>
    <dl class="kv-grid">
      ${renderKeyValue("标题公式", packaging?.title_formulas)}
      ${renderKeyValue("心理触发", [packaging?.primary_psychology, packaging?.secondary_psychology])}
      ${renderKeyValue("关键词密度", packaging?.keyword_density)}
      ${renderKeyValue("封面文字", packaging?.cover_text)}
    </dl>
    <h3>标题钩子词</h3><div class="tags">${renderTags(packaging?.title_hook_words)}</div>
  </section>

  <section class="section">
    <h2>脚本结构分析</h2>
    <dl class="kv-grid">
      ${renderKeyValue("逻辑流", script?.logic_flow)}
      ${renderKeyValue("视觉开头", script?.visual_hook)}
      ${renderKeyValue("内容承诺", script?.promise_hook)}
      ${renderKeyValue("引导行动", script?.cta)}
    </dl>
    <table><thead><tr><th>时间</th><th>金句 / 爆点</th><th>传播原因</th></tr></thead><tbody>
      ${highlights.length ? highlights.map((item) => `<tr><td>${escapeHtml(item.timestampSeconds)}</td><td>${escapeHtml(item.quote)}</td><td>${escapeHtml(item.reason)}</td></tr>`).join("") : `<tr><td colspan="3">暂无金句 / 爆点。</td></tr>`}
    </tbody></table>
  </section>

  <section class="section">
    <h2>传播机制</h2>
    <h3>传播心理</h3><div class="tags">${renderTags(semantic?.psychological_triggers)}</div>
    <h3>语言风格</h3><div class="tags">${renderTags(semantic?.tone_tags)}</div>
    <h3>信息过载风险</h3>${renderList(semantic?.overload_warnings, "暂无信息过载风险")}
  </section>

  <section class="section">
    <h2>附录</h2>
    <dl class="kv-grid">
      ${renderKeyValue("核心信息", internalization?.core_message)}
      ${renderKeyValue("巧妙设计", internalization?.clever_design)}
      ${renderKeyValue("模型", result?.modelName)}
      ${renderKeyValue("Prompt 版本", result?.promptVersion)}
    </dl>
  </section>
</body>
</html>`;
}

async function createPdfDocument(job: SelectedVideoAnalysisJob, source: SelectedVideoSource) {
  const { chromium } = await import("playwright");
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
