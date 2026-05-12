"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useAuth } from "./auth-context";

const MODULE_LINKS = [
  { href: "/", label: "语音工作台" },
  { href: "/video-analysis", label: "视频分析" },
] as const;

const BRAND_NAME = "UP创作台";

export function AppHeader() {
  const pathname = usePathname();
  const { authResolving, authUser, pointsBalance, redeemUsageCode, redeemingUsageCode, redeemMessage, setRedeemUsageCode, redeemUsageCodeForPoints, openLoginModal, logout } = useAuth();

  return (
    <header className="sticky top-0 z-40 w-full bg-surface">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 sm:gap-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 py-2 transition hover:opacity-80" aria-label={BRAND_NAME}>
          <Image src="/logo.svg" alt="" width={28} height={28} className="shrink-0" priority />
          <span className="hidden text-lg font-semibold text-text-primary sm:inline">{BRAND_NAME}</span>
        </Link>

        <nav className="flex h-14 items-center gap-1" aria-label="工作区模块">
          {MODULE_LINKS.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={[
                    "flex h-full w-20 items-center justify-center text-sm font-semibold transition sm:w-28",
                  isActive
                    ? "text-action-primary border-b-[2.5px] border-action-primary"
                    : "text-text-muted border-b-[2.5px] border-transparent hover:text-text-primary hover:border-border-strong",
                ].join(" ")}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
          {authResolving ? (
            <span className="text-sm text-text-muted">加载中...</span>
          ) : authUser ? (
            <>
              <div className="hidden items-center gap-2 lg:flex">
                <input
                  className="h-11 w-28 rounded-xl border border-border-subtle bg-surface-elevated px-3 text-sm tracking-[0.16em] text-text-primary outline-none transition focus:border-action-secondary"
                  value={redeemUsageCode}
                  onChange={(event) => setRedeemUsageCode(event.target.value.trim().slice(0, 6))}
                  placeholder="使用码"
                  autoComplete="one-time-code"
                  aria-label="兑换使用码"
                />
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border-subtle bg-surface-muted px-3 text-sm font-medium text-text-secondary transition hover:bg-surface-selected disabled:opacity-60"
                  onClick={() => void redeemUsageCodeForPoints()}
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
                <span className={redeemMessage.type === "error" ? "hidden text-sm text-danger xl:inline" : "hidden text-sm text-success xl:inline"}>
                  {redeemMessage.text}
                </span>
              ) : null}
              <details className="group relative">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl border border-border-subtle bg-surface-elevated px-3 text-sm font-medium text-text-secondary shadow-control transition hover:bg-surface-selected hover:text-text-primary [&::-webkit-details-marker]:hidden">
                  <span className="max-w-20 truncate sm:max-w-32">{authUser.phoneNumber}</span>
                  <svg className="h-4 w-4 transition group-open:rotate-180" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </summary>
                <div className="absolute right-0 top-full z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border-subtle bg-surface-elevated p-2 shadow-card sm:w-56">
                  <div className="px-3 py-2 text-xs leading-5 text-text-muted">当前账号</div>
                  <div className="border-b border-border-subtle px-3 pb-3 lg:hidden">
                    <div className="flex items-center justify-between gap-3 text-sm text-text-secondary">
                      <span>积分</span>
                      <span className="font-semibold text-text-primary">{pointsBalance}</span>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <input
                        className="min-h-11 min-w-0 flex-1 rounded-xl border border-border-subtle bg-surface px-3 text-sm tracking-[0.16em] text-text-primary outline-none transition focus:border-action-secondary"
                        value={redeemUsageCode}
                        onChange={(event) => setRedeemUsageCode(event.target.value.trim().slice(0, 6))}
                        placeholder="使用码"
                        autoComplete="one-time-code"
                        aria-label="兑换使用码"
                      />
                      <button
                        type="button"
                        className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border-subtle bg-surface-muted px-3 text-sm font-medium text-text-secondary transition hover:bg-surface-selected disabled:opacity-60"
                        onClick={() => void redeemUsageCodeForPoints()}
                        disabled={redeemingUsageCode || redeemUsageCode.trim().length !== 6}
                      >
                        {redeemingUsageCode ? "兑换中" : "兑换"}
                      </button>
                    </div>
                    {redeemMessage ? (
                      <div className={redeemMessage.type === "error" ? "mt-2 text-sm text-danger" : "mt-2 text-sm text-success"}>
                        {redeemMessage.text}
                      </div>
                    ) : null}
                  </div>
                  <Link
                    href="/settings"
                    className="flex min-h-10 items-center rounded-xl px-3 text-sm text-text-secondary transition hover:bg-surface-muted hover:text-text-primary"
                  >
                    个人设置
                  </Link>
                  <button
                    type="button"
                    className="flex min-h-10 w-full items-center rounded-xl px-3 text-left text-sm text-text-secondary transition hover:bg-surface-muted hover:text-text-primary"
                    onClick={() => void logout()}
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
                onClick={openLoginModal}
              >
                登录
              </button>
            </>
          )}
        </div>
      </div>
      <div className="border-b border-border-subtle" />
    </header>
  );
}
