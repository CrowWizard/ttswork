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
    <div className="rounded-2xl border border-border-subtle bg-surface-muted p-3 text-sm text-text-secondary sm:grid sm:grid-cols-3 sm:gap-3">
      <div className="p-3">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">Step 1</div>
        <div className="mt-1 font-medium text-text-primary">录音或上传清晰语音</div>
        <p className="mt-1 leading-5">可点击开始/结束录音，单次录音最长 {MAX_RECORD_SECONDS} 秒会自动结束；也可上传 MP3、WAV、W4V 文件，音频时长需不少于 {MIN_RECORD_SECONDS} 秒。</p>
      </div>

      <div className="border-t border-border-subtle p-3 sm:border-l sm:border-t-0">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">Step 2</div>
        <div className="mt-1 font-medium text-text-primary">选择录音建立声纹</div>
        <p className="mt-1 leading-5">从最新三份录音素材中选择一份，再建立纯粹版或场景版声纹。</p>
      </div>

      <div className="border-t border-border-subtle p-3 sm:border-l sm:border-t-0">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">Step 3</div>
        <div className="mt-1 font-medium text-text-primary">输入文本生成</div>
        <p className="mt-1 leading-5">建议先用短句测试，再生成较长内容。</p>
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
  creatingPureVoice,
  creatingSceneVoice,
  invalidatingVoiceId,
  deletingRecordingId,
  selectedRecordingId,
  onSelectRecording,
  onDeleteRecording,
  onUploadAudioFile,
  workspaceError,
  workspaceNotice,
  onRecordButtonClick,
  onCreatePureVoice,
  onCreateSceneVoice,
  onInvalidateVoice,
}: RecordingPanelProps) {
  const activePureVoice = profile?.activeVoices.pure ?? null;
  const activeSceneVoice = profile?.activeVoices.scene ?? null;
  const orderedRecordings = profile?.recordings ? [...profile.recordings].reverse() : [];

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
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-text-secondary">{title}</div>
            <div className="mt-1 break-all text-sm text-text-primary">{voice.voiceId ?? "处理中"}</div>
          </div>
          <button
            type="button"
            className="flex h-11 w-11 min-w-11 shrink-0 items-center justify-center rounded-2xl border border-danger-border bg-surface-elevated text-lg font-semibold text-danger transition hover:bg-danger-surface disabled:opacity-60"
            onClick={() => onInvalidateVoice(voice.id)}
            disabled={invalidatingVoiceId === voice.id}
            aria-label={`作废${title}`}
          >
            {invalidatingVoiceId === voice.id ? "…" : "×"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-card w-full p-6 sm:p-8">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-semibold">1. 建声录音</h2>
        <span className="rounded-full bg-surface-muted px-3 py-1 text-xs text-text-muted">支持录音和文件上传</span>
      </div>

      <div className="mt-5">
        <TaskHintList />
      </div>

      <div className="mt-8 flex flex-col gap-4">
        <div className="flex overflow-hidden rounded-2xl border border-border-subtle">
          <button
            type="button"
            onClick={onRecordButtonClick}
            className={`touch-none flex-1 px-6 py-8 text-lg font-semibold transition ${
              recording ? "bg-action-record-active text-text-inverse" : "bg-action-record text-text-primary hover:bg-action-record-hover"
            }`}
            disabled={uploading || creatingPureVoice || creatingSceneVoice || Boolean(invalidatingVoiceId) || Boolean(deletingRecordingId)}
            aria-pressed={recording}
            aria-describedby="recording-help recording-status"
          >
            {recording ? "结束录音" : uploading ? "上传录音中..." : `开始录音（${MIN_RECORD_SECONDS}-${MAX_RECORD_SECONDS} 秒）`}
          </button>

          <label
            className={`relative flex w-28 shrink-0 items-center justify-center border-l border-border-subtle px-4 text-sm font-medium transition sm:w-32 ${
              uploading || creatingPureVoice || creatingSceneVoice || Boolean(invalidatingVoiceId) || Boolean(deletingRecordingId) || recording
                ? "pointer-events-none bg-surface-muted text-text-muted opacity-60"
                : "cursor-pointer bg-surface-elevated text-text-primary hover:bg-surface-muted"
            }`}
            aria-label="音频上传"
          >
            <input
              type="file"
              accept={AUDIO_FILE_ACCEPT_VALUE}
              className="sr-only"
              disabled={uploading || creatingPureVoice || creatingSceneVoice || Boolean(invalidatingVoiceId) || Boolean(deletingRecordingId) || recording}
              onChange={(event) => {
                onUploadAudioFile(event.target.files?.[0] ?? null);
                event.currentTarget.value = "";
              }}
            />
            音频上传
          </label>
        </div>

        <p id="recording-help" className="text-center text-sm text-text-muted">
          点击开始录音，再次点击结束；单次录音最长 {MAX_RECORD_SECONDS} 秒会自动结束，也可直接上传 MP3、WAV、W4V 文件。
        </p>

        <div className="app-panel p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium text-text-secondary">当前录音素材</div>
            <div className="text-xs text-text-muted">仅显示最新 3 份</div>
          </div>
          {loadingProfile ? (
            <div className="mt-3 text-sm text-text-muted">录音素材加载中...</div>
          ) : orderedRecordings.length ? (
            <div className="mt-4 flex flex-col gap-3">
              {orderedRecordings.map((item) => (
                <label key={item.id} className={`rounded-xl border p-3 ${selectedRecordingId === item.id ? "border-action-primary bg-surface-selected" : "border-border-subtle bg-surface-elevated"}`}>
                  <div className="flex items-center gap-3">
                    <input type="radio" name="recording" className="self-start mt-1" checked={selectedRecordingId === item.id} onChange={() => onSelectRecording(item.id)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-text-primary">{item.originalFilename ?? `录音 ${item.id}`}</div>
                          <div className="mt-1 text-xs text-text-muted">{formatDuration(item.durationSeconds)} · {new Date(item.createdAt).toLocaleString()}</div>
                        </div>
                        <button
                          type="button"
                          className="flex h-9 w-9 min-w-9 self-center shrink-0 items-center justify-center rounded-xl border border-danger-border text-sm font-semibold leading-none text-danger transition hover:bg-danger-surface disabled:opacity-60"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onDeleteRecording(item.id);
                          }}
                          disabled={deletingRecordingId === item.id || creatingPureVoice || creatingSceneVoice || uploading}
                          aria-label="删除录音素材"
                        >
                          {deletingRecordingId === item.id ? "…" : "×"}
                        </button>
                      </div>
                      <div className="mt-3 w-full min-w-0 max-w-full overflow-hidden">
                        <audio controls src={item.playbackUrl} />
                      </div>
                    </div>
                  </div>
                </label>
              ))}
            </div>
          ) : (
            <div className="mt-3 space-y-1 text-sm text-text-muted">
              <p>还没有上传录音，请先录制或上传至少 {MIN_RECORD_SECONDS} 秒语音。</p>
              <p>上传后的录音会先保存，并作为后续建立纯粹版/场景版声纹的素材。</p>
            </div>
          )}
        </div>

        {uploading ? (
          <p id="recording-status" className="text-center text-sm text-text-secondary" aria-live="polite">
            音频正在上传并保存。
          </p>
        ) : deletingRecordingId ? (
          <p id="recording-status" className="text-center text-sm text-text-secondary" aria-live="polite">
            正在删除录音素材。
          </p>
        ) : invalidatingVoiceId ? (
          <p id="recording-status" className="text-center text-sm text-text-secondary" aria-live="polite">
            正在作废当前声纹。
          </p>
        ) : (
          <RecordingElapsedStatus recording={recording} recordStartedAt={recordStartedAt} />
        )}

        {workspaceError ? <StatusMessage message={workspaceError} type="error" title="建声操作失败" /> : null}
        {workspaceNotice ? <StatusMessage message={workspaceNotice.text} type={workspaceNotice.type} title={workspaceNotice.title} /> : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <button type="button" className="app-button-primary w-full" disabled={!selectedRecordingId || creatingPureVoice || uploading || Boolean(deletingRecordingId)} onClick={onCreatePureVoice}>
            {creatingPureVoice ? "建立纯粹版声纹中..." : "2. 建立纯粹版声纹"}
          </button>
          <button type="button" className="app-button-primary w-full" disabled={!selectedRecordingId || creatingSceneVoice || uploading || Boolean(deletingRecordingId)} onClick={onCreateSceneVoice}>
            {creatingSceneVoice ? "建立场景版声纹中..." : "2. 建立场景版声纹"}
          </button>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <VoiceCard title="纯粹版声纹" voice={activePureVoice} />
          <VoiceCard title="场景版声纹" voice={activeSceneVoice} />
        </div>
      </div>
    </div>
  );
}
