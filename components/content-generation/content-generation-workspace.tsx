"use client";

import { useEffect, useRef, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { StatusMessage } from "@/components/ui/status-message";
import { readJsonSafely, toUserFacingErrorMessage } from "@/components/voice-studio/utils";

type JobStatus = "PENDING" | "PROCESSING" | "READY" | "FAILED";
type StageStatus = "RUNNING" | "SUCCEEDED" | "FAILED";

type StageEvent = {
  eventId: string;
  stage: string;
  status: StageStatus;
  label: string | null;
  message: string | null;
  details: { label?: string; payload?: unknown } | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
};

type FinalOutput = {
  status: "completed" | "failed";
  metadata: {
    topic: string;
    platform: string;
    language: "zh-CN" | "en-US";
    estimatedDurationSec: number;
    generateShots: boolean;
    sections: Array<{ name: string; density: string; durationSec: number }>;
  };
  script: string;
  hook: string;
  references: string;
  warnings: string[];
  progress_log: Array<{ step: string; ts: number; message: string }>;
};

type JobDetail = {
  jobId: string;
  status: JobStatus;
  errorMessage: string | null;
  currentStage: string | null;
  currentStageStatus: StageStatus | null;
  currentStageMessage: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  input: {
    topic: string;
    platform: string;
    language: string;
    tone: string;
    verbosity: string;
    duration: string;
    generateShots: boolean;
    heroOpening: string | null;
    outroClosing: string | null;
  };
  result: FinalOutput | null;
  stageEvents: StageEvent[];
};

type CreateJobResponse = {
  jobId?: string;
  status?: JobStatus;
  error?: string;
  message?: string;
};

const POLL_INTERVAL_MS = 3000;
const STORAGE_KEY = "content_generation_current_job";

const stageLabels: Record<string, string> = {
  PREFERENCES: "[PREFERENCES] 用户偏好",
  DIRECTION_RESEARCH: "[DIRECTION] [RESEARCH] 方向研究",
  CATEGORY_MATCH: "[CATEGORY] [TOPIC] 分类主题",
  STRUCTURE_DESIGN: "[STRUCTURE] 内容结构",
  HOOK_GENERATION: "[HOOK] 开头 Hook",
  CONTENT_GENERATION: "[CONTENT] 完整脚本",
  FORMAT_VALIDATE: "[OUTPUT] 格式校验",
  RESULT_WRITEBACK: "结果写回",
  FAILED_WRITEBACK: "失败写回",
};

const statusLabels: Record<JobStatus, string> = {
  PENDING: "等待 worker 领取",
  PROCESSING: "生成中",
  READY: "已完成",
  FAILED: "失败",
};

export function ContentGenerationWorkspace() {
  const [topic, setTopic] = useState("");
  const [tone, setTone] = useState("personal");
  const [verbosity, setVerbosity] = useState("concise");
  const [duration, setDuration] = useState("short");
  const [generateShots, setGenerateShots] = useState(true);
  const [creating, setCreating] = useState(false);
  const [polling, setPolling] = useState(false);
  const [jobDetail, setJobDetail] = useState<JobDetail | null>(null);
  const [message, setMessage] = useState<{ type: "error" | "success" | "info" | "warning"; title: string; text: string } | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const cachedJobId = window.localStorage.getItem(STORAGE_KEY);
    if (cachedJobId) {
      setMessage({ type: "info", title: "已恢复上次任务", text: `正在读取任务 ${cachedJobId}。` });
      void pollJob(cachedJobId);
    }

    return () => stopPolling();
    // 页面首次加载只恢复一次，后续轮询由 pollJob 接管。
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
    const response = await fetch(`/api/content-generation/jobs/${jobId}`, { cache: "no-store", credentials: "include" });
    const data = await readJsonSafely(response);

    if (!response.ok) {
      throw new Error(extractErrorMessage(data, "读取生成状态失败"));
    }

    return data as JobDetail;
  };

  const schedulePoll = (jobId: string) => {
    pollTimerRef.current = window.setTimeout(() => void pollJob(jobId), POLL_INTERVAL_MS);
  };

  const pollJob = async (jobId: string) => {
    try {
      const detail = await loadJobDetail(jobId);
      setJobDetail(detail);
      setTopic(detail.input.topic);
      setGenerateShots(detail.input.generateShots);
      window.localStorage.setItem(STORAGE_KEY, detail.jobId);

      if (detail.status === "READY") {
        stopPolling();
        setMessage({ type: "success", title: "生成完成", text: "视频脚本已生成。" });
        return;
      }

      if (detail.status === "FAILED") {
        stopPolling();
        window.localStorage.removeItem(STORAGE_KEY);
        setMessage({ type: "error", title: "生成失败", text: detail.errorMessage ?? "内容生成任务失败" });
        return;
      }

      setPolling(true);
      setMessage({
        type: "info",
        title: detail.currentStage ? getStageLabel(detail.currentStage) : statusLabels[detail.status],
        text: detail.currentStageMessage ?? "任务已提交，页面会自动刷新生成状态。",
      });
      schedulePoll(jobId);
    } catch (error) {
      stopPolling();
      setMessage({ type: "error", title: "状态读取失败", text: toUserFacingErrorMessage(error, "读取生成状态失败") });
    }
  };

  const handleSubmit = async () => {
    const trimmedTopic = topic.trim();
    if (!trimmedTopic) {
      setMessage({ type: "warning", title: "请输入话题", text: "请输入视频脚本要讨论的话题。" });
      return;
    }

    stopPolling();
    setCreating(true);
    setJobDetail(null);
    setMessage({ type: "info", title: "正在创建任务", text: "正在提交 B站文案生成任务。" });

    try {
      const response = await fetch("/api/content-generation/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          topic: trimmedTopic,
          type: "video_script",
          tone,
          verbosity,
          duration,
          generateShots,
        }),
      });
      const data = (await readJsonSafely(response)) as CreateJobResponse;

      if (!response.ok || !data.jobId) {
        throw new Error(extractErrorMessage(data, "创建内容生成任务失败"));
      }

      window.localStorage.setItem(STORAGE_KEY, data.jobId);
      setPolling(true);
      setMessage({ type: "info", title: "任务已创建", text: `任务 ${data.jobId} 已进入队列，等待 worker 处理。` });
      await pollJob(data.jobId);
    } catch (error) {
      stopPolling();
      setMessage({ type: "error", title: "创建失败", text: toUserFacingErrorMessage(error, "创建内容生成任务失败") });
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
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">B站文案生成</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-text-muted sm:text-base">
            输入话题后生成只结构化脚本。
          </p>
        </section>

        <section className="app-card p-6 sm:p-8">
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="lg:col-span-2">
              <label htmlFor="content-topic" className="text-sm font-semibold text-text-primary">话题</label>
              <textarea
                id="content-topic"
                className="app-input min-h-28 resize-y"
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                placeholder="例如：AI 工具如何提升短视频创作效率"
                disabled={isBusy}
              />
            </div>
            <SelectField label="语气" value={tone} onChange={setTone} disabled={isBusy} options={[["personal", "个人口吻"], ["company", "公司口吻"], ["professional-casual", "专业轻松"]]} />
            <SelectField label="详略" value={verbosity} onChange={setVerbosity} disabled={isBusy} options={[["concise", "精简"], ["detailed", "详细"]]} />
            <SelectField label="时长" value={duration} onChange={setDuration} disabled={isBusy} options={[["short", "短 60-120s"], ["medium", "中 180-300s"], ["long", "长 420-720s"]]} />
            <label className="flex items-center gap-3 rounded-2xl border border-border-subtle bg-surface-selected p-4 text-sm text-text-secondary lg:col-span-2">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border-subtle"
                checked={generateShots}
                onChange={(event) => setGenerateShots(event.target.checked)}
                disabled={isBusy}
              />
              生成镜头内容
            </label>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button type="button" className="app-button-primary disabled:cursor-not-allowed disabled:opacity-60" onClick={handleSubmit} disabled={isBusy}>
              {creating ? "创建中" : polling ? "生成中" : "开始生成"}
            </button>
            <p className="text-sm leading-6 text-text-muted">提交后页面轮询任务状态，Worker 完成后展示脚本。</p>
          </div>

          {message ? <div className="mt-5"><StatusMessage type={message.type} title={message.title} message={message.text} /></div> : null}
        </section>

        <section className="app-card p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-text-primary">生成结果</h2>
              <p className="mt-2 text-sm leading-6 text-text-muted">{jobDetail ? `任务 ${jobDetail.jobId}` : "提交任务后查看阶段进度和脚本文案。"}</p>
            </div>
            {jobDetail ? <StatusBadge status={jobDetail.status} /> : null}
          </div>

          {jobDetail ? <ProgressPanel detail={jobDetail} /> : <EmptyState />}
          {jobDetail?.result ? <ResultPanel result={jobDetail.result} /> : null}
        </section>
      </div>
    </main>
  );
}

