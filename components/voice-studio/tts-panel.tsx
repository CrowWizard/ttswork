import type { TtsPanelProps } from "./types";
import { buildAudioFilename } from "./utils";

function formatAccessKind(accessKind: NonNullable<TtsPanelProps["ttsResult"]>["accessKind"]) {
  if (accessKind === "POINTS") {
    return "积分消耗";
  }

  if (accessKind === "GENERAL_USAGE_CODE") {
    return "通用使用码";
  }

  if (accessKind === "USAGE_CODE") {
    return "非通用使用码";
  }

  return "免费生成";
}

export function TtsPanel({
  isAuthenticated,
  hasPureVoice,
  hasSceneVoice,
  canSubmitTts,
  ttsText,
  ttsUsage,
  ttsLoading,
  ttsResult,
  ttsError,
  ttsHistory,
  scenes,
  selectedSceneKey,
  onTtsTextChange,
  onSceneChange,
  onSubmitTts,
}: TtsPanelProps) {
  const trimmedLength = ttsText.trim().length;
  const textLimit = 500;
  const pointsBalance = ttsUsage?.pointsBalance ?? 0;
  const ttsCostPoints = ttsUsage?.ttsCostPoints ?? 20;
  const selectedScene = scenes.find((item) => item.key === selectedSceneKey) ?? null;
  const sceneSelectionDisabled = isAuthenticated && !hasSceneVoice && scenes.length > 0;
  const helperText = isAuthenticated
    ? selectedSceneKey
      ? hasSceneVoice
        ? `已选择场景：${selectedScene?.label ?? "场景版"}，接口会携带 instruction 字段。`
        : "如需选择场景，请先上传或录制语音并等待场景版声纹自动生成。"
      : hasPureVoice
        ? "纯粹版声纹已就绪，可以直接输入文本生成语音。"
        : "上传或录制语音后，系统会自动生成声纹，完成后即可进行语音合成。"
    : "登录后获赠 100 积分，每次文本转语音消耗 20 积分。";
  const buttonText = ttsLoading ? "合成中..." : "生成语音";
  const selectedSceneSummary = selectedScene
    ? {
        badge: "已选场景",
        title: selectedScene.label,
        body: selectedScene.instruction,
      }
    : {
        badge: "当前模式",
        title: "纯粹版语音",
        body: "不携带 instruction，直接使用纯粹版声纹生成语音。",
      };

  return (
    <div className="app-card w-full p-6 sm:p-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">文本转语音</h2>
          <p className="mt-2 text-sm leading-6 text-text-muted">
            {helperText}
          </p>
        </div>
        <span className="self-start rounded-full border border-border-subtle bg-surface-muted px-3 py-1 text-xs text-text-muted sm:self-auto">
          {trimmedLength}/{textLimit}
        </span>
      </div>

      <label className="mt-6 block text-sm font-medium text-text-secondary" htmlFor="tts-scene">
        场景选择
      </label>
      <div className="mt-3 rounded-[20px] border border-border-subtle bg-surface-selected p-2 shadow-panel transition hover:border-border-strong focus-within:border-action-secondary">
        <div className="relative">
          <select
            id="tts-scene"
            className="min-h-[56px] w-full appearance-none rounded-[18px] border border-border-subtle bg-surface-elevated py-4 pl-4 pr-16 text-sm font-medium text-text-primary shadow-control transition hover:border-border-strong focus:border-action-secondary disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-muted"
            value={selectedSceneKey}
            onChange={(event) => onSceneChange(event.target.value)}
            disabled={sceneSelectionDisabled}
            aria-describedby="tts-scene-summary"
          >
            <option value="">不使用场景，生成纯粹版语音</option>
            {scenes.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>

          <div className="pointer-events-none absolute inset-y-2 right-2 flex items-center rounded-2xl border border-border-subtle bg-surface-muted px-3 text-text-secondary shadow-control">
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>

        <div id="tts-scene-summary" className="mt-2 rounded-[18px] border border-border-subtle bg-surface-muted px-4 py-3 text-sm text-text-secondary">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-border-subtle bg-surface-elevated px-2.5 py-1 text-[11px] font-semibold tracking-[0.08em] text-text-muted">
              {selectedSceneSummary.badge}
            </span>
            <span className="font-medium text-text-primary">{selectedSceneSummary.title}</span>
          </div>
          <p className="mt-2 leading-6 text-text-muted">{selectedSceneSummary.body}</p>
        </div>
      </div>

      {isAuthenticated && !hasSceneVoice ? (
        <p className="mt-2 text-xs leading-5 text-danger">若要选择场景，请先到左侧上传或录制语音，等待场景版声纹自动生成。</p>
      ) : null}

      {isAuthenticated ? (
        <div className="mt-5 rounded-2xl border border-info-border bg-info-surface p-4 text-sm text-info">
          <div className="font-medium">积分生成</div>
          <p className="mt-1 leading-6">
            每次生成消耗 {ttsCostPoints} 积分，当前余额 {pointsBalance} 积分。余额不足可在顶部输入使用码兑换。
          </p>
          {pointsBalance < ttsCostPoints ? (
            <p className="mt-2 text-xs leading-5 text-danger">积分余额不足，请先兑换积分。</p>
          ) : null}
        </div>
      ) : null}

      <label className="mt-5 block text-sm font-medium text-text-secondary" htmlFor="tts-text">
        输入文本
      </label>
      <textarea
        id="tts-text"
        className="app-input mt-3 min-h-44 resize-y"
        value={ttsText}
        onChange={(event) => onTtsTextChange(event.target.value)}
        maxLength={textLimit}
        placeholder="请输入需要生成的文本"
      />

      {!isAuthenticated ? (
        <p className="mt-3 rounded-xl border border-warning-border bg-warning-surface px-4 py-3 text-sm leading-6 text-warning">
          请先登录后使用积分生成语音。
        </p>
      ) : null}

      {ttsError ? (
        <div className="relative mt-4 rounded-xl border border-danger-border bg-danger-surface px-4 py-3 text-sm leading-6 text-danger" role="alert">
          <div className="pr-8">{ttsError}</div>
          <svg className="absolute right-3 top-3 h-5 w-5 shrink-0 text-danger" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
          </svg>
        </div>
      ) : null}

      <button type="button" className="app-button-primary mt-5 w-full" onClick={onSubmitTts} disabled={ttsLoading || !canSubmitTts}>
        {buttonText}
      </button>

      {ttsResult ? (
        <div className="mt-6 rounded-xl border border-success-border bg-success-surface p-4" role="status" aria-live="polite">
          <div className="text-sm text-success">任务已完成：{ttsResult.jobId}</div>
          <div className="mt-1 break-all text-sm text-success">voiceIdSnapshot：{ttsResult.voiceIdSnapshot}</div>
          <div className="mt-1 text-sm text-success">类型：{ttsResult.profileKind === "SCENE" ? "场景版" : "纯粹版"}</div>
          <div className="mt-1 text-sm text-success">来源：{formatAccessKind(ttsResult.accessKind)}</div>
          <div className="mt-4 w-full min-w-0 max-w-full overflow-hidden">
            <audio controls src={ttsResult.downloadUrl} />
          </div>
          <div className="mt-4 flex justify-end">
            <a
              className="inline-flex items-center justify-center rounded-xl bg-success px-4 py-3 text-sm font-semibold text-text-inverse transition hover:bg-action-primary"
              href={ttsResult.downloadUrl}
              download={buildAudioFilename(ttsResult.jobId)}
            >
              下载生成语音
            </a>
          </div>
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
                  <span> · {formatAccessKind(item.accessKind)}</span>
                </div>
                <div className="mt-2 w-full min-w-0 max-w-full overflow-hidden">
                  <audio controls src={item.downloadUrl} />
                </div>
                <div className="mt-3 flex justify-end">
                  <a
                    className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border-subtle bg-surface-muted px-3 py-2 text-xs font-semibold text-text-secondary transition hover:bg-surface-selected"
                    href={item.downloadUrl}
                    download={buildAudioFilename(item.jobId)}
                  >
                    下载
                  </a>
                </div>
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
