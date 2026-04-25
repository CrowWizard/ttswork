import Link from "next/link";
import type { WorkspaceHeaderProps } from "./types";

export function WorkspaceHeader({ authResolving, authUser, onLogout }: WorkspaceHeaderProps) {
  return (
    <section className="app-card w-full p-6 sm:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-4xl">语音复刻工作台</h1>
          <p className="mt-3 text-sm leading-6 text-text-muted">
            {authResolving
              ? "正在检查登录状态..."
              : authUser
              ? "支持按住录音建声，也支持键盘按一次开始、再按一次结束。建立声纹后即可输入文本生成语音。"
              : "未登录用户可试用1次，限30字内。点击右上角登录后可无限使用。"}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {!authUser ? (
            <button
              type="button"
              className="app-button-primary"
              onClick={() => {
                const event = new CustomEvent("open-voice-login-modal");
                window.dispatchEvent(event);
              }}
            >
              登录
            </button>
          ) : null}
          {authUser ? (
            <div className="app-panel px-4 py-4 text-sm text-text-secondary sm:max-w-xs">
              <div className="text-xs uppercase tracking-[0.18em] text-text-muted">当前账号</div>
              <div className="mt-1 break-all font-medium text-text-primary">{authUser.phoneNumber}</div>
              <div className="mt-1 text-xs text-text-muted">
                {authUser.hasPassword ? "已设置密码，可用密码或短信登录" : "未设置密码，目前仅支持短信登录"}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href="/settings" className="app-button-chip h-11 items-center justify-center">
                  个人设置
                </Link>
                <button type="button" className="app-button-chip h-11 items-center justify-center" onClick={onLogout}>
                  退出登录
                </button>
              </div>
            </div>
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border-subtle bg-surface-muted text-text-muted">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
