import type { TtsPanelProps } from "./types";
import { buildAudioFilename } from "./utils";

export function TtsPanel({
  isAuthenticated,
  hasPureVoice,
  hasSceneVoice,
  canSubmitTts,
  ttsText,
  ttsLoading,
  ttsResult,
  ttsHistory,
  scenes,
  selectedSceneKey,
  ttsUsedCount,
  onTtsTextChange,
  onSceneChange,
  onSubmitTts,
}: TtsPanelProps) {
  const trimmedLength = ttsText.trim().length;
  const isOverLimit = trimmedLength > 30;
  const canUseFreeTrial = !isAuthenticated && trimmedLength > 0 && trimmedLength <= 30 && ttsUsedCount < 1;
  const selectedScene = scenes.find((item) => item.key === selectedSceneKey) ?? null;
  const helperText = isAuthenticated
    ? selectedSceneKey
      ? hasSceneVoice
        ? `已选择场景：${selectedScene?.label ?? "场景版"}，接口会携带 instruction 字段。`
        : "如需选择场景，请先建立场景版声纹。"
      : hasPureVoice
        ? "纯粹版声纹已就绪，可以直接输入文本生成语音。"
        : "完成纯粹版声纹后，这里会开放语音合成。"
    : "匿名可免费生成 1 次 30 字内语音，继续使用请登录。";
  const buttonText = ttsLoading
    ? "合成中..."
    : isAuthenticated
      ? "生成语音"
      : canUseFreeTrial
        ? "生成语音（免费）"
        : isOverLimit
          ? "超30字，请登录"
          : "请登录后继续";

  return (
    <div className="app-card w-full p-6 sm:p-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">2. 文本转语音</h2>
          <p className="mt-2 text-sm leading-6 text-text-muted">
            {helperText}
          </p>
        </div>
        <span className="self-start rounded-full border border-border-subtle bg-surface-muted px-3 py-1 text-xs text-text-muted sm:self-auto">
          {trimmedLength}/500
        </span>
      </div>

      <label className="mt-6 block text-sm font-medium text-text-secondary" htmlFor="tts-text">
        输入文本
      </label>
      <label className="mt-4 block text-sm font-medium text-text-secondary" htmlFor="tts-scene">
        场景选择
      </label>
      <select
        id="tts-scene"
        className="app-input mt-3"
        value={selectedSceneKey}
        onChange={(event) => onSceneChange(event.target.value)}
        disabled={isAuthenticated && !hasSceneVoice && scenes.length > 0}
      >
        <option value="">不使用场景，生成纯粹版语音</option>
        {scenes.map((item) => (
          <option key={item.key} value={item.key}>
            {item.label}
          </option>
        ))}
      </select>
      {selectedScene ? (
        <p className="mt-2 text-xs leading-5 text-text-muted">instruction：{selectedScene.instruction}</p>
      ) : null}
      {isAuthenticated && !hasSceneVoice ? (
        <p className="mt-2 text-xs leading-5 text-danger">若要选择场景，请先到左侧建立场景版声纹。</p>
      ) : null}
      <textarea
        id="tts-text"
        className="app-input mt-3 min-h-44 resize-y"
        value={ttsText}
        onChange={(event) => onTtsTextChange(event.target.value)}
        maxLength={isAuthenticated ? 500 : 31}
        placeholder="欢迎使用语音复刻工作台"
      />

      <button type="button" className="app-button-primary mt-5 w-full" onClick={onSubmitTts} disabled={ttsLoading || !canSubmitTts}>
        {buttonText}
      </button>

      {ttsResult ? (
        <div className="mt-6 rounded-xl border border-success-border bg-success-surface p-4" role="status" aria-live="polite">
          <div className="text-sm text-success">任务已完成：{ttsResult.jobId}</div>
          <div className="mt-1 break-all text-sm text-success">voiceIdSnapshot：{ttsResult.voiceIdSnapshot}</div>
          <div className="mt-1 text-sm text-success">类型：{ttsResult.profileKind === "SCENE" ? "场景版" : "纯粹版"}</div>
          <div className="mt-4 w-full min-w-0 max-w-full overflow-hidden">
            <audio controls src={ttsResult.downloadUrl} />
          </div>
          <a
            className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-success px-4 py-3 text-sm font-semibold text-text-inverse transition hover:bg-action-primary"
            href={ttsResult.downloadUrl}
            download={buildAudioFilename(ttsResult.jobId)}
          >
            下载生成语音
          </a>
        </div>
      ) : null}

      {ttsHistory.length > 0 ? (
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-text-secondary">历史语音</h3>
          <div className="mt-3 flex flex-col gap-3">
            {ttsHistory.map((item) => (
              <div key={item.jobId} className="rounded-xl border border-border-subtle bg-surface-elevated p-3">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                  <div className="line-clamp-2 text-sm text-text-secondary">{item.text}</div>
                  <div className="shrink-0 text-xs text-text-muted">{new Date(item.createdAt).toLocaleString()}</div>
                </div>
                <div className="mt-2 text-xs text-text-muted">
                  {item.profileKind === "SCENE" ? `场景版${item.sceneKey ? ` · ${item.sceneKey}` : ""}` : "纯粹版"}
                </div>
                <div className="mt-2 w-full min-w-0 max-w-full overflow-hidden">
                  <audio controls src={item.downloadUrl} />
                </div>
                <a
                  className="mt-3 inline-flex w-full items-center justify-center rounded-xl border border-border-subtle bg-surface-muted px-3 py-2 text-xs font-semibold text-text-secondary transition hover:bg-surface-selected sm:w-auto"
                  href={item.downloadUrl}
                  download={buildAudioFilename(item.jobId)}
                >
                  下载
                </a>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-6 rounded-xl border border-dashed border-border-subtle bg-surface-muted p-5 text-sm text-text-muted">
          <div className="font-medium text-text-secondary">等待第一条历史语音</div>
          <p className="mt-2 leading-6">生成成功后，最近的语音任务会在这里保留播放和下载入口。</p>
          <p className="mt-1 leading-6">如果还没有 active voice，请先完成左侧建声录音。</p>
        </div>
      )}
    </div>
  );
}
