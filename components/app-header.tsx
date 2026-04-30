"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const MODULE_LINKS = [
  { href: "/", label: "语音工作台" },
  { href: "/video-analysis", label: "视频分析" },
] as const;

type AppHeaderProps = {
  children?: ReactNode;
};

export function AppHeader({ children }: AppHeaderProps) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border-subtle bg-surface shadow-panel">
      <div className="mx-auto flex min-h-14 max-w-5xl flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <Link href="/" className="shrink-0 text-lg font-semibold text-text-primary transition hover:text-action-primary">
            语音复刻工作台
          </Link>

          <div className="inline-flex w-full rounded-2xl border border-border-subtle bg-surface-muted p-1 sm:w-auto" aria-label="工作区模块">
            {MODULE_LINKS.map((item) => {
              const isActive = pathname === item.href;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={[
                    "flex min-h-10 flex-1 items-center justify-center rounded-xl px-3 text-sm font-semibold transition sm:flex-none sm:px-4",
                    isActive
                      ? "bg-surface-elevated text-text-primary shadow-control"
                      : "text-text-secondary hover:bg-surface-selected hover:text-text-primary",
                  ].join(" ")}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>

        {children ? <div className="flex flex-wrap items-center gap-3">{children}</div> : null}
      </div>
    </header>
  );
}
