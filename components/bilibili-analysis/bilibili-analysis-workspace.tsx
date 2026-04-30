"use client";

import { useEffect, useRef, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { StatusMessage } from "@/components/ui/status-message";
import { readJsonSafely, toUserFacingErrorMessage } from "@/components/voice-studio/utils";

type VideoAnalysisJobStatus = "PENDING" | "PROCESSING" | "READY" | "FAILED";

type VideoAnalysisSource = {
  normalizedBvid: string;
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

type VideoAnalysisResult = {
  summary: string | null;
  structureSections: StructureSection[];
  highlights: Highlight[];
  copySuggestions: CopySuggestion[];
  modelName: string | null;
  promptVersion: string | null;
};

type VideoAnalysisJobDetail = {
  jobId: string;
  status: VideoAnalysisJobStatus;
  errorMessage: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  source: VideoAnalysisSource;
  result: VideoAnalysisResult | null;
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

const POLL_INTERVAL_MS = 2500;

export function BilibiliAnalysisWorkspace() {
  const [input, setInput] = useState("");
  const [creating, setCreating] = useState(false);
  const [polling, setPolling] = useState(false);
  const [jobDetail, setJobDetail] = useState<VideoAnalysisJobDetail | null>(null);
  const [message, setMessage] = useState<{ type: "error" | "success" | "info" | "warning"; title: string; text: string } | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  useEffect(() => {
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

      if (detail.status === "READY") {
        stopPolling();
        setMessage({ type: "success", title: "分析完成", text: "分析结果已更新，可查看摘要、分段结构和文案建议。" });
        return;
      }

      if (detail.status === "FAILED") {
        stopPolling();
        setMessage({ type: "error", title: "分析失败", text: detail.errorMessage ?? "视频分析任务失败" });
        return;
      }

      setPolling(true);
      setMessage({ type: "info", title: STATUS_TEXT[detail.status], text: "任务已提交，页面会自动刷新处理状态。" });
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
    <>
      <AppHeader />
      <main className="flex min-h-screen w-full min-w-0 flex-col items-center px-4 py-8 sm:px-6 sm:py-10">
        <div className="mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-6">
          <section className="app-card p-6 sm:p-8">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">B站视频分析</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-text-muted sm:text-base">
              输入视频链接或 BV 号，生成摘要、结构拆解与可复用文案。
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
                  {jobDetail ? `任务 ${jobDetail.jobId}` : "先输入视频链接或 BV 号。分析完成后，这里会输出摘要、结构拆解和文案建议。"}
                </p>
              </div>

              {jobDetail ? <JobResult detail={jobDetail} /> : <ResultPlaceholder />}
            </div>
          </section>
        </div>
      </main>
    </>
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

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <article className="app-panel p-5 lg:col-span-2">
        <h3 className="text-sm font-semibold text-text-primary">视频基础信息</h3>
        <div className="mt-3 grid gap-2 text-sm leading-6 text-text-muted sm:grid-cols-2">
          <div>标题：{detail.source.title ?? detail.source.normalizedBvid}</div>
          <div>UP 主：{detail.source.authorName ?? "未获取"}</div>
          <div>时长：{formatSeconds(detail.source.durationSeconds)}</div>
          <div>文本来源：{detail.source.transcriptSource ?? "未确认"}</div>
        </div>
      </article>

      <article className="app-panel p-5 lg:col-span-2">
        <h3 className="text-sm font-semibold text-text-primary">内容摘要</h3>
        <p className="mt-3 text-sm leading-6 text-text-muted">{detail.result.summary ?? "暂无摘要"}</p>
      </article>

      <article className="app-panel p-5">
        <h3 className="text-sm font-semibold text-text-primary">分段结构</h3>
        <div className="mt-3 space-y-4">
          {detail.result.structureSections.map((section) => (
            <div key={`${section.startSeconds}-${section.title}`} className="text-sm leading-6 text-text-muted">
              <div className="font-semibold text-text-primary">{section.title}</div>
              <div>{formatSeconds(section.startSeconds)} 至 {formatSeconds(section.endSeconds)}</div>
              <div>{section.summary}</div>
            </div>
          ))}
        </div>
      </article>

      <article className="app-panel p-5">
        <h3 className="text-sm font-semibold text-text-primary">金句 / 爆点</h3>
        <div className="mt-3 space-y-4">
          {detail.result.highlights.map((highlight) => (
            <div key={`${highlight.timestampSeconds}-${highlight.quote}`} className="text-sm leading-6 text-text-muted">
              <div className="font-semibold text-text-primary">{formatSeconds(highlight.timestampSeconds)}</div>
              <div>{highlight.quote}</div>
              <div>{highlight.reason}</div>
            </div>
          ))}
        </div>
      </article>

      <article className="app-panel p-5 lg:col-span-2">
        <h3 className="text-sm font-semibold text-text-primary">可复用文案建议</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {detail.result.copySuggestions.map((suggestion) => (
            <div key={`${suggestion.type}-${suggestion.content}`} className="rounded-xl border border-border-subtle bg-surface-elevated p-4 text-sm leading-6 text-text-muted">
              <div className="font-semibold text-text-primary">{suggestion.type}</div>
              <div className="mt-2">{suggestion.content}</div>
            </div>
          ))}
        </div>
      </article>
    </div>
  );
}

function ResultPlaceholder({ detail }: { detail?: VideoAnalysisJobDetail }) {
  if (detail?.status === "FAILED") {
    return <StatusMessage type="error" title="分析失败" message={detail.errorMessage ?? "视频分析任务失败"} />;
  }

  const description = detail
    ? "任务已提交，worker 处理完成后会显示摘要、结构拆解和文案建议。"
    : "先输入视频链接或 BV 号。分析完成后，这里会输出摘要、结构拆解和文案建议。";

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
    title: "分段结构",
    description: "拆解视频的叙事顺序、章节转折与信息密度，帮助复盘内容组织方式。",
  },
  {
    title: "金句 / 爆点",
    description: "标记最容易传播、最值得引用或二次创作的片段与表达。",
  },
  {
    title: "可复用文案建议",
    description: "基于分析结果生成标题方向、摘要素材与可复用表达，服务后续创作。",
  },
] as const;
