"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AuthPanel } from "./voice-studio/auth-panel";
import { readJsonSafely, toUserFacingErrorMessage } from "./voice-studio/utils";

export type AuthUser = {
  id: string;
  phoneNumber: string;
  hasPassword: boolean;
  phoneVerifiedAt: string | null;
  pointsBalance: number;
  createdAt: string;
};

type StatusState = {
  type: "error" | "success" | "info" | "warning";
  title?: string;
  text: string;
};

type AuthMode = "sms" | "password";

type AuthContextValue = {
  authUser: AuthUser | null;
  authResolving: boolean;
  pointsBalance: number;
  redeemUsageCode: string;
  redeemingUsageCode: boolean;
  redeemMessage: StatusState | null;
  refreshAuth: () => Promise<void>;
  logout: () => Promise<void>;
  setRedeemUsageCode: (code: string) => void;
  redeemUsageCodeForPoints: () => Promise<void>;
  updatePointsBalance: (balance: number) => void;
  openLoginModal: () => void;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth 必须在 AuthProvider 内部使用");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authResolving, setAuthResolving] = useState(true);
  const [redeemUsageCode, setRedeemUsageCodeState] = useState("");
  const [redeemingUsageCode, setRedeemingUsageCode] = useState(false);
  const [redeemMessage, setRedeemMessage] = useState<StatusState | null>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);

  const [authMode, setAuthMode] = useState<AuthMode>("sms");
  const [authPhoneNumber, setAuthPhoneNumber] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [password, setPassword] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [sendingSms, setSendingSms] = useState(false);
  const [smsCountdown, setSmsCountdown] = useState(0);
  const [authMessage, setAuthMessage] = useState<StatusState | null>(null);
  const [debugCode, setDebugCode] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);
  const dialogTitleId = useId();
  const dialogDescriptionId = useId();

  const pointsBalance = authUser?.pointsBalance ?? 0;

  const refreshAuth = useCallback(async () => {
    setAuthResolving(true);
    try {
      const response = await fetch("/api/auth/me", {
        cache: "no-store",
        credentials: "include",
      });
      if (response.status === 401 || response.status === 403) {
        setAuthUser(null);
        setAuthResolving(false);
        return;
      }
      const payload = (await readJsonSafely(response)) as { user?: AuthUser; error?: string };
      if (!response.ok || !payload.user) {
        throw new Error(payload.error ?? "登录状态恢复失败");
      }
      setAuthUser(payload.user);
      setAuthMessage(null);
      setAuthResolving(false);
    } catch {
      setAuthUser(null);
      setAuthResolving(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } finally {
      setAuthUser(null);
      setSmsCode("");
      setPassword("");
      setDebugCode(null);
      setAuthMessage({ type: "success", title: "已退出登录", text: "当前账号会话已结束。" });
    }
  }, []);

  const sendSmsCode = useCallback(async () => {
    if (sendingSms || smsCountdown > 0) return;
    setSendingSms(true);
    setAuthMessage(null);
    setDebugCode(null);
    try {
      const response = await fetch("/api/auth/sms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ phoneNumber: authPhoneNumber, scene: "login" }),
      });
      const payload = (await readJsonSafely(response)) as { error?: string; retryAfterSeconds?: number; debugCode?: string };
      if (!response.ok) throw new Error(payload.error ?? "验证码发送失败");
      setSmsCountdown(payload.retryAfterSeconds ?? 60);
      setDebugCode(payload.debugCode ?? null);
      setAuthMessage({
        type: "success",
        title: "验证码已发送",
        text: payload.debugCode ? "当前为 Mock 短信模式，请查看下方调试验证码。" : "请查收短信并继续登录。",
      });
    } catch (error) {
      setAuthMessage({ type: "error", title: "验证码发送失败", text: toUserFacingErrorMessage(error, "验证码发送失败，请稍后重试") });
    } finally {
      setSendingSms(false);
    }
  }, [sendingSms, smsCountdown, authPhoneNumber]);

  const submitSmsLogin = useCallback(async () => {
    setAuthSubmitting(true);
    setAuthMessage(null);
    try {
      const response = await fetch("/api/auth/login/sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ phoneNumber: authPhoneNumber, code: smsCode }),
      });
      const payload = (await readJsonSafely(response)) as { user?: AuthUser; error?: string };
      if (!response.ok || !payload.user) throw new Error(payload.error ?? "登录失败");
      setAuthUser(payload.user);
      setSmsCode("");
      setDebugCode(null);
      setAuthMessage({ type: "success", title: "登录成功", text: "正在进入语音复刻工作台。" });
      setShowLoginModal(false);
    } catch (error) {
      setAuthMessage({ type: "error", title: "短信登录失败", text: toUserFacingErrorMessage(error, "登录失败，请检查验证码后重试") });
    } finally {
      setAuthSubmitting(false);
    }
  }, [authPhoneNumber, smsCode]);

  const submitPasswordLogin = useCallback(async () => {
    setAuthSubmitting(true);
    setAuthMessage(null);
    try {
      const response = await fetch("/api/auth/login/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ phoneNumber: authPhoneNumber, password }),
      });
      const payload = (await readJsonSafely(response)) as { user?: AuthUser; error?: string };
      if (!response.ok || !payload.user) throw new Error(payload.error ?? "登录失败");
      setAuthUser(payload.user);
      setPassword("");
      setAuthMessage({ type: "success", title: "登录成功", text: "正在进入语音复刻工作台。" });
      setShowLoginModal(false);
    } catch (error) {
      setAuthMessage({ type: "error", title: "密码登录失败", text: toUserFacingErrorMessage(error, "登录失败，请检查手机号和密码后重试") });
    } finally {
      setAuthSubmitting(false);
    }
  }, [authPhoneNumber, password]);

  const openLoginModalInner = useCallback(() => {
    lastFocusedElementRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setShowLoginModal(true);
  }, []);

  const openLoginModal = useCallback(() => {
    openLoginModalInner();
  }, [openLoginModalInner]);

  const redeemUsageCodeForPoints = useCallback(async () => {
    if (redeemingUsageCode) return;
    const normalizedCode = redeemUsageCode.trim();
    if (!/^[0-9A-Za-z]{6}$/.test(normalizedCode)) {
      setRedeemMessage({ type: "error", text: "请输入 6 位使用码" });
      return;
    }
    setRedeemingUsageCode(true);
    setRedeemMessage(null);
    try {
      const response = await fetch("/api/tts/usage/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ usageCode: normalizedCode }),
      });
      const payload = (await readJsonSafely(response)) as { error?: string; pointsBalance?: number; redeemedPoints?: number };
      if (response.status === 401 || response.status === 403) {
        openLoginModalInner();
        return;
      }
      if (!response.ok || typeof payload.pointsBalance !== "number") throw new Error(payload.error ?? "兑换失败");
      setRedeemUsageCodeState("");
      setAuthUser((current) => current ? { ...current, pointsBalance: payload.pointsBalance! } : current);
      setRedeemMessage({ type: "success", text: `已兑换 ${payload.redeemedPoints ?? 200} 积分` });
    } catch (error) {
      setRedeemMessage({ type: "error", text: toUserFacingErrorMessage(error, "兑换失败，请稍后重试") });
    } finally {
      setRedeemingUsageCode(false);
    }
  }, [redeemingUsageCode, redeemUsageCode, openLoginModalInner]);

  const updatePointsBalance = useCallback((newBalance: number) => {
    setAuthUser((current) => current ? { ...current, pointsBalance: newBalance } : current);
  }, []);

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  useEffect(() => {
    if (authUser) {
      setShowLoginModal(false);
    }
  }, [authUser]);

  useEffect(() => {
    if (smsCountdown <= 0) return;
    const timer = window.setInterval(() => {
      setSmsCountdown((value) => (value <= 1 ? 0 : value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [smsCountdown]);

  useEffect(() => {
    if (!showLoginModal) {
      lastFocusedElementRef.current?.focus();
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFirstField = window.setTimeout(() => {
      const focusable = dialogRef.current?.querySelector<HTMLElement>(
        'input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      focusable?.focus();
    }, 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setShowLoginModal(false);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusableElements = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusableElements.length) return;
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(focusFirstField);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showLoginModal]);

  useEffect(() => {
    const handleOpenLogin = () => {
      openLoginModalInner();
    };
    window.addEventListener("open-voice-login-modal", handleOpenLogin);
    return () => window.removeEventListener("open-voice-login-modal", handleOpenLogin);
  }, [openLoginModalInner]);

  const contextValue: AuthContextValue = {
    authUser,
    authResolving,
    pointsBalance,
    redeemUsageCode,
    redeemingUsageCode,
    redeemMessage,
    refreshAuth,
    logout,
    setRedeemUsageCode: setRedeemUsageCodeState,
    redeemUsageCodeForPoints,
    updatePointsBalance,
    openLoginModal,
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
      {showLoginModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-text-primary/50 px-4 py-6"
          onClick={() => setShowLoginModal(false)}
        >
          <div
            ref={dialogRef}
            className="app-card w-full max-w-md p-6 shadow-2xl sm:p-8"
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            aria-describedby={dialogDescriptionId}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 id={dialogTitleId} className="text-xl font-semibold">登录后使用积分生成语音</h2>
                <p id={dialogDescriptionId} className="mt-2 text-sm leading-6 text-text-muted">
                  登录后获赠 100 积分；每次生成消耗 20 积分，余额不足时可在顶部输入使用码兑换。
                </p>
              </div>
              <button
                type="button"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border-subtle text-text-muted transition hover:bg-surface-muted hover:text-text-primary"
                onClick={() => setShowLoginModal(false)}
                aria-label="关闭登录弹窗"
              >
                ×
              </button>
            </div>
            <AuthPanel
              authMode={authMode}
              authPhoneNumber={authPhoneNumber}
              smsCode={smsCode}
              password={password}
              authSubmitting={authSubmitting}
              sendingSms={sendingSms}
              smsCountdown={smsCountdown}
              authMessage={authMessage}
              debugCode={debugCode}
              onAuthModeChange={setAuthMode}
              onPhoneNumberChange={(value) => setAuthPhoneNumber(value.replace(/\D/g, "").slice(0, 11))}
              onSmsCodeChange={(value) => setSmsCode(value.trim())}
              onPasswordChange={setPassword}
              onSendSms={() => void sendSmsCode()}
              onSubmitSmsLogin={() => void submitSmsLogin()}
              onSubmitPasswordLogin={() => void submitPasswordLogin()}
            />
            <button
              type="button"
              className="mt-5 flex min-h-11 w-full items-center justify-center text-center text-sm text-text-muted underline-offset-4 transition hover:text-text-primary hover:underline"
              onClick={() => setShowLoginModal(false)}
            >
              取消
            </button>
          </div>
        </div>
      )}
    </AuthContext.Provider>
  );
}