function SelectField({ label, value, onChange, options, disabled }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]>; disabled: boolean }) {
  return (
    <div>
      <label className="text-sm font-semibold text-text-primary">{label}</label>
      <select className="app-input" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
        {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
      </select>
    </div>
  );
}

function ProgressPanel({ detail }: { detail: JobDetail }) {
  return (
    <div className="mt-6 rounded-2xl border border-border-subtle bg-surface-selected p-5">
      <div className="text-sm font-semibold text-text-primary">处理进度</div>
      <div className="mt-2 text-sm leading-6 text-text-muted">当前阶段：{detail.currentStage ? getStageLabel(detail.currentStage) : statusLabels[detail.status]}</div>
      <ol className="mt-4 space-y-3" aria-label="内容生成阶段">
        {detail.stageEvents.length ? detail.stageEvents.map((event) => (
          <li key={event.eventId} className="rounded-2xl border border-border-subtle bg-surface-elevated p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-semibold text-text-primary">{getStageLabel(event.stage)}</span>
              <span className={event.status === "FAILED" ? "text-danger" : event.status === "SUCCEEDED" ? "text-success" : "text-info"}>{formatStageStatus(event.status)}</span>
            </div>
            <pre className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-surface-muted p-3 text-xs leading-5 text-text-muted">{event.details?.label ?? event.message ?? "暂无阶段说明"}</pre>
          </li>
        )) : <li className="text-sm text-text-muted">worker 尚未写入阶段事件。</li>}
      </ol>
    </div>
  );
}

function ResultPanel({ result }: { result: FinalOutput }) {
  return (
    <div className="mt-6 space-y-6">
      <section className="rounded-2xl border border-border-subtle bg-surface-elevated p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-text-primary">脚本文案</h3>
          <span className="text-xs text-text-muted">估算 {result.metadata.estimatedDurationSec}s</span>
        </div>
        <pre className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-text-muted">{formatScriptForDisplay(result.script)}</pre>
      </section>

      {result.warnings.length ? (
        <StatusMessage type="warning" title="生成提醒" message={result.warnings.join("；")} />
      ) : null}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-border-subtle bg-surface-selected p-6 text-sm leading-6 text-text-muted">
      第一版只生成 video_script。不会创建图片、扣点数、生成 social_post 或推荐发布时间。
    </div>
  );
}

function StatusBadge({ status }: { status: JobStatus }) {
  const className = status === "READY" ? "text-success" : status === "FAILED" ? "text-danger" : "text-info";
  return <span className={`rounded-xl border border-border-subtle bg-surface-muted px-3 py-1 text-xs font-semibold ${className}`}>{statusLabels[status]}</span>;
}

function getStageLabel(stage: string) {
  return stageLabels[stage] ?? stage;
}

function formatStageStatus(value: StageStatus) {
  if (value === "RUNNING") return "进行中";
  if (value === "SUCCEEDED") return "已完成";
  return "失败";
}

function formatScriptForDisplay(script: string) {
  return script.replace(/\[SECTION:([^\]]+)\]/g, (_, section: string) => `【${sectionDisplayLabels[section] ?? section}】`);
}

const sectionDisplayLabels: Record<string, string> = {
  hero: "开场吸引",
  features: "核心亮点",
  demo: "场景演示",
  comparison: "对比说明",
  summary: "总结收束",
  references: "参考依据",
  outro: "结尾行动",
};

function extractErrorMessage(data: unknown, fallback: string) {
  if (data && typeof data === "object") {
    const payload = data as { error?: unknown; message?: unknown };
    if (typeof payload.error === "string") return payload.error;
    if (typeof payload.message === "string") return payload.message;
  }
  return fallback;
}
