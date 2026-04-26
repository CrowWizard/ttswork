"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const MODULE_ITEMS = [
  { href: "/", label: "语音工作台" },
  { href: "/video-analysis", label: "B站视频分析" },
] as const;

export function WorkspaceModuleNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="工作区模块切换" className="app-panel flex flex-wrap gap-2 p-2">
      {MODULE_ITEMS.map((item) => {
        const isActive = pathname === item.href;

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={[
              "flex min-h-[44px] min-w-0 flex-1 items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold transition",
              isActive
                ? "border border-border-subtle bg-surface-elevated text-text-primary shadow-control"
                : "text-text-secondary hover:bg-surface-elevated hover:text-text-primary",
            ].join(" ")}
          >
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
