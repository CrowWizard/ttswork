"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { StatusMessage } from "@/components/ui/status-message";
import { readJsonSafely, toUserFacingErrorMessage } from "@/components/voice-studio/utils";

type VideoAnalysisJobStatus = "PENDING" | "PROCESSING" | "READY" | "FAILED";
type VideoAnalysisStage =
  | "SOURCE_LOAD"
  | "SNAPSHOT_FETCH"
  | "METADATA_SYNC"
  | "TRANSCRIPT_RESOLVE"
  | "ANALYSIS_PARAGRAPH_SUMMARY"
  | "ANALYSIS_STRUCTURE"
  | "ANALYSIS_SEMANTIC_PACKAGING"
  | "ANALYSIS_FINAL_REPORT"
  | "RESULT_WRITEBACK"
  | "FAILED_WRITEBACK";
type VideoAnalysisStageEventStatus = "RUNNING" | "SUCCEEDED" | "FAILED";

type VideoAnalysisSource = {
  normalizedBvid: string;
  inputValue: string | null;
  normalizedUrl: string | null;
  title: string | null;
  authorName: string | null;
  coverUrl: string | null;
  durationSeconds: number | null;
  publishTime: string | null;
  subtitleStatus: string;
  transcriptStatus: string;
  transcriptSource: string | null;
};

type StructureSection = {
  title: string;
  startSeconds: number;
  endSeconds: number;
  summary: string;
};

type Highlight = {
  quote: string;
  reason: string;
  timestampSeconds: number;
};

type CopySuggestion = {
  type: string;
  content: string;
};

type HealthCard = {
  one_line_summary?: string;
  core_keywords?: string[];
  has_hook?: boolean;
  has_cta?: boolean;
  hook_and_cta_quotes?: string[];
};

type PackagingAnalysis = {
  title_formulas?: string[];
  title_hook_words?: string[];
  primary_psychology?: string;
  secondary_psychology?: string | null;
  keywords?: string[];
  keyword_density?: string;
  seo_friendly?: boolean;
  cover_text?: string | null;
  cover_relation?: string;
  visual_emotion?: string;
  color_scheme?: string[] | null;
  typography_emotion?: string | null;
};

type StructureBlockSuggestion = {
  type?: string;
  target_time?: string;
  content?: string;
  target_seconds?: number | null;
  target_percent?: number | null;
};

type StructureBlockDetail = {
  name?: string;
  summary?: string;
  strengths?: string[];
  weaknesses?: string[];
  suggestions?: StructureBlockSuggestion[];
};

type ScriptAnalysisStructuralBlocks = {
  hook?: StructureBlockDetail | string | null;
  promise?: StructureBlockDetail | string | null;
  meat?: Array<StructureBlockDetail | string>;
  re_hook?: StructureBlockDetail | string | null;
  cta?: StructureBlockDetail | string | null;
};

type HookDetail = {
  text?: string;
  time?: string;
  type?: string;
  mechanism?: string;
  hook_score?: number;
};

type ScriptAnalysis = {
  visual_hook?: HookDetail | null;
  promise_hook?: HookDetail | null;
  segment_hooks?: Array<{ time?: string; text?: string; function?: string; hook_score?: number }>;
  narrative_arc?: Array<{ time?: string; event?: string }>;
  narrative_curve_text?: string | null;
  structural_blocks?: ScriptAnalysisStructuralBlocks;
  quotes?: Array<{ text?: string; time?: string; viral_reason?: string; share_scenario?: string }>;
  cta?: { text?: string; time?: string; cta_type?: string; optimization_hint?: string | null } | null;
  logic_flow?: string;
};

type SemanticAnalysis = {
  psychological_triggers?: string[];
  rhetorical_devices?: Array<{ type?: string; text_snippet?: string; mechanism?: string; time_range?: { start?: string; end?: string } }>;
  tone_tags?: string[];
  net_slang?: string[];
  persona_catchphrases?: string[];
  interaction_designs?: Array<{ type?: string; trigger_text?: string; time?: string; expected_response?: string; placement_strategy?: string }>;
  knowledge_density_curve?: Array<{ topic?: string; density?: number; time_range?: { start?: string; end?: string } }>;
  cognitive_load?: string;
  overload_warnings?: string[];
  emotion_curve?: Array<{ time?: string; emotion?: string }>;
};

type InternalizationSummary = {
  core_message?: string;
  clever_design?: string;
  optimization?: string;
};

type CreatorFix = {
  priority?: string | number;
  problem?: string;
  reason?: string;
  rewrite?: string;
};

type CreatorActionPlan = {
  keep_points?: string[];
  priority_fixes?: CreatorFix[];
  title_rewrites?: string[];
  opening_rewrites?: string[];
  cta_rewrites?: string[];
  overload_rewrites?: string[];
  reuse_template?: string[];
};

type MetadataJson = {
  video_duration?: string | null;
  hook_score?: number | null;
  retention_risk_points?: string[];
  golden_quote_count?: number | null;
  interaction_count?: number | null;
  cognitive_load_distribution?: Record<string, number>;
  narrative_curve_text?: string | null;
  structural_blocks?: ScriptAnalysisStructuralBlocks;
  creator_action_plan?: CreatorActionPlan;
};

type VideoAnalysisResult = {
  summary: string | null;
  structureSections: StructureSection[];
  highlights: Highlight[];
  copySuggestions: CopySuggestion[];
  healthCard: HealthCard | null;
  packagingAnalysis: PackagingAnalysis | null;
  scriptAnalysis: ScriptAnalysis | null;
  semanticAnalysis: SemanticAnalysis | null;
  internalizationSummary: InternalizationSummary | null;
  metadataJson: MetadataJson | null;
  modelName: string | null;
  promptVersion: string | null;
};

type VideoAnalysisEstimate = {
  totalSeconds: number | null;
  remainingSeconds: number | null;
  readyAt: string | null;
  confidence: "low" | "medium" | "high";
  message: string;
};

type VideoAnalysisJobDetail = {
  jobId: string;
  status: VideoAnalysisJobStatus;
  errorMessage: string | null;
  currentStage: VideoAnalysisStage | null;
  currentStageStatus: VideoAnalysisStageEventStatus | null;
  currentStageMessage: string | null;
  currentStageStartedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  source: VideoAnalysisSource;
  result: VideoAnalysisResult | null;
  stageEvents: VideoAnalysisStageEvent[];
  estimate: VideoAnalysisEstimate | null;
};

type TableRow = {
  label: string;
  value: string | null | undefined;
};

type MobileTableRow = {
  title: string;
  fields: TableRow[];
};

type AuditRow = {
  layer: string;
  subject: string;
  result: string | null | undefined;
  benefit: string;
};

type DerivedCreatorAction = {
  issue: string;
  rewrite: string;
  example: string;
};

type VideoAnalysisStageEvent = {
  eventId: string;
  stage: VideoAnalysisStage;
  status: VideoAnalysisStageEventStatus;
  message: string | null;
  details: Record<string, unknown> | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
};

type CreateJobResponse = {
  jobId?: string;
  status?: VideoAnalysisJobStatus;
  error?: string;
  message?: string;
};

const STATUS_TEXT: Record<VideoAnalysisJobStatus, string> = {
  PENDING: "等待 worker 领取",
  PROCESSING: "正在分析",
  READY: "分析完成",
  FAILED: "分析失败",
};

const STAGE_TEXT: Record<VideoAnalysisStage, string> = {
  SOURCE_LOAD: "加载视频源",
  SNAPSHOT_FETCH: "抓取视频信息",
  METADATA_SYNC: "同步视频元信息",
  TRANSCRIPT_RESOLVE: "获取字幕或转写",
  ANALYSIS_PARAGRAPH_SUMMARY: "长字幕压缩分段",
  ANALYSIS_STRUCTURE: "提取脚本结构",
  ANALYSIS_SEMANTIC_PACKAGING: "分析包装与语义",
  ANALYSIS_FINAL_REPORT: "生成最终报告",
  RESULT_WRITEBACK: "写回分析结果",
  FAILED_WRITEBACK: "写回失败状态",
};

const POLL_INTERVAL_MS = 2500;
const STORAGE_KEY = "bilibili-analysis:last-job";

type CachedJob = {
  jobId: string;
  input: string;
};

