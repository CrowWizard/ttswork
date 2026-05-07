"use client";

import { useEffect, useRef, useState } from "react";
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
  structural_blocks?: { hook?: string | null; promise?: string | null; meat?: string[]; re_hook?: string | null; cta?: string | null };
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

type MetadataJson = {
  video_duration?: string | null;
  hook_score?: number | null;
  retention_risk_points?: string[];
  golden_quote_count?: number | null;
  interaction_count?: number | null;
  cognitive_load_distribution?: Record<string, number>;
  narrative_curve_text?: string | null;
  structural_blocks?: { hook?: string | null; promise?: string | null; meat?: string[]; re_hook?: string | null; cta?: string | null };
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

function JobResult({ detail }: { detail: VideoAnalysisJobDetail }) {
  if (detail.status !== "READY" || !detail.result) {
    return <ResultPlaceholder detail={detail} />;
  }

  const result = detail.result;
  const healthCard = result.healthCard;
  const packaging = result.packagingAnalysis;
  const script = result.scriptAnalysis;
  const semantic = result.semanticAnalysis;
  const internalization = result.internalizationSummary;
  const metadata = result.metadataJson;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <article className="app-panel p-5 lg:col-span-2">
        <h3 className="text-sm font-semibold text-text-primary">视频基础信息</h3>
        <div className="mt-3 grid gap-2 text-sm leading-6 text-text-muted sm:grid-cols-2 lg:grid-cols-3">
          <div>标题：{detail.source.title ?? detail.source.normalizedBvid}</div>
          <div>UP 主：{detail.source.authorName ?? "未获取"}</div>
          <div>时长：{formatSeconds(detail.source.durationSeconds)}</div>
          <div>文本来源：{detail.source.transcriptSource ?? "未确认"}</div>
          <div>BV 号：{detail.source.normalizedBvid}</div>
          <div>发布时间：{formatDate(detail.source.publishTime)}</div>
        </div>
      </article>

      <article className="app-panel p-5 lg:col-span-2">
        <h3 className="text-sm font-semibold text-text-primary">内容摘要</h3>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-text-muted">{result.summary ?? "暂无摘要"}</p>
        <ChipList items={healthCard?.core_keywords} className="mt-4" />
      </article>

      <article className="app-panel p-5 lg:col-span-2">
        <h3 className="text-sm font-semibold text-text-primary">语义分段</h3>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          {result.structureSections.length ? result.structureSections.map((section) => (
            <div key={`${section.startSeconds}-${section.title}`} className="text-sm leading-6 text-text-muted">
              <div className="font-semibold text-text-primary">{section.title}</div>
              <div>{formatSeconds(section.startSeconds)} 至 {formatSeconds(section.endSeconds)}</div>
              <div>{section.summary}</div>
            </div>
          )) : <EmptyLine text="暂无语义分段" />}
        </div>
      </article>

      <article className="app-panel p-5">
        <h3 className="text-sm font-semibold text-text-primary">视频体检结果</h3>
        <div className="mt-3 space-y-4">
          <p className="text-sm leading-6 text-text-muted">{healthCard?.one_line_summary ?? "暂无视频体检结果"}</p>
          <div className="grid gap-2 text-sm text-text-muted sm:grid-cols-2">
            <div>开头吸引点：{formatBoolean(healthCard?.has_hook)}</div>
            <div>引导行动：{formatBoolean(healthCard?.has_cta)}</div>
          </div>
          <TextList items={healthCard?.hook_and_cta_quotes} empty="暂无开头吸引点或引导行动原句" />
        </div>
      </article>

      <article className="app-panel p-5">
        <h3 className="text-sm font-semibold text-text-primary">标题封面分析</h3>
        <div className="mt-3 space-y-3 text-sm leading-6 text-text-muted">
          <FieldLine label="标题公式" value={joinList(packaging?.title_formulas)} />
          <FieldLine label="心理触发" value={[packaging?.primary_psychology, packaging?.secondary_psychology].filter(Boolean).join(" / ")} />
          <FieldLine label="关键词密度" value={formatKeywordDensity(packaging?.keyword_density)} />
          <FieldLine label="封面关系" value={packaging?.cover_relation} />
          <FieldLine label="视觉情绪" value={packaging?.visual_emotion} />
          <ChipList items={getUniqueStrings([...(packaging?.title_hook_words ?? []), ...(packaging?.keywords ?? [])])} />
        </div>
      </article>

      <article className="app-panel p-5 lg:col-span-2">
        <h3 className="text-sm font-semibold text-text-primary">脚本结构分析</h3>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div className="space-y-3 text-sm leading-6 text-text-muted">
            <FieldLine label="逻辑流" value={script?.logic_flow} />
            <HookBlock title="开头吸引点" hook={script?.visual_hook} />
            <HookBlock title="内容承诺" hook={script?.promise_hook} />
            <StructuralBlocksBlock blocks={script?.structural_blocks} />
            <FieldLine label="引导行动" value={script?.cta ? `${script.cta.time ?? "未知时间"} ${script.cta.text ?? ""}` : null} />
          </div>
          <div className="space-y-4">
            <div>
              <div className="text-xs font-semibold tracking-wide text-text-muted">段落转折吸引点</div>
              <TextList items={script?.segment_hooks?.map((item) => `${item.time ?? "未知时间"} ${item.text ?? ""} ${item.function ? `(${item.function})` : ""}`)} empty="暂无段落转折吸引点" />
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-text-muted">金句 / 爆点</div>
              <div className="mt-2 space-y-3">
                {result.highlights.length ? result.highlights.map((highlight) => (
                  <div key={`${highlight.timestampSeconds}-${highlight.quote}`} className="text-sm leading-6 text-text-muted">
                    <div className="font-semibold text-text-primary">{formatSeconds(highlight.timestampSeconds)}</div>
                    <div>{highlight.quote}</div>
                    <div>{highlight.reason}</div>
                  </div>
                )) : <EmptyLine text="暂无金句" />}
              </div>
            </div>
          </div>
        </div>
      </article>

      <article className="app-panel p-5 lg:col-span-2">
        <h3 className="text-sm font-semibold text-text-primary">语义与传播机制</h3>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div className="space-y-3 text-sm leading-6 text-text-muted">
            <FieldLine label="认知负荷" value={semantic?.cognitive_load} />
            <FieldLine label="心理触发器" value={joinList(semantic?.psychological_triggers)} />
            <FieldLine label="语气标签" value={joinList(semantic?.tone_tags)} />
            <FieldLine label="网感词" value={joinList(semantic?.net_slang)} />
            <TextList items={semantic?.overload_warnings} empty="暂无过载提醒" />
          </div>
          <div className="space-y-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-text-muted">互动设计</div>
              <TextList items={semantic?.interaction_designs?.map((item) => `${item.time ?? "未知时间"} ${item.trigger_text ?? ""} ${item.placement_strategy ? `(${item.placement_strategy})` : ""}`)} empty="暂无互动设计" />
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-text-muted">修辞装置</div>
              <TextList items={semantic?.rhetorical_devices?.map((item) => `${item.type ?? "修辞"}: ${item.text_snippet ?? ""}`)} empty="暂无修辞装置" />
            </div>
          </div>
        </div>
      </article>

      <article className="app-panel p-5">
        <h3 className="text-sm font-semibold text-text-primary">内化总结与指标风险</h3>
        <div className="mt-3 space-y-3 text-sm leading-6 text-text-muted">
          <FieldLine label="核心信息" value={internalization?.core_message} />
          <FieldLine label="巧妙设计" value={internalization?.clever_design} />
          <FieldLine label="优化建议" value={internalization?.optimization} />
          <FieldLine label="钩子分" value={metadata?.hook_score === null || metadata?.hook_score === undefined ? null : `${metadata.hook_score}/10`} />
          <FieldLine label="金句数" value={metadata?.golden_quote_count?.toString()} />
          <FieldLine label="互动数" value={metadata?.interaction_count?.toString()} />
          <FieldLine label="认知负荷分布" value={formatLoadDistribution(metadata?.cognitive_load_distribution)} />
          <TextList items={metadata?.retention_risk_points} empty="暂无留存风险点" />
        </div>
      </article>

      <article className="app-panel p-5">
        <h3 className="text-sm font-semibold text-text-primary">可复用文案建议</h3>
        <div className="mt-3 space-y-3">
          {result.copySuggestions.length ? result.copySuggestions.map((suggestion) => (
            <div key={`${suggestion.type}-${suggestion.content}`} className="text-sm leading-6 text-text-muted">
              <div className="font-semibold text-text-primary">{suggestion.type}</div>
              <div>{suggestion.content}</div>
            </div>
          )) : <EmptyLine text="暂无文案建议" />}
        </div>
      </article>
    </div>
  );
}

