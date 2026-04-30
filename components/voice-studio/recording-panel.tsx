import { StatusMessage } from "@/components/ui/status-message";
import { getSupportedAudioAcceptValue } from "@/lib/audio-format";
import { MAX_RECORD_SECONDS, MIN_RECORD_SECONDS } from "@/lib/constants";
import type { RecordingPanelProps } from "./types";
import { formatDuration } from "./utils";
import { useRecordingElapsedSeconds } from "./use-recording-elapsed-seconds";

const AUDIO_FILE_ACCEPT_VALUE = getSupportedAudioAcceptValue();

function RecordingElapsedStatus({ recording, recordStartedAt }: { recording: boolean; recordStartedAt: number | null }) {
  const elapsedSeconds = useRecordingElapsedSeconds(recording, recordStartedAt);
  const recordingStatusText = recording
    ? `录音中，当前已录制 ${formatDuration(elapsedSeconds)}。最长 ${MAX_RECORD_SECONDS} 秒，到时会自动结束；也可再次点击提前结束。`
    : `点击按钮开始录音，再次点击结束，至少录制 ${MIN_RECORD_SECONDS} 秒，最长 ${MAX_RECORD_SECONDS} 秒会自动结束。`;

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
    <div className="rounded-2xl border border-border-subtle bg-surface-muted p-3 text-sm text-text-secondary sm:grid sm:grid-cols-2 sm:gap-3">
      <div className="p-3">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">Step 1</div>
        <div className="mt-1 font-medium text-text-primary">上传或录制清晰语音</div>
        <p className="mt-1 leading-5">上传音频的声音效果更好，建议优先上传清晰的语音文件（MP3、WAV、W4V），时长需不少于 {MIN_RECORD_SECONDS} 秒；也可点击录音按钮进行录制。</p>
      </div>

      <div className="border-t border-border-subtle p-3 sm:border-l sm:border-t-0">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">Step 2</div>
        <div className="mt-1 font-medium text-text-primary">等待声纹自动生成</div>
        <p className="mt-1 leading-5">上传或录制完成后，系统会自动生成纯粹版和场景版声纹，生成完毕即可输入文本进行语音合成。</p>
      </div>
    </div>
  );
}