export function BilibiliAnalysisWorkspace() {
  const [input, setInput] = useState("");
  const [creating, setCreating] = useState(false);
  const [polling, setPolling] = useState(false);
  const [jobDetail, setJobDetail] = useState<VideoAnalysisJobDetail | null>(null);
  const [message, setMessage] = useState<{ type: "error" | "success" | "info" | "warning"; title: string; text: string } | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const cachedJob = readCachedJob();
    if (cachedJob) {
      setInput(cachedJob.input);
      setMessage({ type: "info", title: "已恢复上次任务", text: `正在读取任务 ${cachedJob.jobId} 的分析结果。` });
      void pollJob(cachedJob.jobId);
    }

    return () => {
      if (pollTimerRef.current) {
        window.clearTimeout(pollTimerRef.current);
      }
    };
    // 仅在页面首次加载时恢复上次任务，后续轮询由 pollJob 接管。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopPolling = () => {
    if (pollTimerRef.current) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setPolling(false);
  };

  const loadJobDetail = async (jobId: string) => {
    const response = await fetch(`/api/video-analysis/jobs/${jobId}`, {
      cache: "no-store",
      credentials: "include",
    });
    const data = await readJsonSafely(response);

    if (!response.ok) {
      throw new Error(_extractErrorMessage(data, "读取分析状态失败"));
    }

    return data as VideoAnalysisJobDetail;
  };

  const schedulePoll = (jobId: string) => {
    pollTimerRef.current = window.setTimeout(() => {
      void pollJob(jobId);
    }, POLL_INTERVAL_MS);
  };

  const pollJob = async (jobId: string) => {
    try {
      const detail = await loadJobDetail(jobId);
      setJobDetail(detail);
      writeCachedJob({ jobId: detail.jobId, input: detail.source.inputValue ?? input });

      if (detail.status === "READY") {
        stopPolling();
        setMessage({ type: "success", title: "分析完成", text: "分析结果已更新，可查看摘要、语义分段、标题封面分析、脚本结构和语义机制。" });
        return;
      }

      if (detail.status === "FAILED") {
        stopPolling();
        clearCachedJob();
        setMessage({ type: "error", title: "分析失败", text: detail.errorMessage ?? "视频分析任务失败" });
        return;
      }

      setPolling(true);
      setMessage({
        type: "info",
        title: detail.currentStage ? getStageLabel(detail.currentStage) : STATUS_TEXT[detail.status],
        text: detail.currentStageMessage ?? "任务已提交，页面会自动刷新处理状态。",
      });
      schedulePoll(jobId);
    } catch (error) {
      stopPolling();
      setMessage({ type: "error", title: "状态读取失败", text: toUserFacingErrorMessage(error, "读取分析状态失败") });
    }
  };

  const handleSubmit = async () => {
    const trimmedInput = input.trim();
    if (!trimmedInput) {
      setMessage({ type: "warning", title: "请输入视频", text: "请输入 B 站视频链接或 BV 号后再开始分析。" });
      return;
    }

    stopPolling();
    setCreating(true);
    setJobDetail(null);
    setMessage({ type: "info", title: "正在创建任务", text: "正在提交视频分析任务。" });

    try {
      const response = await fetch("/api/video-analysis/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ input: trimmedInput }),
      });
      const data = (await readJsonSafely(response)) as CreateJobResponse;

      if (!response.ok || !data.jobId) {
        throw new Error(_extractErrorMessage(data, "创建分析任务失败"));
      }

      writeCachedJob({ jobId: data.jobId, input: trimmedInput });
      setMessage({ type: "info", title: "任务已创建", text: `任务 ${data.jobId} 已进入队列，正在等待 worker 处理。` });
      setPolling(true);
      await pollJob(data.jobId);
    } catch (error) {
      stopPolling();
      setMessage({ type: "error", title: "创建失败", text: toUserFacingErrorMessage(error, "创建分析任务失败") });
    } finally {
      setCreating(false);
    }
  };

  const isBusy = creating || polling;

  return (
    <main className="flex min-h-screen w-full min-w-0 flex-col overflow-x-hidden">
      <AppHeader />
      <div className="mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
          <section className="app-card p-6 sm:p-8">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">B站视频分析</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-text-muted sm:text-base">
              输入视频链接或 BV 号，生成摘要、语义分段、标题封面分析、脚本结构和语义机制。
            </p>
          </section>

          <section className="app-card p-6 sm:p-8">
            <div className="flex flex-col gap-5">
              <div>
                <label htmlFor="video-analysis-input" className="text-sm font-semibold text-text-primary">
                  视频链接或 BV 号
                </label>
                <input
                  id="video-analysis-input"
                  className="app-input"
                  type="text"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !isBusy) {
                      event.preventDefault();
                      void handleSubmit();
                    }
                  }}
                  placeholder="例如 https://www.bilibili.com/video/BV... 或 BV1xx411c7mD"
                  disabled={isBusy}
                />
                <p className="mt-3 text-sm leading-6 text-text-muted">支持输入完整视频链接或以 BV 开头的编号。</p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className="app-button-primary disabled:cursor-not-allowed disabled:opacity-60" onClick={handleSubmit} disabled={isBusy}>
                  {creating ? "创建中" : polling ? "分析中" : "开始分析"}
                </button>
                <p className="text-sm leading-6 text-text-muted">提交后页面会自动刷新任务状态，worker 完成后展示结果。</p>
              </div>

              {message ? <StatusMessage type={message.type} title={message.title} message={message.text} /> : null}
            </div>
          </section>

          <section className="app-card p-6 sm:p-8">
            <div className="flex flex-col gap-6">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-lg font-semibold text-text-primary">分析结果</h2>
                  {jobDetail ? <StatusBadge status={jobDetail.status} /> : null}
                </div>
                <p className="mt-2 text-sm leading-6 text-text-muted">
                  {jobDetail ? `任务 ${jobDetail.jobId}` : "先输入视频链接或 BV 号。分析完成后，这里会输出摘要、语义分段、标题封面分析、脚本结构和语义机制。"}
                </p>
                {jobDetail ? (
                  <p className="mt-1 break-all text-sm leading-6 text-text-muted">
                    输入视频：{jobDetail.source.inputValue ?? jobDetail.source.normalizedBvid}
                  </p>
                ) : null}
              </div>

              {jobDetail ? <StageProgressPanel detail={jobDetail} /> : null}

              {jobDetail ? <JobResult detail={jobDetail} /> : <ResultPlaceholder />}
            </div>
          </section>
        </div>
    </main>
  );
}

function StatusBadge({ status }: { status: VideoAnalysisJobStatus }) {
  const className = status === "READY" ? "text-success" : status === "FAILED" ? "text-danger" : "text-info";

  return (
    <span className={`rounded-xl border border-border-subtle bg-surface-muted px-3 py-1 text-xs font-semibold ${className}`}>
      {STATUS_TEXT[status]}
    </span>
  );
}

function readCachedJob(): CachedJob | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<CachedJob>;
    return parsed.jobId && parsed.input ? { jobId: parsed.jobId, input: parsed.input } : null;
  } catch {
    return null;
  }
}

function writeCachedJob(job: CachedJob) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(job));
}

function clearCachedJob() {
  window.localStorage.removeItem(STORAGE_KEY);
}

function JobResult({ detail }: { detail: VideoAnalysisJobDetail }) {
  if (detail.status !== "READY" || !detail.result) {
    return <ResultPlaceholder detail={detail} />;
  }

  const result = detail.result;
  const healthCard = result.healthCard;
  const packaging = result.packagingAnalysis;
  const script = result.scriptAnalysis;
  const semantic = result.semanticAnalysis;
  const metadata = result.metadataJson;
  const creatorPlan = metadata?.creator_action_plan ?? buildCreatorActionPlan(result);

  return (
    <div className="space-y-8">
      <CreatorActionPlanPanel plan={creatorPlan} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <ResultSection title="内容摘要">
          <p className="max-w-3xl text-sm leading-6 text-text-muted">{result.summary ?? "暂无摘要"}</p>
          <ChipList items={healthCard?.core_keywords} className="mt-4" />
        </ResultSection>

        <ResultSection title="视频基础信息">
          <DataTable rows={[
            { label: "标题", value: detail.source.title ?? detail.source.normalizedBvid },
            { label: "UP 主", value: detail.source.authorName ?? "未获取" },
            { label: "时长", value: formatSeconds(detail.source.durationSeconds) },
            { label: "BV 号", value: detail.source.normalizedBvid },
            { label: "发布时间", value: formatDate(detail.source.publishTime) },
          ]} />
        </ResultSection>
      </div>

      <ResultSection title="语义分段">
        <SemanticFlow sections={result.structureSections} />
      </ResultSection>

      <div className="grid gap-6 lg:grid-cols-2">
        <ResultSection title="视频体检结果">
          <HealthCheckTable healthCard={healthCard} />
        </ResultSection>

        <ResultSection title="标题封面分析">
          <div className="space-y-3">
            <DataTable rows={[
              { label: "标题公式", value: joinList(packaging?.title_formulas) },
              { label: "心理触发", value: [packaging?.primary_psychology, packaging?.secondary_psychology].filter(Boolean).join(" / ") },
              { label: "关键词密度", value: formatKeywordDensity(packaging?.keyword_density) },
            ]} />
            <ChipList items={getUniqueStrings([...(packaging?.title_hook_words ?? []), ...(packaging?.keywords ?? [])])} />
          </div>
        </ResultSection>
      </div>

      <ResultSection title="脚本结构分析">
        <ScriptStructurePanel script={script} highlights={result.highlights} />
      </ResultSection>

      <ResultSection title="语义与传播机制">
        <SemanticMechanismPanel semantic={semantic} />
      </ResultSection>

      <div className="space-y-6">
        <ResultSection title="分析结果">
          <AuditResultsTables rows={buildAuditRows(result)} />
        </ResultSection>
      </div>
    </div>
  );
}

