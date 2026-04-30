import Link from "next/link";
import type { UserHeaderProps } from "./types";

export function UserHeader({
  authResolving,
  authUser,
  pointsBalance,
  redeemUsageCode,
  redeemingUsageCode,
  redeemMessage,
  onRedeemUsageCodeChange,
  onRedeemUsageCode,
  onLogout,
}: UserHeaderProps) {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border-subtle bg-surface shadow-panel">
      <div className="mx-auto flex min-h-14 max-w-5xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold text-text-primary">语音复刻工作台</span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {authResolving ? (
            <span className="text-sm text-text-muted">加载中...</span>
          ) : authUser ? (
            <>
              <div className="flex items-center gap-2">
                <input
                  className="h-11 w-28 rounded-xl border border-border-subtle bg-surface-elevated px-3 text-sm tracking-[0.16em] text-text-primary outline-none transition focus:border-action-secondary"
                  value={redeemUsageCode}
                  onChange={(event) => onRedeemUsageCodeChange(event.target.value.trim().slice(0, 6))}
                  placeholder="使用码"
                  autoComplete="one-time-code"
                  aria-label="兑换使用码"
                />
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border-subtle bg-surface-muted px-3 text-sm font-medium text-text-secondary transition hover:bg-surface-selected disabled:opacity-60"
                  onClick={onRedeemUsageCode}
                  disabled={redeemingUsageCode || redeemUsageCode.trim().length !== 6}
                >
                  {redeemingUsageCode ? "兑换中" : "兑换"}
                </button>
                <span
                  className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-text-secondary"
                  aria-label={`积分 ${pointsBalance}`}
                >
                  <svg className="h-4 w-4 text-action-secondary" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M12 3.5l2.42 4.9 5.4.78-3.91 3.82.92 5.38L12 15.84l-4.83 2.54.92-5.38-3.91-3.82 5.4-.78L12 3.5z"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span>{pointsBalance}</span>
                </span>
              </div>
              {redeemMessage ? (
                <span className={redeemMessage.type === "error" ? "text-sm text-danger" : "text-sm text-success"}>
                  {redeemMessage.text}
                </span>
              ) : null}
              <details className="group relative">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl border border-border-subtle bg-surface-elevated px-3 text-sm font-medium text-text-secondary shadow-control transition hover:bg-surface-selected hover:text-text-primary [&::-webkit-details-marker]:hidden">
                  <span className="max-w-32 truncate">{authUser.phoneNumber}</span>
                  <svg className="h-4 w-4 transition group-open:rotate-180" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </summary>
                <div className="absolute right-0 top-full z-50 mt-2 w-44 overflow-hidden rounded-2xl border border-border-subtle bg-surface-elevated p-1 shadow-card">
                  <div className="px-3 py-2 text-xs leading-5 text-text-muted">当前账号</div>
                  <Link
                    href="/settings"
                    className="flex min-h-10 items-center rounded-xl px-3 text-sm text-text-secondary transition hover:bg-surface-muted hover:text-text-primary"
                  >
                    个人设置
                  </Link>
                  <button
                    type="button"
                    className="flex min-h-10 w-full items-center rounded-xl px-3 text-left text-sm text-text-secondary transition hover:bg-surface-muted hover:text-text-primary"
                    onClick={onLogout}
                  >
                    退出登录
                  </button>
                </div>
              </details>
            </>
          ) : (
            <>
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border-subtle bg-surface-muted text-text-muted">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
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
            </>
          )}
        </div>
      </div>
    </header>
  );
}
