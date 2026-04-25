"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { StatusMessage } from "@/components/ui/status-message";

type AuthUser = {
  id: string;
  phoneNumber: string;
  hasPassword: boolean;
  phoneVerifiedAt: string | null;
  createdAt: string;
};

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [smsSending, setSmsSending] = useState(false);
  const [smsCountdown, setSmsCountdown] = useState(0);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [message, setMessage] = useState<{ type: "error" | "success"; title?: string; text: string } | null>(null);
  const [debugCode, setDebugCode] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"set" | "change">("set");

  useEffect(() => {
    void fetchUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (smsCountdown <= 0) {
      return;
    }
    const timer = window.setInterval(() => {
      setSmsCountdown((v) => (v <= 1 ? 0 : v - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [smsCountdown]);

  async function fetchUser() {
    setLoading(true);
    try {
      const response = await fetch("/api/auth/me", {
        credentials: "include",
      });

      if (response.status === 401 || response.status === 403) {
        router.push("/");
        return;
      }

      if (!response.ok) {
        throw new Error("获取用户信息失败");
      }

      const payload = (await response.json()) as { user?: AuthUser; error?: string };

      if (!payload.user) {
        router.push("/");
        return;
      }

      setUser(payload.user);
      setActiveTab(payload.user.hasPassword ? "change" : "set");
    } catch (error) {
      setMessage({ type: "error", title: "账号信息加载失败", text: error instanceof Error ? error.message : "获取用户信息失败" });
    } finally {
      setLoading(false);
    }
  }

  async function sendSmsForPasswordChange() {
    if (smsSending || smsCountdown > 0 || !user) {
      return;
    }

    setSmsSending(true);
    setMessage(null);
    setDebugCode(null);

    try {
      const response = await fetch("/api/auth/sms/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          phoneNumber: user.phoneNumber,
          scene: "password_change",
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        retryAfterSeconds?: number;
        debugCode?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "验证码发送失败");
      }

      setSmsCountdown(payload.retryAfterSeconds ?? 60);
      setDebugCode(payload.debugCode ?? null);
      setMessage({
        type: "success",
        title: "验证码已发送",
        text: payload.debugCode ? "当前为 Mock 短信模式，请查看下方调试验证码。" : "请查收短信后继续修改密码。",
      });
    } catch (error) {
      setMessage({
        type: "error",
        title: "验证码发送失败",
        text: error instanceof Error ? error.message : "验证码发送失败",
      });
    } finally {
      setSmsSending(false);
    }
  }

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;

    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch("/api/auth/password/set", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          newPassword,
        }),
      });

      const payload = (await response.json()) as {
        user?: AuthUser;
        error?: string;
      };

      if (!response.ok || !payload.user) {
        throw new Error(payload.error ?? "设置密码失败");
      }

      setUser(payload.user);
      setNewPassword("");
      setMessage({ type: "success", title: "密码设置成功", text: "后续可使用手机号和密码登录。" });
      setActiveTab("change");
    } catch (error) {
      setMessage({
        type: "error",
        title: "密码设置失败",
        text: error instanceof Error ? error.message : "设置密码失败",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;

    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", title: "密码确认不一致", text: "请重新输入并确认新密码。" });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch("/api/auth/password/change", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          code: smsCode,
          newPassword,
        }),
      });

      const payload = (await response.json()) as {
        user?: AuthUser;
        error?: string;
      };

      if (!response.ok || !payload.user) {
        throw new Error(payload.error ?? "修改密码失败");
      }

      setUser(payload.user);
      setSmsCode("");
      setNewPassword("");
      setConfirmPassword("");
      setSmsCountdown(0);
      setMessage({ type: "success", title: "密码修改成功", text: "下次登录可使用新密码。" });
    } catch (error) {
      setMessage({
        type: "error",
        title: "密码修改失败",
        text: error instanceof Error ? error.message : "修改密码失败",
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen px-4 py-8 sm:px-6 sm:py-10">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
          <section className="app-card w-full p-6 sm:p-8" aria-busy="true">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-4xl">个人设置</h1>
            <p className="mt-3 text-sm leading-6 text-text-muted">正在准备账号信息、密码状态与安全操作入口。</p>
            <div className="mt-6 grid gap-3 animate-pulse">
              <div className="h-14 rounded-xl bg-surface-muted" />
              <div className="h-14 rounded-xl bg-surface-muted" />
              <div className="h-24 rounded-xl bg-surface-muted" />
            </div>
            <p className="mt-4 text-sm leading-6 text-text-muted" role="status" aria-live="polite" aria-atomic="true">
              正在加载账号信息与密码设置项...
            </p>
          </section>
        </div>
      </main>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <main className="min-h-screen px-4 py-8 sm:px-6 sm:py-10">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
        <section className="app-card w-full p-6 sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-4xl">个人设置</h1>
              <p className="mt-3 text-sm leading-6 text-text-muted">管理您的账号信息与密码登录方式</p>
            </div>
            <Link
              href="/"
              className="app-button-secondary inline-flex px-5 py-3"
            >
              返回工作台
            </Link>
          </div>

          <div className="mt-6 rounded-xl border border-border-subtle bg-surface-muted p-4 text-sm text-text-secondary">
            <div className="font-medium text-text-primary">安全提示</div>
            <p className="mt-1 leading-6">修改密码前会校验当前登录态；已设置密码的账号还需要短信验证码确认。</p>
          </div>
        </section>

        <section className="app-card w-full p-6 sm:p-8">
          <div className="mb-6">
            <h2 className="text-lg font-semibold">账号信息</h2>
            <div className="mt-4 space-y-3">
              <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-border-subtle bg-surface-muted px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="shrink-0 text-sm text-text-secondary">手机号</span>
                <span className="min-w-0 break-all font-medium text-text-primary sm:text-right">{user.phoneNumber}</span>
              </div>
              <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-border-subtle bg-surface-muted px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="shrink-0 text-sm text-text-secondary">密码状态</span>
                <span
                  className={`min-w-0 font-medium sm:text-right ${
                    user.hasPassword ? "text-success" : "text-warning"
                  }`}
                >
                  {user.hasPassword ? "已设置" : "未设置"}
                </span>
              </div>
              <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-border-subtle bg-surface-muted px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="shrink-0 text-sm text-text-secondary">手机号验证</span>
                <span className="min-w-0 font-medium text-success sm:text-right">已验证</span>
              </div>
              <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-border-subtle bg-surface-muted px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="shrink-0 text-sm text-text-secondary">注册时间</span>
                <span className="min-w-0 font-medium text-text-primary sm:text-right">
                  {new Date(user.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>

          <div className="border-t border-border-subtle pt-6">
            <h2 className="text-lg font-semibold">密码管理</h2>

            {!user.hasPassword ? (
              <div className="mt-6">
                <div className="mb-4 rounded-xl border border-warning-border bg-warning-surface p-4">
                  <p className="text-sm text-warning">
                    您的账号尚未设置密码。设置密码后，您可以使用手机号+密码的方式登录。
                  </p>
                </div>

                <form onSubmit={handleSetPassword} className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-text-secondary" htmlFor="new-password">
                      设置密码
                    </label>
                     <input
                       id="new-password"
                       type="password"
                       className="app-input"
                       value={newPassword}
                       onChange={(e) => setNewPassword(e.target.value)}
                       placeholder="至少 8 位字符"
                       autoComplete="new-password"
                       minLength={8}
                       required
                       aria-required="true"
                     />
                  </div>

                  {message ? (
                    <StatusMessage message={message.text} type={message.type} title={message.title} />
                  ) : null}

                  <button
                    type="submit"
                    className="app-button-primary w-full"
                    disabled={saving || newPassword.length < 8}
                  >
                    {saving ? "设置中..." : "设置密码"}
                  </button>
                </form>
              </div>
            ) : (
              <div className="mt-6">
                <div className="mb-4 flex rounded-xl border border-border-subtle bg-surface-muted p-1">
                  <button
                    type="button"
                    className={`flex-1 rounded-xl px-4 py-2 text-sm font-medium transition ${
                      activeTab === "change"
                        ? "bg-surface-selected"
                        : "text-text-muted hover:text-text-secondary"
                    }`}
                    onClick={() => setActiveTab("change")}
                  >
                    修改密码
                  </button>
                </div>

                {activeTab === "change" && (
                  <form onSubmit={handleChangePassword} className="space-y-4">
                    <div className="rounded-xl border border-border-subtle bg-surface-muted p-4">
                      <p className="text-sm text-text-secondary">
                        为保障账号安全，修改密码前需要验证手机号。
                      </p>
                    </div>

                    <div>
                      <label className="text-sm font-medium text-text-secondary" htmlFor="sms-code-change">
                        短信验证码
                      </label>
                      <div className="mt-2 flex flex-col gap-3 sm:flex-row">
                         <input
                           id="sms-code-change"
                           className="app-input min-w-0 flex-1"
                           value={smsCode}
                           onChange={(e) => setSmsCode(e.target.value.trim())}
                           placeholder="请输入验证码"
                           inputMode="numeric"
                           autoComplete="one-time-code"
                           required
                           aria-required="true"
                         />
                        <button
                          type="button"
                          className="app-button-secondary"
                          onClick={() => void sendSmsForPasswordChange()}
                          disabled={smsSending || smsCountdown > 0}
                        >
                          {smsSending
                            ? "发送中..."
                            : smsCountdown > 0
                            ? `${smsCountdown}s 后重发`
                            : "发送验证码"}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="text-sm font-medium text-text-secondary" htmlFor="new-password-change">
                        新密码
                      </label>
                       <input
                         id="new-password-change"
                         type="password"
                         className="app-input"
                         value={newPassword}
                         onChange={(e) => setNewPassword(e.target.value)}
                         placeholder="至少 8 位字符"
                         autoComplete="new-password"
                         minLength={8}
                         required
                         aria-required="true"
                       />
                    </div>

                    <div>
                      <label className="text-sm font-medium text-text-secondary" htmlFor="confirm-password">
                        确认新密码
                      </label>
                       <input
                         id="confirm-password"
                         type="password"
                         className="app-input"
                         value={confirmPassword}
                         onChange={(e) => setConfirmPassword(e.target.value)}
                         placeholder="再次输入新密码"
                         autoComplete="new-password"
                         minLength={8}
                         required
                         aria-required="true"
                       />
                    </div>

                    {message ? (
                      <StatusMessage message={message.text} type={message.type} title={message.title} />
                    ) : null}

                    {debugCode ? (
                      <StatusMessage message={`调试验证码：${debugCode}`} type="warning" title="Mock 短信模式" />
                    ) : null}

                    <button
                      type="submit"
                      className="app-button-primary w-full"
                      disabled={
                        saving ||
                        !smsCode ||
                        newPassword.length < 8 ||
                        newPassword !== confirmPassword
                      }
                    >
                      {saving ? "修改中..." : "确认修改密码"}
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
