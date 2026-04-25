import Link from "next/link";
import type { KeyboardEvent } from "react";
import { StatusMessage } from "@/components/ui/status-message";
import type { AuthPanelProps } from "./types";

export function AuthPanel({
  authMode,
  authPhoneNumber,
  smsCode,
  password,
  authSubmitting,
  sendingSms,
  smsCountdown,
  authMessage,
  debugCode,
  onAuthModeChange,
  onPhoneNumberChange,
  onSmsCodeChange,
  onPasswordChange,
  onSendSms,
  onSubmitSmsLogin,
  onSubmitPasswordLogin,
}: AuthPanelProps) {
  const handleAuthModeKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    let nextMode = authMode;

    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextMode = authMode === "sms" ? "password" : "sms";
    } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextMode = authMode === "sms" ? "password" : "sms";
    } else if (event.key === "Home") {
      nextMode = "sms";
    } else if (event.key === "End") {
      nextMode = "password";
    } else {
      return;
    }

    event.preventDefault();
    onAuthModeChange(nextMode);
    window.requestAnimationFrame(() => {
      document.getElementById(`auth-mode-${nextMode}-tab`)?.focus();
    });
  };

  const smsButtonLabel = sendingSms ? "发送中..." : smsCountdown > 0 ? `${smsCountdown}s 后重发` : "发送验证码";

  return (
    <section className="app-card mx-auto w-full max-w-md p-6 sm:p-8">
      <div className="space-y-6">
        {/* Tab切换 */}
        <div
          className="flex rounded-xl border border-border-subtle bg-surface-muted p-1"
          role="tablist"
          aria-label="登录方式"
        >
          <button
            id="auth-mode-sms-tab"
            type="button"
            role="tab"
            aria-selected={authMode === "sms"}
            aria-controls="auth-mode-sms-panel"
            tabIndex={authMode === "sms" ? 0 : -1}
            className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all ${
              authMode === "sms"
                ? "bg-surface-selected text-text-primary shadow-sm"
                : "text-text-muted hover:text-text-secondary"
            }`}
            onClick={() => onAuthModeChange("sms")}
            onKeyDown={handleAuthModeKeyDown}
          >
            短信登录
          </button>
          <button
            id="auth-mode-password-tab"
            type="button"
            role="tab"
            aria-selected={authMode === "password"}
            aria-controls="auth-mode-password-panel"
            tabIndex={authMode === "password" ? 0 : -1}
            className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all ${
              authMode === "password"
                ? "bg-surface-selected text-text-primary shadow-sm"
                : "text-text-muted hover:text-text-secondary"
            }`}
            onClick={() => onAuthModeChange("password")}
            onKeyDown={handleAuthModeKeyDown}
          >
            密码登录
          </button>
        </div>

        {/* 手机号 */}
        <div className="input-icon-wrapper">
          <label className="text-sm font-medium text-text-secondary" htmlFor="auth-phone-number">
            手机号
          </label>
          <div className="relative mt-2">
            <svg className="input-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
            <input
              id="auth-phone-number"
              className="app-input pl-10 w-full"
              value={authPhoneNumber}
              onChange={(event) => onPhoneNumberChange(event.target.value.replace(/\D/g, "").slice(0, 11))}
              placeholder="请输入 11 位手机号"
              inputMode="numeric"
              autoComplete="tel"
              required
              aria-required="true"
            />
          </div>
        </div>

        {/* 短信登录 */}
        <div
          id="auth-mode-sms-panel"
          role="tabpanel"
          aria-labelledby="auth-mode-sms-tab"
          className="min-h-[125px]"
          hidden={authMode !== "sms"}
        >
          <div className="input-icon-wrapper">
            <label className="text-sm font-medium text-text-secondary" htmlFor="auth-sms-code">
              验证码
            </label>
            <div className="relative mt-2 flex w-full items-stretch">
              <svg className="input-icon !top-1/2 !-translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
              </svg>
              <input
                id="auth-sms-code"
                className="app-input !mt-0 h-14 min-w-0 flex-1 rounded-r-none border-r-0 pl-10"
                value={smsCode}
                onChange={(event) => onSmsCodeChange(event.target.value.trim())}
                placeholder="请输入验证码"
                autoComplete="one-time-code"
                required
                aria-required="true"
              />
              <button
                type="button"
                className="app-button-secondary h-14 shrink-0 whitespace-nowrap rounded-l-none px-3 sm:px-4"
                onClick={onSendSms}
                disabled={sendingSms || smsCountdown > 0 || authPhoneNumber.length !== 11}
              >
                {smsButtonLabel}
              </button>
            </div>
          </div>
          <button
            type="button"
            className="app-button-primary mt-3 h-14 w-full"
            onClick={onSubmitSmsLogin}
            disabled={authSubmitting}
          >
            {authSubmitting ? "登录中..." : "登录"}
          </button>
        </div>

        {/* 密码登录 */}
        <div
          id="auth-mode-password-panel"
          role="tabpanel"
          aria-labelledby="auth-mode-password-tab"
          className="min-h-[125px]"
          hidden={authMode !== "password"}
        >
          <div className="input-icon-wrapper">
            <label className="text-sm font-medium text-text-secondary" htmlFor="auth-password">
              密码
            </label>
            <div className="relative mt-2">
              <svg className="input-icon !top-1/2 !-translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
              </svg>
              <input
                id="auth-password"
                type="password"
                className="app-input !mt-0 h-14 w-full pl-10"
                value={password}
                onChange={(event) => onPasswordChange(event.target.value)}
                placeholder="请输入密码"
                autoComplete="current-password"
                required
                aria-required="true"
              />
            </div>
          </div>
          <button
            type="button"
            className="app-button-primary mt-3 h-14 w-full"
            onClick={onSubmitPasswordLogin}
            disabled={authSubmitting}
          >
            {authSubmitting ? "登录中..." : "登录"}
          </button>
        </div>

        {/* 注册链接 */}
        <div className="text-center">
          <Link href="/register" className="text-sm text-text-muted underline underline-offset-4 transition hover:text-text-primary">
            还没有账号？立即注册
          </Link>
        </div>

        {/* 状态消息 */}
        {authMessage ? <StatusMessage message={authMessage.text} type={authMessage.type} title={authMessage.title} /> : null}
        {debugCode ? <StatusMessage message={`调试验证码：${debugCode}`} type="warning" title="Mock 短信模式" /> : null}
      </div>
    </section>
  );
}