function StageProgressPanel({ detail }: { detail: VideoAnalysisJobDetail }) {
  const currentStageLabel = detail.currentStage ? getStageLabel(detail.currentStage) : null;

  return (
    <article className="app-panel p-5 lg:col-span-2">
      <h3 className="text-sm font-semibold text-text-primary">处理进度</h3>
      <div className="mt-3 grid gap-3 text-sm leading-6 text-text-muted lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="space-y-1">
          <div>任务状态：{STATUS_TEXT[detail.status]}</div>
          <div>当前阶段：{currentStageLabel ?? "等待 worker 领取"}</div>
          <div>阶段结果：{formatStageStatus(detail.currentStageStatus)}</div>
          <div>阶段开始：{formatDateTime(detail.currentStageStartedAt)}</div>
        </div>
        <div className="space-y-2">
          <div>{detail.currentStageMessage ?? "暂无阶段说明"}</div>
          <div className="space-y-2">
            {detail.stageEvents.length ? detail.stageEvents.map((event) => (
              <div key={event.eventId} className="rounded-2xl border border-border-subtle bg-surface-muted px-4 py-3">
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
              </div>
            )) : <EmptyLine text="worker 尚未写入阶段事件" />}
          </div>
        </div>
      </div>
    </article>
  );
}

function ResultPlaceholder({ detail }: { detail?: VideoAnalysisJobDetail }) {
  if (detail?.status === "FAILED") {
    return <StatusMessage type="error" title="分析失败" message={detail.errorMessage ?? "视频分析任务失败"} />;
  }

  const description = detail
    ? "任务已提交，worker 处理完成后会显示摘要、语义分段、标题封面分析、脚本结构和语义机制。"
    : "先输入视频链接或 BV 号。分析完成后，这里会输出摘要、语义分段、标题封面分析、脚本结构和语义机制。";

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {RESULT_SECTIONS.map((section) => (
        <article key={section.title} className="app-panel p-5">
          <h3 className="text-sm font-semibold text-text-primary">{section.title}</h3>
          <p className="mt-3 text-sm leading-6 text-text-muted">{detail ? description : section.description}</p>
        </article>
      ))}
    </div>
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

function formatLoadDistribution(value: Record<string, number> | undefined) {
  if (!value) {
    return null;
  }

  const parts = [
    value.low === undefined ? null : `低 ${value.low}%`,
    value.medium === undefined ? null : `中 ${value.medium}%`,
    value.high === undefined ? null : `高 ${value.high}%`,
  ].filter(Boolean);

  return parts.length ? parts.join("；") : null;
}

function FieldLine({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <span className="font-semibold text-text-primary">{label}：</span>
      <span>{value && value.trim() ? value : "暂无"}</span>
    </div>
  );
}

function HookBlock({ title, hook }: { title: string; hook: HookDetail | null | undefined }) {
  if (!hook) {
    return <FieldLine label={title} value={null} />;
  }

  const score = hook.hook_score === undefined ? "" : `，${hook.hook_score}/10`;
  return <FieldLine label={title} value={`${hook.time ?? "未知时间"} ${hook.text ?? ""}${score}`} />;
}

function StructuralBlocksBlock({ blocks }: { blocks: ScriptAnalysis["structural_blocks"] | undefined }) {
  const items = [
    blocks?.hook ? `开头抓注意力：${blocks.hook}，用问题、冲突或高光先把人留下。` : null,
    blocks?.promise ? `告诉观众能得到什么：${blocks.promise}，明确看下去的收益。` : null,
    blocks?.meat?.length ? `主体内容：${blocks.meat.join("、")}，展开论点、案例、步骤或证据。` : null,
    blocks?.re_hook ? `中后段重新拉回注意力：${blocks.re_hook}，防止观众在信息变密时流失。` : null,
    blocks?.cta ? `引导行动：${blocks.cta}，提醒点赞、收藏、评论、关注或执行下一步。` : null,
  ].filter((item): item is string => Boolean(item));

  return (
    <div>
      <div className="font-semibold text-text-primary">结构块：</div>
      <TextList items={items} empty="暂无结构块" />
    </div>
  );
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

function TextList({ items, empty }: { items: string[] | null | undefined; empty: string }) {
  const values = (items ?? []).filter((item) => item.trim());
  if (!values.length) {
    return <EmptyLine text={empty} />;
  }

  return (
    <div className="mt-2 space-y-2">
      {values.map((item) => (
        <div key={item} className="text-sm leading-6 text-text-muted">
          {item}
        </div>
      ))}
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <div className="text-sm leading-6 text-text-muted">{text}</div>;
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

const RESULT_SECTIONS = [
  {
    title: "视频基础信息",
    description: "分析后展示标题、UP 主、时长、发布时间等关键信息，便于快速确认素材背景。",
  },
  {
    title: "内容摘要",
    description: "提炼视频核心观点与关键信息，适合先判断是否值得继续深看。",
  },
  {
    title: "语义分段",
    description: "按话题、观点和转折拆解视频，帮助看清每一段在讲什么。",
  },
  {
    title: "视频体检结果",
    description: "快速判断视频是否有开头吸引点、行动引导和稳定传播关键词。",
  },
  {
    title: "标题封面分析",
    description: "分析标题写法、情绪触发、封面配合方式和关键词出现频率。",
  },
  {
    title: "脚本结构分析",
    description: "拆出开头吸引点、内容承诺、段落转折、金句和行动引导。",
  },
  {
    title: "语义与传播机制",
    description: "识别修辞装置、互动设计、认知负荷和潜在过载点。",
  },
  {
    title: "指标风险与文案建议",
    description: "汇总钩子分、留存风险、内化总结与可复用改写方案。",
  },
] as const;