function ResultSection({ title, children, priority = false }: { title: string; children: ReactNode; priority?: boolean }) {
  return (
    <section className={priority ? "rounded-2xl border border-warning-border bg-warning-surface p-5" : "min-w-0 border-t border-border-subtle pt-5"}>
      <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function StageProgressPanel({ detail }: { detail: VideoAnalysisJobDetail }) {
  const currentStageLabel = detail.currentStage ? getStageLabel(detail.currentStage) : null;
  const currentStageText = currentStageLabel ?? "等待 worker 领取";
  const currentStatusText = formatStageStatus(detail.currentStageStatus);
  const estimate = detail.estimate;

  return (
    <article className="app-panel p-5 lg:col-span-2" aria-labelledby="video-analysis-progress-title">
      <h3 id="video-analysis-progress-title" className="text-sm font-semibold text-text-primary">处理进度</h3>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        当前阶段：{currentStageText}，阶段结果：{currentStatusText}。
        {estimate ? `，${estimate.message}` : ""}
      </div>
      <div className="mt-3 grid gap-3 text-sm leading-6 text-text-muted lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="space-y-1">
          <div>任务状态：{STATUS_TEXT[detail.status]}</div>
          <div>当前阶段：{currentStageText}</div>
          <div>阶段结果：{currentStatusText}</div>
          <div>阶段开始：{formatDateTime(detail.currentStageStartedAt)}</div>
          {estimate && (
            <div className="mt-2 rounded-2xl border border-info-border bg-info-surface px-3 py-2 text-xs leading-5 text-info">
              {estimate.message}
            </div>
          )}
        </div>
        <div className="space-y-2">
          <div>{detail.currentStageMessage ?? "暂无阶段说明"}</div>
          <ol className="space-y-2" aria-label="视频分析处理阶段">
            {detail.stageEvents.length ? detail.stageEvents.map((event) => (
              <li
                key={event.eventId}
                className="rounded-2xl border border-border-subtle bg-surface-muted px-4 py-3"
                aria-current={event.stage === detail.currentStage && event.status === "RUNNING" ? "step" : undefined}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted">
                  <span className="font-semibold text-text-primary">{getStageLabel(event.stage)}</span>
                  <span>{formatStageStatus(event.status)}</span>
                </div>
                <div className="mt-2 text-sm leading-6 text-text-muted">{event.message ?? "暂无说明"}</div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
                  <span>开始：{formatDateTime(event.startedAt)}</span>
                  <span>结束：{formatDateTime(event.completedAt)}</span>
                  <span>耗时：{formatDurationMs(event.durationMs)}</span>
                </div>
              </li>
            )) : <li><EmptyLine text="worker 尚未写入阶段事件" /></li>}
          </ol>
        </div>
      </div>
    </article>
  );
}

function ResultPlaceholder({ detail }: { detail?: VideoAnalysisJobDetail }) {
  if (detail?.status === "FAILED") {
    return <StatusMessage type="error" title="分析失败" message={detail.errorMessage ?? "视频分析任务失败"} />;
  }

  if (detail) {
    return <AnalysisPendingState detail={detail} />;
  }

  return <FirstAnalysisEmptyState />;
}

function FirstAnalysisEmptyState() {
  return (
    <article className="rounded-2xl border border-border-subtle bg-surface-selected p-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(16rem,0.65fr)] lg:items-start">
        <div>
          <div className="text-xs font-semibold tracking-wide text-text-muted">首次分析</div>
          <h3 className="mt-2 text-lg font-semibold text-text-primary">先提交一个视频，结果会直接变成改稿清单</h3>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-text-muted">
            支持 B 站视频链接或 BV 号。完成后会优先展示需要修改的建议，再展开摘要、脚本结构、语义机制和分析结果。
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {FIRST_ANALYSIS_STEPS.map((step) => (
              <div key={step.title} className="rounded-2xl border border-border-subtle bg-surface-elevated p-4">
                <div className="text-sm font-semibold text-text-primary">{step.title}</div>
                <div className="mt-2 text-sm leading-6 text-text-muted">{step.description}</div>
              </div>
            ))}
          </div>
        </div>

        <aside className="rounded-2xl border border-info-border bg-info-surface p-4">
          <div className="text-sm font-semibold text-info">开始前确认</div>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-info">
            <li>输入框在上方，粘贴链接后点击“开始分析”。</li>
            <li>长视频会先获取字幕并分段，页面会自动刷新进度。</li>
            <li>结果完成后，先看“需要修改”即可开始改稿。</li>
          </ul>
        </aside>
      </div>
    </article>
  );
}

function AnalysisPendingState({ detail }: { detail: VideoAnalysisJobDetail }) {
  const estimate = detail.estimate;

  return (
    <article className="rounded-2xl border border-border-subtle bg-surface-selected p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-xs font-semibold tracking-wide text-text-muted">结果生成中</div>
          <h3 className="mt-2 text-lg font-semibold text-text-primary">正在把视频拆成可执行的改稿建议</h3>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-text-muted">
            worker 完成后会显示摘要、脚本结构、语义机制和分析结果。当前任务会保留在本机，刷新页面后也会继续读取。
          </p>
        </div>
        <div className="space-y-3">
          <div className="rounded-2xl border border-border-subtle bg-surface-elevated px-4 py-3 text-sm leading-6 text-text-muted">
            <div className="font-semibold text-text-primary">当前阶段</div>
            <div className="mt-1">{detail.currentStage ? getStageLabel(detail.currentStage) : STATUS_TEXT[detail.status]}</div>
          </div>
          {estimate && (
            <div className="rounded-2xl border border-info-border bg-info-surface px-4 py-3 text-sm leading-6 text-info">
              <div className="font-semibold text-info">预计等待</div>
              <div className="mt-1">{estimate.message}</div>
              {estimate.confidence === "low" && (
                <div className="mt-1 text-xs text-info/80">预估基于视频长度和已完成的处理阶段，实际时间可能有所不同。</div>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function formatSeconds(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return "未知";
  }

  return `${Math.round(value)} 秒`;
}

function formatDate(value: string | null) {
  if (!value) {
    return "未获取";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "未获取" : date.toLocaleDateString("zh-CN");
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "未记录";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "未记录" : date.toLocaleString("zh-CN", { hour12: false });
}

function formatDurationMs(value: number | null) {
  if (value === null || value === undefined) {
    return "进行中";
  }

  if (value < 1000) {
    return `${value} ms`;
  }

  return `${(value / 1000).toFixed(1)} s`;
}

function formatStageStatus(value: VideoAnalysisStageEventStatus | null) {
  if (!value) {
    return "未开始";
  }

  if (value === "RUNNING") {
    return "进行中";
  }

  if (value === "SUCCEEDED") {
    return "已完成";
  }

  return "失败";
}

function getStageLabel(stage: VideoAnalysisStage) {
  return STAGE_TEXT[stage] ?? stage;
}

function formatBoolean(value: boolean | undefined) {
  if (value === undefined) {
    return "未判断";
  }

  return value ? "有" : "无";
}

function getHealthQuote(healthCard: HealthCard | null, type: "hook" | "cta") {
  const quotes = (healthCard?.hook_and_cta_quotes ?? []).filter((quote) => quote.trim());
  if (!quotes.length) {
    return null;
  }

  if (type === "hook") {
    return healthCard?.has_hook ? quotes[0] : null;
  }

  if (healthCard?.has_hook && quotes.length > 1) {
    return healthCard?.has_cta ? quotes[1] : null;
  }

  return healthCard?.has_cta ? quotes[0] : null;
}

function HealthCheckTable({ healthCard }: { healthCard: HealthCard | null }) {
  const rows = [
    { label: "开头吸引点", status: formatBoolean(healthCard?.has_hook), quote: getHealthQuote(healthCard, "hook") },
    { label: "引导行动", status: formatBoolean(healthCard?.has_cta), quote: getHealthQuote(healthCard, "cta") },
  ];
  const mobileRows = rows.map((row) => ({
    title: row.label,
    fields: [
      { label: "结果", value: row.status },
      { label: "对应原句", value: row.quote ?? "暂无" },
    ],
  }));

  return (
    <div className="mt-3 rounded-2xl border border-border-subtle bg-surface-selected md:overflow-hidden">
      <MobileStackedRows rows={mobileRows} />
      <div className="hidden md:block">
        <table className="w-full border-collapse text-left text-sm leading-6">
          <caption className="sr-only">视频体检结果，包含判断项、结果和对应原句</caption>
          <thead className="bg-surface-muted text-xs font-semibold text-text-primary">
            <tr>
              <th scope="col" className="w-28 px-3 py-2 sm:w-32">判断项</th>
              <th scope="col" className="w-20 px-3 py-2">结果</th>
              <th scope="col" className="px-3 py-2">对应原句</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {rows.map((row) => (
              <tr key={row.label} className="align-top">
                <th scope="row" className="px-3 py-3 text-left font-semibold text-text-primary">{row.label}</th>
                <td className="px-3 py-3 text-text-muted">{row.status}</td>
                <td className="px-3 py-3 text-text-muted">{row.quote ?? "暂无"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ScriptStructurePanel({ script, highlights }: { script: ScriptAnalysis | null; highlights: Highlight[] }) {
  return (
    <div className="space-y-6">
      <div>
        <div className="text-sm font-semibold text-text-primary">脚本主线</div>
        <DataTable rows={[
          { label: "逻辑流", value: script?.logic_flow },
          { label: "开头吸引点", value: formatHookDetail(script?.visual_hook) },
          { label: "内容承诺", value: formatHookDetail(script?.promise_hook) },
          { label: "引导行动", value: formatCtaDetail(script?.cta) },
        ]} />
      </div>

      <div className="space-y-6 border-t border-border-subtle pt-5">
        <ScriptBlocksTable blocks={script?.structural_blocks} />
        <SegmentHooksTable hooks={script?.segment_hooks} />
      </div>

      <div className="border-t border-border-subtle pt-5">
        <HighlightsTable highlights={highlights} />
      </div>
    </div>
  );
}

function formatCtaDetail(cta: ScriptAnalysis["cta"] | undefined) {
  if (!cta) {
    return null;
  }

  const type = cta.cta_type ? `，类型：${cta.cta_type}` : "";
  const hint = cta.optimization_hint ? `，优化提示：${cta.optimization_hint}` : "";

  return `${cta.time ?? "未知时间"} ${cta.text ?? ""}${type}${hint}`;
}

function isStructureBlockDetail(value: unknown): value is StructureBlockDetail {
  return (
    typeof value === "object" &&
    value !== null &&
    "summary" in value
  );
}

type StructureBlockRow = {
  label: string;
  block: StructureBlockDetail | null;
  legacyValue: string | null;
};

function normalizeStructureBlockRows(blocks: ScriptAnalysisStructuralBlocks | undefined): StructureBlockRow[] {
  if (!blocks) {
    return [];
  }

  const labelMap: Record<string, string> = {
    hook: "开头抓注意力",
    promise: "内容承诺",
    re_hook: "二次留存",
    cta: "引导行动",
  };

  const result: StructureBlockRow[] = [];

  for (const key of ["hook", "promise", "re_hook", "cta"] as const) {
    const value = blocks[key];
    if (!value) continue;

    if (isStructureBlockDetail(value)) {
      result.push({ label: labelMap[key], block: value, legacyValue: null });
    } else if (typeof value === "string" && value.trim()) {
      result.push({ label: labelMap[key], block: null, legacyValue: value });
    }
  }

  const meatArray = blocks.meat || [];
  for (const item of meatArray) {
    if (isStructureBlockDetail(item)) {
      result.push({ label: item.name || "主体内容", block: item, legacyValue: null });
    } else if (typeof item === "string" && item.trim()) {
      result.push({ label: "主体内容", block: null, legacyValue: item });
    }
  }

  return result;
}

function buildStructureBlockRows(blocks: ScriptAnalysisStructuralBlocks | undefined): StructureBlockRow[] {
  return normalizeStructureBlockRows(blocks);
}

function ScriptBlocksTable({ blocks }: { blocks: ScriptAnalysis["structural_blocks"] | undefined }) {
  const rows = buildStructureBlockRows(blocks);
  const hasNewFormat = rows.some((row) => row.block);

  return (
    <div>
      <div className="text-sm font-semibold text-text-primary">结构块</div>
      {hasNewFormat ? (
        <>
          <MobileStackedRows
            className="mt-3"
            empty="LLM 暂未返回结构块。"
            rows={rows.map((row) => ({
              title: row.label,
              fields: row.block
                ? [
                    { label: "摘要", value: row.block.summary },
                    { label: "优点", value: row.block.strengths?.join("；") },
                    { label: "不足", value: row.block.weaknesses?.join("；") },
                    { label: "具体改法", value: formatSuggestions(row.block.suggestions) },
                  ]
                : [{ label: "LLM 返回位置", value: row.legacyValue }],
            }))}
          />
          <div className="mt-3 hidden overflow-x-auto rounded-2xl border border-border-subtle bg-surface-elevated md:block">
            <table className="min-w-[760px] w-full border-collapse text-left text-sm leading-6">
              <caption className="sr-only">脚本结构块，包含结构块、摘要、优点、不足和具体改法</caption>
              <thead className="bg-surface-muted text-xs font-semibold text-text-primary">
                <tr>
                  <th scope="col" className="w-24 px-3 py-2">结构块</th>
                  <th scope="col" className="px-3 py-2">摘要</th>
                  <th scope="col" className="px-3 py-2">优点</th>
                  <th scope="col" className="px-3 py-2">不足</th>
                  <th scope="col" className="px-3 py-2">具体改法</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {rows.map((row) => (
                  <tr key={row.label} className="align-top">
                    <th scope="row" className="px-3 py-3 text-left font-semibold text-text-primary">{row.label}</th>
                    <td className="px-3 py-3 text-text-muted">{row.block?.summary || "暂无"}</td>
                    <td className="px-3 py-3 text-text-muted">{row.block?.strengths?.join("；") || "暂无"}</td>
                    <td className="px-3 py-3 text-text-muted">{row.block?.weaknesses?.join("；") || "暂无"}</td>
                    <td className="px-3 py-3 text-text-muted">{formatSuggestions(row.block?.suggestions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <MobileStackedRows
            className="mt-3"
            empty="LLM 暂未返回结构块。"
            rows={rows.map((row) => ({
              title: row.label,
              fields: [
                { label: "LLM 返回位置", value: row.legacyValue },
              ],
            }))}
          />
          <div className="mt-3 hidden overflow-x-auto rounded-2xl border border-border-subtle bg-surface-elevated md:block">
            <table className="w-full border-collapse text-left text-sm leading-6">
              <caption className="sr-only">脚本结构块，包含结构块名称和 LLM 返回位置</caption>
              <thead className="bg-surface-muted text-xs font-semibold text-text-primary">
                <tr>
                  <th scope="col" className="w-32 px-3 py-2">结构块</th>
                  <th scope="col" className="px-3 py-2">LLM 返回位置</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {rows.length ? rows.map((row) => (
                  <tr key={row.label} className="align-top">
                    <th scope="row" className="px-3 py-3 text-left font-semibold text-text-primary">{row.label}</th>
                    <td className="px-3 py-3 text-text-muted">{row.legacyValue}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={2} className="px-3 py-3 text-text-muted">LLM 暂未返回结构块。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function formatSuggestions(suggestions: StructureBlockSuggestion[] | undefined): string {
  if (!suggestions || suggestions.length === 0) return "暂无";

  return suggestions.map((s) => {
    const target = s.target_time || "未指定";
    return `[${s.type || "修改"} @ ${target}] ${s.content || ""}`;
  }).join("；");
}

function formatStructureBlockAuditValue(value: StructureBlockDetail | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.summary || null;
}

function SegmentHooksTable({ hooks }: { hooks: ScriptAnalysis["segment_hooks"] | undefined }) {
  const rows = (hooks ?? []).map((hook, index) => ({
    position: hook.time ?? `第 ${index + 1} 个转折点`,
    text: hook.text,
    purpose: hook.function ?? "承接上一段并推动继续观看。",
    usage: getSegmentHookUsage(index),
  }));
  const values = rows.filter((row) => row.text?.trim());

  return (
    <div>
      <div className="text-sm font-semibold text-text-primary">段落转折吸引点</div>
      {values.length ? (
        <>
          <MobileStackedRows
            className="mt-3"
            rows={values.map((row) => ({
              title: row.position,
              fields: [
                { label: "当前转折句", value: row.text },
                { label: "当前作用", value: row.purpose },
                { label: "适合用法", value: row.usage },
              ],
            }))}
          />
          <div className="mt-3 hidden overflow-x-auto rounded-2xl border border-border-subtle bg-surface-elevated md:block">
            <table className="min-w-[820px] w-full border-collapse text-left text-sm leading-6">
              <caption className="sr-only">段落转折吸引点，包含位置、转折句、当前作用和适合用法</caption>
              <thead className="bg-surface-muted text-xs font-semibold text-text-primary">
                <tr>
                  <th scope="col" className="w-28 px-3 py-2">位置</th>
                  <th scope="col" className="px-3 py-2">当前转折句</th>
                  <th scope="col" className="px-3 py-2">当前作用</th>
                  <th scope="col" className="px-3 py-2">适合用法</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {values.map((row) => (
                  <tr key={`${row.position}-${row.text}`} className="align-top">
                    <th scope="row" className="px-3 py-3 text-left font-semibold text-text-primary">{row.position}</th>
                    <td className="px-3 py-3 text-text-muted">{row.text}</td>
                    <td className="px-3 py-3 text-text-muted">{row.purpose}</td>
                    <td className="px-3 py-3 text-text-muted">{row.usage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="mt-2">
          <EmptyLine text="暂未识别到段落转折吸引点。改稿时可在每段结尾补一句承上启下的话：先总结上一段，再抛出下一段的新问题、反差或收益。" />
        </div>
      )}
    </div>
  );
}

function getSegmentHookUsage(index: number) {
  const usages = [
    "放在开头承诺之后，用来把观众从好奇心带入正文第一段。",
    "放在一个观点讲完后，用反差或新问题打开下一段，避免平铺直叙。",
    "放在信息变密前，提前告诉观众接下来更关键，降低中段流失。",
    "放在结论或 CTA 前，把前面的内容收束成行动理由。",
  ];

  return usages[index % usages.length] ?? usages[0];
}

function HighlightsTable({ highlights }: { highlights: Highlight[] }) {
  const rows = highlights.map((highlight) => ({
    label: formatSeconds(highlight.timestampSeconds),
    value: highlight.quote,
    purpose: highlight.reason,
  }));

  return <ScriptMiniTable title="金句 / 爆点" rows={rows} empty="暂无金句" />;
}

function ScriptMiniTable({ title, rows, empty }: { title: string; rows: Array<{ label: string; value: string | null | undefined; purpose: string }>; empty: string }) {
  const values = rows.filter((row) => row.value?.trim());

  return (
    <div>
      <div className="text-sm font-semibold text-text-primary">{title}</div>
      {values.length ? (
        <>
          <MobileStackedRows
            className="mt-3"
            rows={values.map((row) => ({
              title: row.label,
              fields: [
                { label: "内容", value: row.value },
                { label: "作用", value: row.purpose },
              ],
            }))}
          />
          <div className="mt-3 hidden overflow-x-auto rounded-2xl border border-border-subtle bg-surface-elevated md:block">
            <table className="min-w-[520px] w-full border-collapse text-left text-sm leading-6">
              <caption className="sr-only">{title}，包含节点时间、内容和作用</caption>
              <thead className="bg-surface-muted text-xs font-semibold text-text-primary">
                <tr>
                  <th scope="col" className="w-32 px-3 py-2">节点 / 时间</th>
                  <th scope="col" className="px-3 py-2">内容</th>
                  <th scope="col" className="px-3 py-2">作用</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {values.map((row) => (
                  <tr key={`${title}-${row.label}-${row.value}`} className="align-top">
                    <th scope="row" className="px-3 py-3 text-left font-semibold text-text-primary">{row.label}</th>
                    <td className="px-3 py-3 text-text-muted">{row.value}</td>
                    <td className="px-3 py-3 text-text-muted">{row.purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : <div className="mt-2"><EmptyLine text={empty} /></div>}
    </div>
  );
}

function SemanticMechanismPanel({ semantic }: { semantic: SemanticAnalysis | null }) {
  const overloadWarnings = semantic?.overload_warnings?.filter((item) => item.trim()) ?? [];
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-2xl border border-warning-border bg-warning-surface p-4">
        <div className="text-sm font-semibold text-text-primary">信息过载风险</div>
        <p className="mt-2 text-sm leading-6 text-warning">
          这些片段信息密度较高，观众可能跟不上节奏，适合优先检查是否需要拆句、补解释或放慢节奏。
        </p>
        <TextList items={overloadWarnings} empty="暂无信息过载片段" className="text-warning" />
      </div>

      <div>
        <div className="text-sm font-semibold text-text-primary">理解难度</div>
        <DataTable rows={[{ label: "认知负荷", value: formatCognitiveLoad(semantic?.cognitive_load) }]} />
      </div>

      <div className="space-y-6 lg:col-span-2">
        <div>
          <div className="text-sm font-semibold text-text-primary">语言风格</div>
          <DataTable rows={[
            { label: "语气标签", value: joinList(semantic?.tone_tags) },
            { label: "网感词", value: joinList(semantic?.net_slang) },
          ]} />
        </div>

        <PsychologicalTriggersPanel semantic={semantic} />
      </div>

      <div className="border-t border-border-subtle pt-5 lg:col-span-2">
        <InteractionDesignPanel items={semantic?.interaction_designs} />
      </div>

      <SemanticMechanismUsageTable semantic={semantic} />
    </div>
  );
}

function PsychologicalTriggersPanel({ semantic }: { semantic: SemanticAnalysis | null }) {
  const triggers = getUniqueStrings(semantic?.psychological_triggers ?? []);
  const rhetoricalRows = (semantic?.rhetorical_devices ?? []).filter((item) => (
    item.type?.trim() || item.text_snippet?.trim() || item.mechanism?.trim()
  ));

  return (
    <div>
      <div className="text-sm font-semibold text-text-primary">传播心理</div>
      <p className="mt-2 text-sm leading-6 text-text-muted">
        先看这条视频主要调动了哪些心理，再对照具体修辞证据，判断点击、停留和转发靠什么成立。
      </p>
      <div className="mt-3">
        {triggers.length ? <ChipList items={triggers} /> : <EmptyLine text="暂无心理触发器" />}
      </div>

      <div className="mt-4 text-xs font-semibold tracking-wide text-text-muted">修辞证据</div>
      <MobileStackedRows
        className="mt-2"
        empty="暂无修辞证据"
        rows={rhetoricalRows.map((row, index) => ({
          title: row.type ?? `修辞 ${index + 1}`,
          fields: [
            { label: "原句", value: row.text_snippet },
            { label: "出现位置", value: formatTimeRange(row.time_range) },
            { label: "传播作用", value: row.mechanism },
          ],
        }))}
      />
      <div className="mt-2 hidden overflow-x-auto rounded-2xl border border-border-subtle bg-surface-elevated md:block">
        <table className="min-w-[720px] w-full border-collapse text-left text-sm leading-6">
          <caption className="sr-only">传播心理修辞证据，包含修辞类型、出现位置、原句和传播作用</caption>
          <thead className="bg-surface-muted text-xs font-semibold text-text-primary">
            <tr>
              <th scope="col" className="w-28 px-3 py-2">修辞类型</th>
              <th scope="col" className="w-36 px-3 py-2">出现位置</th>
              <th scope="col" className="px-3 py-2">原句</th>
              <th scope="col" className="px-3 py-2">传播作用</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {rhetoricalRows.length ? rhetoricalRows.map((row, index) => (
              <tr key={`${row.type}-${row.text_snippet}-${index}`} className="align-top">
                <th scope="row" className="px-3 py-3 text-left font-semibold text-text-primary">{row.type ?? "修辞"}</th>
                <td className="px-3 py-3 text-text-muted">{formatTimeRange(row.time_range) ?? "暂无"}</td>
                <td className="px-3 py-3 text-text-muted">{row.text_snippet ?? "暂无"}</td>
                <td className="px-3 py-3 text-text-muted">{row.mechanism ?? "暂无"}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={4} className="px-3 py-3 text-text-muted">暂无修辞证据</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InteractionDesignPanel({ items }: { items: SemanticAnalysis["interaction_designs"] | undefined }) {
  const rows = (items ?? []).filter((item) => (
    item.type?.trim() || item.trigger_text?.trim() || item.expected_response?.trim() || item.placement_strategy?.trim()
  ));

  return (
    <div>
      <div className="text-sm font-semibold text-text-primary">互动设计</div>
      <p className="mt-2 text-sm leading-6 text-text-muted">
        把互动拆成类型、触发文案、预期反应和放置策略，方便直接判断这条视频在哪些位置引导评论、弹幕或转发。
      </p>
      <MobileStackedRows
        className="mt-3"
        empty="暂无互动设计"
        rows={rows.map((row, index) => ({
          title: row.type ?? `互动 ${index + 1}`,
          fields: [
            { label: "触发文案", value: row.trigger_text },
            { label: "出现时间", value: row.time },
            { label: "预期反应", value: row.expected_response },
            { label: "放置策略", value: row.placement_strategy },
          ],
        }))}
      />
      <div className="mt-3 hidden overflow-x-auto rounded-2xl border border-border-subtle bg-surface-elevated md:block">
        <table className="min-w-[880px] w-full border-collapse text-left text-sm leading-6">
          <caption className="sr-only">互动设计，包含互动类型、出现时间、触发文案、预期反应和放置策略</caption>
          <thead className="bg-surface-muted text-xs font-semibold text-text-primary">
            <tr>
              <th scope="col" className="w-28 px-3 py-2">互动类型</th>
              <th scope="col" className="w-28 px-3 py-2">出现时间</th>
              <th scope="col" className="px-3 py-2">触发文案</th>
              <th scope="col" className="px-3 py-2">预期反应</th>
              <th scope="col" className="px-3 py-2">放置策略</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {rows.length ? rows.map((row, index) => (
              <tr key={`${row.type}-${row.trigger_text}-${index}`} className="align-top">
                <th scope="row" className="px-3 py-3 text-left font-semibold text-text-primary">{row.type ?? "互动"}</th>
                <td className="px-3 py-3 text-text-muted">{row.time ?? "暂无"}</td>
                <td className="px-3 py-3 text-text-muted">{row.trigger_text ?? "暂无"}</td>
                <td className="px-3 py-3 text-text-muted">{row.expected_response ?? "暂无"}</td>
                <td className="px-3 py-3 text-text-muted">{row.placement_strategy ?? "暂无"}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={5} className="px-3 py-3 text-text-muted">暂无互动设计</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SemanticMechanismUsageTable({ semantic }: { semantic: SemanticAnalysis | null }) {
  const rows = [
    {
      mechanism: "心理触发器",
      result: joinList(semantic?.psychological_triggers),
      placement: "标题、封面、开头 3 秒",
      enhancement: "把触发点写成具体人群、痛点、收益或反差，不只停留在情绪词。",
      lift: "提升点击率",
    },
    {
      mechanism: "修辞装置",
      result: formatRhetoricalSummary(semantic?.rhetorical_devices),
      placement: "金句、转折、结论",
      enhancement: "保留最容易被复述的对比、排比、比喻或反问，并压成短句。",
      lift: "提升记忆点和传播",
    },
    {
      mechanism: "语气标签",
      result: joinList(semantic?.tone_tags),
      placement: "整条视频表达风格",
      enhancement: "统一标题、口播和结尾语气，避免一会儿权威、一会儿玩梗导致信任感断裂。",
      lift: "提升信任感和稳定观看",
    },
    {
      mechanism: "网感词",
      result: joinList(semantic?.net_slang),
      placement: "标题、弹幕互动、评论引导",
      enhancement: "只保留目标观众熟悉的表达，放在互动句里，不要堆满正文。",
      lift: "提升亲近感和互动",
    },
    {
      mechanism: "互动设计",
      result: formatInteractionSummary(semantic?.interaction_designs),
      placement: "中段、结尾或争议观点后",
      enhancement: "把互动问题改成容易回答的二选一、经历分享或立场表达。",
      lift: "提升评论、弹幕和转发",
    },
  ];

  return (
    <div className="border-t border-border-subtle pt-5 lg:col-span-2">
      <div className="text-sm font-semibold text-text-primary">怎么使用这些机制</div>
      <MobileStackedRows
        className="mt-3"
        rows={rows.map((row) => ({
          title: row.mechanism,
          fields: [
            { label: "当前结果", value: row.result ?? "暂无" },
            { label: "适合放在哪里", value: row.placement },
            { label: "加强方式", value: row.enhancement },
            { label: "主要提升", value: row.lift },
          ],
        }))}
      />
      <div className="mt-3 hidden overflow-x-auto rounded-2xl border border-border-subtle bg-surface-elevated md:block">
        <table className="min-w-[860px] w-full border-collapse text-left text-sm leading-6">
          <caption className="sr-only">语义与传播机制使用建议，包含当前结果、适合位置、加强方式和主要提升</caption>
          <thead className="bg-surface-muted text-xs font-semibold text-text-primary">
            <tr>
              <th scope="col" className="w-28 px-3 py-2">机制</th>
              <th scope="col" className="px-3 py-2">当前结果</th>
              <th scope="col" className="px-3 py-2">适合放在哪里</th>
              <th scope="col" className="px-3 py-2">加强方式</th>
              <th scope="col" className="px-3 py-2">主要提升</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {rows.map((row) => (
              <tr key={row.mechanism} className="align-top">
                <th scope="row" className="px-3 py-3 text-left font-semibold text-text-primary">{row.mechanism}</th>
                <td className="px-3 py-3 text-text-muted">{row.result ?? "暂无"}</td>
                <td className="px-3 py-3 text-text-muted">{row.placement}</td>
                <td className="px-3 py-3 text-text-muted">{row.enhancement}</td>
                <td className="px-3 py-3 text-text-muted">{row.lift}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatRhetoricalSummary(items: SemanticAnalysis["rhetorical_devices"] | undefined) {
  const values = getUniqueStrings((items ?? []).map((item) => item.type));

  return values.length ? values.join("、") : null;
}

function formatTimeRange(range: { start?: string; end?: string } | undefined) {
  if (!range?.start && !range?.end) {
    return null;
  }

  if (range.start && range.end) {
    return `${range.start} 至 ${range.end}`;
  }

  return range.start ?? range.end ?? null;
}

function formatInteractionSummary(items: SemanticAnalysis["interaction_designs"] | undefined) {
  const values = (items ?? []).map((item) => item.type || item.trigger_text).filter((item): item is string => Boolean(item));

  return values.length ? values.join("、") : null;
}

function CreatorActionPlanPanel({ plan }: { plan: CreatorActionPlan }) {
  const priorityFixes = (plan.priority_fixes ?? []).filter((fix) => fix.problem?.trim() || fix.reason?.trim() || fix.rewrite?.trim());

  return (
    <div className="space-y-6 rounded-2xl border border-warning-border bg-warning-surface p-5">
      <div>
        <div className="text-sm font-semibold text-text-primary">需要修改</div>
        <p className="mt-2 text-sm leading-6 text-warning">
          先处理会影响点击、停留和互动的关键问题。每条建议都包含问题、原因和直接改法。
        </p>
        {priorityFixes.length ? (
          <ol className="mt-4 divide-y divide-warning-border rounded-2xl border border-warning-border bg-surface-elevated px-4">
            {priorityFixes.map((fix, index) => (
              <li
                key={`${fix.problem}-${index}`}
                className="py-4"
              >
                <div className="text-xs font-semibold tracking-wide text-text-muted">优先级 {fix.priority ?? index + 1}</div>
                <div className="mt-2 space-y-2 text-sm leading-6">
                  <div>
                    <span className="font-semibold text-text-primary">问题：</span>
                    <span className="text-text-muted">{fix.problem ?? "暂无"}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-text-primary">原因：</span>
                    <span className="text-text-muted">{fix.reason ?? "暂无"}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-text-primary">直接改法：</span>
                    <span className="text-text-muted">{fix.rewrite ?? "暂无"}</span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        ) : <div className="mt-2"><EmptyLine text="暂无优先修改建议" /></div>}
      </div>

      <div className="border-t border-warning-border pt-5">
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <div className="text-sm font-semibold text-text-primary">下次继续保留</div>
            <TextList items={plan.keep_points} empty="暂无可复用优点" />
          </div>

          <div>
            <div className="text-sm font-semibold text-text-primary">下一条视频复用模板</div>
            <TextList items={plan.reuse_template} empty="暂无可复用结构" />
          </div>
        </div>
      </div>
    </div>
  );
}

function joinList(items: Array<string | null | undefined> | undefined | null) {
  const values = (items ?? []).filter((item): item is string => Boolean(item));
  return values.length ? values.join("、") : null;
}

function getUniqueStrings(items: Array<string | null | undefined>) {
  const values = items.map((item) => item?.trim()).filter((item): item is string => Boolean(item));

  return Array.from(new Set(values));
}

function formatKeywordDensity(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const descriptions: Record<string, string> = {
    高: "关键词出现很集中，用户更容易记住主题，但重复过多会显得刻意。",
    中: "关键词有持续出现，主题清楚，重复感相对克制。",
    低: "关键词出现较少，表达更自然，但平台和用户可能不容易快速抓住主题。",
  };

  return `${value}：${descriptions[value] ?? "表示核心词在标题、封面和正文里出现的集中程度。"}`;
}

function formatPsychology(packaging: PackagingAnalysis | null) {
  return [packaging?.primary_psychology, packaging?.secondary_psychology].filter(Boolean).join(" / ") || "暂无";
}

function formatCognitiveLoad(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const descriptions: Record<string, string> = {
    低: "低，信息容易消化，观众基本不用停下来理解。",
    中: "中，信息量适中，需要集中注意力但不明显吃力。",
    高: "高，信息很密，观众可能需要暂停、回看或依赖字幕理解。",
  };

  return descriptions[value] ?? value;
}

function formatHookDetail(hook: HookDetail | null | undefined) {
  if (!hook) {
    return null;
  }

  const score = hook.hook_score === undefined ? "" : `，吸引力评分 ${hook.hook_score} 分，满分 10 分`;

  return `${hook.time ?? "未知时间"} ${hook.text ?? ""}${score}`;
}

function MobileStackedRows({ rows, empty = "暂无", className = "" }: { rows: MobileTableRow[]; empty?: string; className?: string }) {
  const values = rows.filter((row) => row.title.trim() || row.fields.some((field) => field.value?.trim()));

  if (!values.length) {
    return <div className={`md:hidden ${className}`.trim()}><EmptyLine text={empty} /></div>;
  }

  return (
    <div className={`space-y-3 md:hidden ${className}`.trim()}>
      {values.map((row, index) => (
        <section key={`${row.title}-${index}`} className="min-w-0 rounded-2xl border border-border-subtle bg-surface-elevated p-4">
          <div className="break-words text-sm font-semibold text-text-primary">{row.title || `第 ${index + 1} 项`}</div>
          <dl className="mt-3 space-y-3 text-sm leading-6">
            {row.fields.map((field) => (
              <div key={field.label}>
                <dt className="text-xs font-semibold tracking-wide text-text-muted">{field.label}</dt>
                <dd className="mt-1 break-words text-text-primary">{field.value && field.value.trim() ? field.value : "暂无"}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

function DataTable({ rows }: { rows: TableRow[] }) {
  const values = rows.map((row) => ({
    ...row,
    value: row.value && row.value.trim() ? row.value : "暂无",
  }));

  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-border-subtle bg-surface-selected">
      <table className="w-full border-collapse text-left text-sm leading-6">
        <caption className="sr-only">结构化信息表，包含字段名称和字段内容</caption>
        <tbody className="divide-y divide-border-subtle">
          {values.map((row) => (
            <tr key={row.label} className="align-top">
              <th scope="row" className="w-28 bg-surface-muted px-3 py-2 text-left font-semibold text-text-primary sm:w-36">
                {row.label}
              </th>
              <td className="px-3 py-2 text-text-muted">{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SemanticFlow({ sections }: { sections: StructureSection[] }) {
  if (!sections.length) {
    return <div className="mt-3"><EmptyLine text="暂无语义分段" /></div>;
  }

  const rows = chunkSections(sections, 3);

  return (
    <div className="mt-4 space-y-2">
      {rows.map((row, rowIndex) => (
        <div key={`semantic-row-${rowIndex}`}>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_2rem_minmax(0,1fr)_2rem_minmax(0,1fr)] md:items-stretch">
            {getSemanticRowItems(row, rowIndex).map((section, itemIndex) => (
              <SemanticFlowCard key={`${section.startSeconds}-${section.title}`} section={section} arrow={getSemanticArrow(row, rowIndex, itemIndex)} />
            ))}
          </div>
          {rowIndex < rows.length - 1 ? <SemanticFlowConnector align={rowIndex % 2 === 0 ? "end" : "start"} /> : null}
        </div>
      ))}
    </div>
  );
}

function chunkSections(sections: StructureSection[], size: number) {
  const rows: StructureSection[][] = [];

  for (let index = 0; index < sections.length; index += size) {
    rows.push(sections.slice(index, index + size));
  }

  return rows;
}

function getSemanticRowItems(row: StructureSection[], rowIndex: number) {
  return rowIndex % 2 === 0 ? row : [...row].reverse();
}

function getSemanticArrow(row: StructureSection[], rowIndex: number, itemIndex: number) {
  if (itemIndex >= row.length - 1) {
    return null;
  }

  return rowIndex % 2 === 0 ? "→" : "←";
}

function SemanticFlowCard({ section, arrow }: { section: StructureSection; arrow: string | null }) {
  const title = formatSemanticSectionTitle(section.title);

  return (
    <>
      <div className="rounded-2xl border border-border-subtle bg-surface-selected p-4 shadow-panel">
        {title ? <div className="font-semibold text-text-primary">{title}</div> : null}
        <div className="mt-2 text-xs font-semibold text-text-muted">
          {formatSeconds(section.startSeconds)} 至 {formatSeconds(section.endSeconds)}
        </div>
        <div className="mt-2 text-sm leading-6 text-text-muted">{section.summary}</div>
      </div>
      {arrow ? (
        <div className="flex items-center justify-center text-lg font-semibold text-text-muted" aria-hidden="true">
          {arrow}
        </div>
      ) : null}
    </>
  );
}

function formatSemanticSectionTitle(title: string) {
  return /^语义段\s*\d+$/.test(title.trim()) ? null : title;
}

function SemanticFlowConnector({ align }: { align: "start" | "end" }) {
  return (
    <div className="hidden h-8 grid-cols-[minmax(0,1fr)_2rem_minmax(0,1fr)_2rem_minmax(0,1fr)] md:grid" aria-hidden="true">
      <div className={`${align === "end" ? "col-start-5" : "col-start-1"} flex justify-center`}>
        <div className="flex h-full items-center text-lg font-semibold text-text-muted">↓</div>
      </div>
    </div>
  );
}

function AuditResultsTables({ rows }: { rows: AuditRow[] }) {
  const layerNames = ["包装层", "脚本层", "互动层", "总结层"];

  return (
    <div className="mt-3 grid gap-4">
      {layerNames.map((layerName) => (
        <AuditLayerTable key={layerName} title={layerName} rows={rows.filter((row) => row.layer === layerName)} />
      ))}
    </div>
  );
}

function AuditLayerTable({ title, rows }: { title: string; rows: AuditRow[] }) {
  return (
    <div>
      <div className="text-xs font-semibold tracking-wide text-text-muted">{title}</div>
      <MobileStackedRows
        className="mt-2"
        rows={rows.map((row) => ({
          title: row.subject,
          fields: [
            { label: "当前结果", value: row.result && row.result.trim() ? row.result : "暂无" },
            { label: "分析原因", value: row.benefit },
          ],
        }))}
        empty="暂无分析结果"
      />
      <div className="mt-2 hidden overflow-x-auto rounded-2xl border border-border-subtle bg-surface-selected md:block">
      <table className="min-w-[640px] w-full border-collapse text-left text-sm leading-6">
        <caption className="sr-only">{title}分析结果，包含结果项、当前结果和分析原因</caption>
        <thead className="bg-surface-muted text-xs font-semibold text-text-primary">
          <tr>
            <th scope="col" className="w-32 px-3 py-2">结果项</th>
            <th scope="col" className="px-3 py-2">当前结果</th>
            <th scope="col" className="px-3 py-2">分析原因</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {rows.map((row) => (
            <tr key={`${row.layer}-${row.subject}`} className="align-top">
              <th scope="row" className="px-3 py-3 text-left font-semibold text-text-primary">{row.subject}</th>
              <td className="px-3 py-3 text-text-muted">{row.result && row.result.trim() ? row.result : "暂无"}</td>
              <td className="px-3 py-3 text-text-muted">{row.benefit}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function buildCopyAdvantages(result: VideoAnalysisResult) {
  const packaging = result.packagingAnalysis;
  const script = result.scriptAnalysis;
  const semantic = result.semanticAnalysis;
  const internalization = result.internalizationSummary;
  const advantages: Array<{ title: string; content: string }> = [];

  result.copySuggestions.forEach((suggestion) => {
    if (!suggestion.content.trim()) {
      return;
    }

    advantages.push({
      title: suggestion.type || "文案复用建议",
      content: formatCopySuggestionAsKeepPoint(suggestion),
    });
  });

  if (packaging?.title_formulas?.length || packaging?.primary_psychology) {
    advantages.push({
      title: "标题封面复用建议",
      content: `下次同类选题可以继续使用“${joinList(packaging?.title_formulas) ?? "明确看点"}”的标题方式，围绕${packaging?.primary_psychology ?? "观众兴趣"}把点击理由讲清楚。`,
    });
  }

  if (script?.visual_hook?.text || script?.promise_hook?.text) {
    advantages.push({
      title: "开头复用建议",
      content: `下次开头继续把“${script?.visual_hook?.text ?? script?.promise_hook?.text}”这类强钩子前置，再补一句观看收益，帮助观众在前 15 秒判断要不要留下。`,
    });
  }

  if (script?.logic_flow || script?.structural_blocks?.meat?.length) {
    advantages.push({
      title: "结构复用建议",
      content: `下次继续沿用${script?.logic_flow ?? "分段推进"}结构，把主体内容拆成几个明确问题逐段解决，让观众更容易跟住论点推进。`,
    });
  }

  if (semantic?.interaction_designs?.length || result.highlights.length) {
    advantages.push({
      title: "传播复用建议",
      content: `下次继续预留金句和互动点，当前这类“可引用 + 可回应”的设计适合引导评论、弹幕或二次传播。`,
    });
  }

  if (internalization?.clever_design) {
    advantages.push({
      title: "巧妙设计复用建议",
      content: `下次同类内容可以继续复用这个设计思路：${internalization.clever_design}`,
    });
  }

  return dedupeByContent(advantages);
}

function formatCopySuggestionAsKeepPoint(suggestion: CopySuggestion) {
  const type = suggestion.type.trim();
  const content = suggestion.content.trim();

  if (type.includes("标题")) {
    return `下次同类选题继续沿用这类标题表达：${trimTrailingPunctuation(content)}，并明确写出人群、冲突或收益。`;
  }

  if (type.includes("结构")) {
    return `下次继续复用这个结构设计：${trimTrailingPunctuation(content)}，把亮点放在观众最容易感知的位置。`;
  }

  if (type.includes("复用")) {
    return `下次同类视频继续复用：${trimTrailingPunctuation(content)}。`;
  }

  return `下次继续复用这条文案经验：${trimTrailingPunctuation(content)}。`;
}

function trimTrailingPunctuation(text: string) {
  return text.replace(/[。.!！?？]+$/u, "");
}

function dedupeByContent<T extends { content: string }>(items: T[]) {
  const seen = new Set<string>();

  return items.filter((item) => {
    const key = item.content.trim();

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function buildCreatorActionPlan(result: VideoAnalysisResult): CreatorActionPlan {
  const script = result.scriptAnalysis;
  const semantic = result.semanticAnalysis;
  const metadata = result.metadataJson;
  const actions: DerivedCreatorAction[] = [];

  if (!script?.visual_hook?.text) {
    actions.push({
      issue: "开头缺少足够明确的抓注意力句子，观众可能还没理解看点就离开。",
      rewrite: "把最强冲突、结果或反常识结论提前到前 3 秒，先给观众一个必须继续看的理由。",
      example: "开头改成：先别急着照做，这个步骤错了会直接让结果反过来。",
    });
  }

  if (!script?.promise_hook?.text) {
    actions.push({
      issue: "内容承诺不明显，观众不容易判断看完能获得什么。",
      rewrite: "在开头 15 秒内补一句观看收益，把主题从“我要讲什么”改成“你能拿走什么”。",
      example: "补一句：看完你可以直接套用这 3 步，把同类问题先排查一遍。",
    });
  }

  if (semantic?.overload_warnings?.length || formatCognitiveLoad(semantic?.cognitive_load)?.includes("高")) {
    actions.push({
      issue: "部分段落信息密度偏高，普通观众可能需要暂停或回看。",
      rewrite: "把高密度段落拆成短句，每讲完一个概念就补一个例子或使用场景。",
      example: "改成：先记一个判断标准。只要出现 A，就先检查 B；如果没有 B，再看 C。",
    });
  }

  const reHookBlock = script?.structural_blocks?.re_hook;
  const hasReHook = reHookBlock && isStructureBlockDetail(reHookBlock);

  if (!hasReHook) {
    actions.push({
      issue: "中后段二次留存设计不明显，信息变密后容易掉观看。",
      rewrite: "在正文中段加入反转、阶段性结论或下一段预告，把观众重新拉回主线。",
      example: "补一句：但真正容易踩坑的不是这里，而是接下来这个细节。",
    });
  }

  if (!script?.cta?.text) {
    actions.push({
      issue: "结尾缺少明确行动引导，观看后的互动和转化会变弱。",
      rewrite: "用一个低门槛动作收尾，让观众知道评论、收藏或下一步该做什么。",
      example: "结尾加：如果你也遇到过这个问题，把你的场景发在评论区，我按类型继续拆。",
    });
  }

  if (!actions.length && metadata?.retention_risk_points?.length) {
    actions.push({
      issue: metadata.retention_risk_points[0],
      rewrite: "优先检查这个风险点前后的 10 到 20 秒，把长解释拆短，并补一句承接。",
      example: "承接句可用：这里先不用记全部，你只要先抓住一个判断标准。",
    });
  }

  const titleSubject = result.packagingAnalysis?.primary_psychology ?? result.healthCard?.core_keywords?.[0] ?? "核心看点";

  return {
    priority_fixes: actions.slice(0, 3).map((action, index) => ({
      priority: `P${index + 1}`,
      problem: action.issue,
      reason: action.rewrite,
      rewrite: action.example,
    })),
    keep_points: buildCreatorKeepPoints(result),
    title_rewrites: [
      `别再忽略${titleSubject}：这 3 个细节最容易被低估`,
      `真正影响结果的不是努力，而是这 3 个判断标准`,
    ],
    opening_rewrites: ["前 15 秒：先给一个反常识结论，再告诉观众看完能拿走 3 个判断标准或操作步骤。"],
    cta_rewrites: ["结尾改成：如果你也遇到类似情况，把你的具体场景发在评论区，我按类型继续拆。"],
    overload_rewrites: ["把信息最密的段落拆成三句：先给判断标准，再举一个例子，最后告诉观众下一步怎么做。"],
    reuse_template: buildReuseTemplate(result),
  };
}

function buildCreatorKeepPoints(result: VideoAnalysisResult) {
  return buildCopyAdvantages(result).map((advantage) => `${advantage.title}：${advantage.content}`);
}

function buildReuseTemplate(result: VideoAnalysisResult) {
  const script = result.scriptAnalysis;
  const packaging = result.packagingAnalysis;
  const semantic = result.semanticAnalysis;

  return [
    `标题：套用${joinList(packaging?.title_formulas) ?? "明确人群 + 明确收益 + 情绪触发"}，优先突出${packaging?.primary_psychology ?? "观众最关心的结果"}。`,
    `开头：前 3 秒先给${script?.visual_hook?.type ?? "冲突或结果"}，再用一句话说明看完能得到什么。`,
    `正文：按${script?.logic_flow ?? "问题提出 -> 原因解释 -> 方法拆解 -> 总结行动"}推进，每段结尾加一句过渡钩子。`,
    `传播：保留${joinList(semantic?.tone_tags) ?? "清晰直接"}语气，至少设计 1 个评论触发点和 1 句可摘出来的金句。`,
    `结尾：用具体行动收口，引导观众评论场景、收藏步骤或关注下一条延展内容。`,
  ];
}

function buildAuditRows(result: VideoAnalysisResult): AuditRow[] {
  const packaging = result.packagingAnalysis;
  const script = result.scriptAnalysis;
  const semantic = result.semanticAnalysis;
  const internalization = result.internalizationSummary;

  return [
    {
      layer: "包装层",
      subject: "标题公式",
      result: joinList(packaging?.title_formulas),
      benefit: "这些元素能让观众更快判断看点，有利于增加点击率。",
    },
    {
      layer: "包装层",
      subject: "心理触发",
      result: formatPsychology(packaging),
      benefit: "明确心理触发后，更容易判断内容靠什么驱动用户点开。",
    },
    {
      layer: "包装层",
      subject: "关键词密度",
      result: formatKeywordDensity(packaging?.keyword_density),
      benefit: "关键词清楚能降低理解成本，也更利于搜索、推荐和记忆。",
    },
    {
      layer: "脚本层",
      subject: "前 3 秒",
      result: script?.visual_hook?.text,
      benefit: "前 3 秒抓住注意力，能减少刚点进来就划走的流失。",
    },
    {
      layer: "脚本层",
      subject: "3 到 15 秒",
      result: script?.promise_hook?.text,
      benefit: "明确收益能把好奇心转成继续观看的理由。",
    },
    {
      layer: "脚本层",
      subject: "正文骨架",
      result: script?.logic_flow,
      benefit: "结构清楚能让观众跟住信息推进，降低中途退出概率。",
    },
    {
      layer: "脚本层",
      subject: "二次留存",
      result: formatStructureBlockAuditValue(script?.structural_blocks?.re_hook),
      benefit: "二次拉回能对抗信息疲劳，提升完播和有效观看时长。",
    },
    {
      layer: "脚本层",
      subject: "段落转折",
      result: `${script?.segment_hooks?.length ?? 0} 个`,
      benefit: "段落间有牵引力，观众更容易从一个观点进入下一个观点。",
    },
    {
      layer: "互动层",
      subject: "互动设计",
      result: `${semantic?.interaction_designs?.length ?? 0} 个`,
      benefit: "互动点能把观看行为转成反馈信号，帮助内容继续分发。",
    },
    {
      layer: "互动层",
      subject: "引导行动",
      result: script?.cta?.text,
      benefit: "明确行动能减少观众犹豫，让内容获得更多后续动作。",
    },
    {
      layer: "互动层",
      subject: "金句数量",
      result: `${result.highlights.length} 个`,
      benefit: "金句越容易被摘出，越利于评论区复述和二次传播。",
    },
    {
      layer: "互动层",
      subject: "网感词",
      result: joinList(semantic?.net_slang),
      benefit: "语境贴近能降低距离感，让目标观众更愿意互动。",
    },
    {
      layer: "总结层",
      subject: "唯一核心信息",
      result: internalization?.core_message,
      benefit: "核心信息越清楚，越容易被观众记住、转述和复用。",
    },
    {
      layer: "总结层",
      subject: "最巧妙设计",
      result: internalization?.clever_design,
      benefit: "明确可借鉴点，能把一次分析转成后续创作方法。",
    },
    {
      layer: "总结层",
      subject: "优化方向",
      result: internalization?.optimization,
      benefit: "聚焦单个优化方向，能避免改稿时平均用力。",
    },
  ];
}

function ChipList({ items, className = "" }: { items: string[] | null | undefined; className?: string }) {
  const values = getUniqueStrings(items ?? []);
  if (!values.length) {
    return null;
  }

  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {values.map((item) => (
        <span key={item} className="rounded-full border border-border-subtle bg-surface-muted px-3 py-1 text-xs font-semibold text-text-muted">
          {item}
        </span>
      ))}
    </div>
  );
}

function TextList({ items, empty, className = "text-text-muted" }: { items: string[] | null | undefined; empty: string; className?: string }) {
  const values = (items ?? []).filter((item) => item.trim());
  if (!values.length) {
    return <EmptyLine text={empty} className={className} />;
  }

  return (
    <div className="mt-2 space-y-2">
      {values.map((item) => (
        <div key={item} className={`text-sm leading-6 ${className}`}>
          {item}
        </div>
      ))}
    </div>
  );
}

function EmptyLine({ text, className = "text-text-muted" }: { text: string; className?: string }) {
  return <div className={`text-sm leading-6 ${className}`}>{text}</div>;
}

function _extractErrorMessage(data: unknown, fallback: string) {
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const message = record.error ?? record.message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  return fallback;
}

const FIRST_ANALYSIS_STEPS = [
  {
    title: "1. 粘贴视频",
    description: "输入完整链接或 BV 号，不需要额外填写标题、UP 主或字幕来源。",
  },
  {
    title: "2. 等待处理",
    description: "系统会获取视频信息、解析字幕并生成结构化分析，进度会在这里更新。",
  },
  {
    title: "3. 直接改稿",
    description: "优先查看行动建议，按优先修改、标题改写、开头改写和 CTA 改写处理。",
  },
] as const;