export function RecordingPanel({
  loadingProfile,
  profile,
  recording,
  recordStartedAt,
  uploading,
  deletingRecordingId,
  onDeleteRecording,
  onUploadAudioFile,
  workspaceError,
  workspaceNotice,
  onRecordButtonClick,
  enrollmentPolling,
  enrollmentPollingMessage,
}: RecordingPanelProps) {
  const activePureVoice = profile?.activeVoices.pure ?? null;
  const activeSceneVoice = profile?.activeVoices.scene ?? null;
  const latestRecording = profile?.recordings?.[0] ?? null;

  function VoiceCard({
    title,
    voice,
  }: {
    title: string;
    voice: NonNullable<RecordingPanelProps["profile"]>["activeVoices"]["pure"];
  }) {
    if (!voice) {
      return (
        <div className="rounded-xl border border-dashed border-border-subtle bg-surface-muted p-4 text-sm text-text-muted">
          {title}尚未建立。
        </div>
      );
    }

    return (
      <div className="rounded-xl border border-border-subtle bg-surface-elevated p-4">
        <div className="min-w-0">
          <div className="text-sm font-medium text-text-secondary">{title}</div>
          <div className="mt-1 break-all text-sm text-text-primary">{voice.voiceId ?? "处理中"}</div>
          <div className="mt-2 text-xs text-text-muted">{voice.isInvalidated ? "已作废" : `Enrollment ID：${voice.id}`}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-card w-full p-6 sm:p-8">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-semibold">上传或录制语音</h2>
        <span className="rounded-full bg-surface-muted px-3 py-1 text-xs text-text-muted">支持录音和文件上传</span>
      </div>

      <div className="mt-5">
        <TaskHintList />
      </div>

      <div className="mt-8 flex flex-col gap-4">
        <div className="rounded-2xl border border-info-border bg-info-surface px-4 py-3 text-sm text-info">
          上传音频的声音效果更好，建议优先上传清晰的语音文件。（建议不要超过30秒）
        </div>

        <div className="flex overflow-hidden rounded-2xl border border-border-subtle">
          <label
            className={`relative flex-1 cursor-pointer items-center justify-center px-6 py-8 text-lg font-semibold transition focus-within:z-10 focus-within:ring-2 focus-within:ring-action-secondary focus-within:ring-offset-2 focus-within:ring-offset-canvas ${
              uploading || enrollmentPolling || Boolean(deletingRecordingId) || recording
                ? "pointer-events-none bg-surface-muted text-text-muted opacity-60"
                : "bg-action-record text-text-primary hover:bg-action-record-hover"
            } flex`}
            aria-label="音频上传"
          >
            <input
              type="file"
              accept={AUDIO_FILE_ACCEPT_VALUE}
              className="sr-only"
              disabled={uploading || enrollmentPolling || Boolean(deletingRecordingId) || recording}
              onChange={(event) => {
                onUploadAudioFile(event.target.files?.[0] ?? null);
                event.currentTarget.value = "";
              }}
            />
            {uploading ? "上传录音中..." : "音频上传"}
          </label>

          <button
            type="button"
            onClick={onRecordButtonClick}
            className={`touch-none w-36 shrink-0 px-4 text-sm font-medium border-l border-border-subtle transition ${
              recording ? "bg-action-record-active text-text-inverse" : "bg-surface-elevated text-text-primary hover:bg-surface-muted"
            }`}
            disabled={uploading || enrollmentPolling || Boolean(deletingRecordingId)}
            aria-pressed={recording}
            aria-describedby="recording-help recording-status"
          >
            {recording ? "结束录音" : `录音（${MIN_RECORD_SECONDS}-${MAX_RECORD_SECONDS}s）`}
          </button>
        </div>

        <p id="recording-help" className="text-center text-sm text-text-muted">
          优先上传音频文件；也可点击右侧按钮进行录音，单次最长 {MAX_RECORD_SECONDS} 秒。
        </p>

        <div className="app-panel p-4 sm:p-5">
          <div className="text-sm font-medium text-text-secondary">当前录音素材</div>
          {loadingProfile ? (
            <div className="mt-3 text-sm text-text-muted">录音素材加载中...</div>
          ) : latestRecording ? (
            <div className="mt-4">
              <div className="rounded-xl border border-border-subtle bg-surface-elevated p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-text-primary">{latestRecording.originalFilename ?? `录音 ${latestRecording.id}`}</div>
                    <div className="mt-1 text-xs text-text-muted">{formatDuration(latestRecording.durationSeconds)} · {new Date(latestRecording.createdAt).toLocaleString()}</div>
                  </div>
                  <button
                    type="button"
                    className="flex h-11 w-11 min-w-11 self-center shrink-0 items-center justify-center rounded-xl border border-danger-border text-sm font-semibold leading-none text-danger transition hover:bg-danger-surface disabled:opacity-60"
                    onClick={() => {
                      if (latestRecording) {
                        onDeleteRecording(latestRecording.id);
                      }
                    }}
                    disabled={deletingRecordingId === latestRecording.id || uploading || enrollmentPolling}
                    aria-label="删除录音素材"
                  >
                    {deletingRecordingId === latestRecording.id ? "…" : "×"}
                  </button>
                </div>
                <div className="mt-3 w-full min-w-0 max-w-full overflow-hidden">
                  <audio controls src={latestRecording.playbackUrl} />
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-3 space-y-1 text-sm text-text-muted">
              <p>还没有上传录音，请先上传或录制至少 {MIN_RECORD_SECONDS} 秒语音。</p>
            </div>
          )}
        </div>

        {enrollmentPolling && (
          <div className="rounded-xl border border-info-border bg-info-surface px-4 py-3 text-sm text-info">
            {enrollmentPollingMessage ?? "正在自动生成声纹，请稍等..."}
          </div>
        )}

        {uploading ? (
          <p id="recording-status" className="text-center text-sm text-text-secondary" aria-live="polite">
            音频正在上传并保存。
          </p>
        ) : deletingRecordingId ? (
          <p id="recording-status" className="text-center text-sm text-text-secondary" aria-live="polite">
            正在删除录音素材。
          </p>
        ) : (
          <RecordingElapsedStatus recording={recording} recordStartedAt={recordStartedAt} />
        )}

        {workspaceError ? <StatusMessage message={workspaceError} type="error" title="操作失败" /> : null}
        {workspaceNotice ? <StatusMessage message={workspaceNotice.text} type={workspaceNotice.type} title={workspaceNotice.title} /> : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <VoiceCard title="纯粹版声纹" voice={activePureVoice} />
          <VoiceCard title="场景版声纹" voice={activeSceneVoice} />
        </div>
      </div>
    </div>
  );
}
