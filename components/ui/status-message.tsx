type StatusMessageProps = {
  type: "error" | "success" | "info" | "warning";
  message: string;
  title?: string;
  className?: string;
  id?: string;
};

const toneClassNameMap: Record<StatusMessageProps["type"], string> = {
  error: "border-danger-border bg-danger-surface text-danger",
  success: "border-success-border bg-success-surface text-success",
  info: "border-info-border bg-info-surface text-info",
  warning: "border-warning-border bg-warning-surface text-warning",
};

const ariaRoleMap: Record<StatusMessageProps["type"], { role: "alert" | "status"; ariaLive: "assertive" | "polite" }> = {
  error: { role: "alert", ariaLive: "assertive" },
  success: { role: "status", ariaLive: "polite" },
  info: { role: "status", ariaLive: "polite" },
  warning: { role: "status", ariaLive: "polite" },
};

const defaultTitleMap: Record<StatusMessageProps["type"], string> = {
  error: "需要处理",
  success: "已完成",
  info: "提示",
  warning: "请注意",
};

export function StatusMessage({ type, message, title = defaultTitleMap[type], className = "", id }: StatusMessageProps) {
  const aria = ariaRoleMap[type];

  return (
    <div
      id={id}
      className={`rounded-xl border px-4 py-3 text-sm ${toneClassNameMap[type]} ${className}`.trim()}
      role={aria.role}
      aria-live={aria.ariaLive}
      aria-atomic="true"
    >
      <div className="font-semibold">{title}</div>
      <div className="mt-1 leading-6">{message}</div>
    </div>
  );
}
