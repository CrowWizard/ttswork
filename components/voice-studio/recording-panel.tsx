import { StatusMessage } from "@/components/ui/status-message";
import { MIN_RECORD_SECONDS } from "@/lib/constants";
import { useState } from "react";
import type { RecordingPanelProps } from "./types";
import { formatDuration } from "./utils";
import { useRecordingElapsedSeconds } from "./use-recording-elapsed-seconds";

function RecordingElapsedStatus({ recording, recordStartedAt }: { recording: boolean; recordStartedAt: number | null }) {
  const elapsedSeconds = useRecordingElapsedSeconds(recording, recordStartedAt);
  const recordingStatusText = recording
    ? `录音中，当前已录制 ${formatDuration(elapsedSeconds)}。再次按键或松开按钮即可结束。`
    : `可通过按住按钮或使用键盘操作开始录音，至少录制 ${MIN_RECORD_SECONDS} 秒。`;

  return (
    <>
      {recording ? <div className="text-center text-sm font-medium text-danger">已说话：{formatDuration(elapsedSeconds)}</div> : null}

      <p id="recording-status" className="text-center text-sm text-text-secondary" aria-live="polite">
        {recordingStatusText}
      </p>
    </>
  );
}

function TaskHintList() {
  return (
    <div className="grid gap-3 text-sm text-text-secondary sm:grid-cols-3">
      <div className="rounded-xl border border-border-subtle bg-surface-muted p-3">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">Step 1</div>
        <div className="mt-1 font-medium text-text-primary">录一段清晰语音</div>
        <p className="mt-1 leading-5">保持环境安静，说满 {MIN_RECORD_SECONDS} 秒后松开按钮。</p>
      </div>
      <div className="rounded-xl border border-border-subtle bg-surface-muted p-3">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">Step 2</div>
        <div className="mt-1 font-medium text-text-primary">确认 active voice</div>
        <p className="mt-1 leading-5">建声成功后先回放，确认音色可用再继续合成。</p>
      </div>
      <div className="rounded-xl border border-border-subtle bg-surface-muted p-3">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">Step 3</div>
        <div className="mt-1 font-medium text-text-primary">输入文本生成</div>
        <p className="mt-1 leading-5">建议先用短句测试，再生成较长内容。</p>
      </div>
    </div>
  );
}

export function RecordingPanel({
  activeVoiceLabel,
  canPlaybackActiveVoice,
  activeVoicePlaybackUrl,
  loadingProfile,
  profile,
  recording,
  recordStartedAt,
  enrolling,
  invalidating,
  workspaceError,
  workspaceNotice,
  onRecordButtonMouseDown,
  onRecordButtonMouseUp,
  onRecordButtonMouseLeave,
  onRecordButtonTouchStart,
  onRecordButtonTouchEnd,
  onRecordButtonTouchCancel,
  onRecordButtonKeyDown,
  onInvalidateActiveVoice,
}: RecordingPanelProps) {
  const activeVoiceAudioUrl = activeVoicePlaybackUrl ?? profile?.activeVoice?.playbackUrl ?? null;
  const [playbackSeconds, setPlaybackSeconds] = useState(0);
  const activeVoiceDurationSeconds = profile?.activeVoice?.durationSeconds ?? 0;

  return (
    <div className="app-card w-full p-6 sm:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-semibold">1. 建声录音</h2>
          <span className="rounded-full bg-surface-muted px-3 py-1 text-xs text-text-muted">按住或键盘切换</span>
        </div>
        <div className="app-panel min-w-0 w-full px-4 py-3 sm:w-auto sm:max-w-sm sm:text-right">
          <div className="text-xs uppercase tracking-[0.18em] text-text-muted">active voice</div>
          <div className="mt-1 break-all text-sm font-medium text-text-primary" title={loadingProfile ? undefined : activeVoiceLabel}>
            {loadingProfile ? "加载中..." : activeVoiceLabel}
          </div>
        </div>
      </div>

      <div className="app-panel mt-6 p-4 sm:p-5">
        {canPlaybackActiveVoice && profile?.activeVoice ? (
          <>
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-text-secondary">当前声纹回放</div>
                <div className="mt-2 text-sm text-text-secondary">
                  {formatDuration(playbackSeconds)} / {formatDuration(activeVoiceDurationSeconds)}
                </div>
              </div>
              <button
                type="button"
                className="flex h-11 w-11 min-w-11 shrink-0 items-center justify-center rounded-2xl border border-danger-border bg-surface-elevated text-lg font-semibold text-danger transition hover:bg-danger-surface disabled:opacity-60"
                onClick={onInvalidateActiveVoice}
                disabled={invalidating}
                aria-label="作废当前 active voice"
              >
                {invalidating ? "…" : "×"}
              </button>
            </div>
            <div className="mt-4 flex min-w-0 flex-col gap-3">
              {activeVoiceAudioUrl ? (
                <div className="w-full min-w-0 max-w-full overflow-hidden sm:flex-1">
                  <audio
                    key={activeVoiceAudioUrl}
                    controls
                    src={activeVoiceAudioUrl}
                    onTimeUpdate={(event) => setPlaybackSeconds(event.currentTarget.currentTime)}
                    onLoadedMetadata={(event) => setPlaybackSeconds(event.currentTarget.currentTime)}
                    onEnded={() => setPlaybackSeconds(0)}
                  />
                </div>
              ) : (
                <div className="min-w-0 flex-1 rounded-xl border border-border-subtle bg-surface-muted px-4 py-3 text-sm text-text-muted">
                  正在准备录音回放...
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="mt-3 space-y-1 text-sm text-text-muted">
            <p>尚未建立声纹，请先录制至少 {MIN_RECORD_SECONDS} 秒语音。</p>
            <p>建声成功后，可在此回放或作废当前 active voice。</p>
          </div>
        )}
      </div>

      <div className="mt-5">
        <TaskHintList />
      </div>

      <div className="mt-8 flex flex-col gap-4">
        <p id="recording-help" className="text-center text-sm text-text-muted">
          鼠标或触屏按住开始、松开结束。
        </p>

        {enrolling ? (
          <p id="recording-status" className="text-center text-sm text-text-secondary" aria-live="polite">
            录音已结束，正在上传并建立声纹。
          </p>
        ) : invalidating ? (
          <p id="recording-status" className="text-center text-sm text-text-secondary" aria-live="polite">
            正在作废当前 active voice。
          </p>
        ) : (
          <RecordingElapsedStatus recording={recording} recordStartedAt={recordStartedAt} />
        )}

        <button
          type="button"
          onMouseDown={onRecordButtonMouseDown}
          onMouseUp={onRecordButtonMouseUp}
          onMouseLeave={onRecordButtonMouseLeave}
          onTouchStart={onRecordButtonTouchStart}
          onTouchEnd={onRecordButtonTouchEnd}
          onTouchCancel={onRecordButtonTouchCancel}
          onKeyDown={onRecordButtonKeyDown}
          className={`touch-none rounded-2xl px-6 py-8 text-lg font-semibold transition ${
            recording ? "bg-action-record-active text-text-inverse" : "bg-action-record text-text-primary hover:bg-action-record-hover"
          }`}
          disabled={enrolling || invalidating}
          aria-pressed={recording}
          aria-describedby="recording-help recording-status"
        >
          {recording ? "结束录音" : enrolling ? "上传并建立声纹中..." : `开始录音（至少 ${MIN_RECORD_SECONDS} 秒）`}
        </button>

        {workspaceError ? <StatusMessage message={workspaceError} type="error" title="建声操作失败" /> : null}
        {workspaceNotice ? <StatusMessage message={workspaceNotice.text} type={workspaceNotice.type} title={workspaceNotice.title} /> : null}
      </div>
    </div>
  );
}
