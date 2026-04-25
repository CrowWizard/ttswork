"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";

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
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
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
      setMessage({ type: "error", text: error instanceof Error ? error.message : "获取用户信息失败" });
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
        text: payload.debugCode ? `验证码已发送，当前调试验证码：${payload.debugCode}` : "验证码已发送，请查收短信",
      });
    } catch (error) {
      setMessage({
        type: "error",
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
      setMessage({ type: "success", text: "密码设置成功" });
      setActiveTab("change");
    } catch (error) {
      setMessage({
        type: "error",
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
      setMessage({ type: "error", text: "两次输入的密码不一致" });
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
      setMessage({ type: "success", text: "密码修改成功" });
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "修改密码失败",
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-cream via-white to-mist px-4 py-8 sm:px-6 sm:py-10">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
          <section className="w-full rounded-[28px] border border-white/70 bg-white/85 p-6 shadow-soft backdrop-blur sm:rounded-[32px] sm:p-8">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-4xl">个人设置</h1>
            <p className="mt-3 text-sm leading-6 text-slate-500">加载中...</p>
          </section>
        </div>
      </main>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-cream via-white to-mist px-4 py-8 sm:px-6 sm:py-10">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
        <section className="w-full rounded-[28px] border border-white/70 bg-white/85 p-6 shadow-soft backdrop-blur sm:rounded-[32px] sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-4xl">个人设置</h1>
              <p className="mt-3 text-sm leading-6 text-slate-500">管理您的账号信息</p>
            </div>
            <Link
              href="/"
              className="inline-flex rounded-3xl border border-slate-200 bg-white/90 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
            >
              返回工作台
            </Link>
          </div>
        </section>

        <section className="w-full rounded-[28px] border border-slate-100 bg-white p-6 shadow-soft sm:p-8">
          <div className="mb-6">
            <h2 className="text-lg font-semibold">账号信息</h2>
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <span className="text-sm text-slate-600">手机号</span>
                <span className="font-medium text-slate-800">{user.phoneNumber}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <span className="text-sm text-slate-600">密码状态</span>
                <span
                  className={`font-medium ${
                    user.hasPassword ? "text-emerald-700" : "text-amber-700"
                  }`}
                >
                  {user.hasPassword ? "已设置" : "未设置"}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <span className="text-sm text-slate-600">手机号验证</span>
                <span className="font-medium text-emerald-700">已验证</span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <span className="text-sm text-slate-600">注册时间</span>
                <span className="font-medium text-slate-800">
                  {new Date(user.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-6">
            <h2 className="text-lg font-semibold">密码管理</h2>

            {!user.hasPassword ? (
              <div className="mt-6">
                <div className="mb-4 rounded-xl border border-amber-100 bg-amber-50 p-4">
                  <p className="text-sm text-amber-800">
                    您的账号尚未设置密码。设置密码后，您可以使用手机号+密码的方式登录。
                  </p>
                </div>

                <form onSubmit={handleSetPassword} className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-slate-700" htmlFor="new-password">
                      设置密码
                    </label>
                    <input
                      id="new-password"
                      type="password"
                      className="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm outline-none transition focus:border-slate-400"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="至少 8 位字符"
                      minLength={8}
                      required
                    />
                  </div>

                  {message ? (
                    <div
                      className={`rounded-2xl px-4 py-3 text-sm ${
                        message.type === "error"
                          ? "border border-rose-200 bg-rose-50 text-rose-700"
                          : "border border-emerald-200 bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      {message.text}
                    </div>
                  ) : null}

                  <button
                    type="submit"
                    className="w-full rounded-3xl bg-slate-900 px-5 py-4 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                    disabled={saving || newPassword.length < 8}
                  >
                    {saving ? "设置中..." : "设置密码"}
                  </button>
                </form>
              </div>
            ) : (
              <div className="mt-6">
                <div className="mb-4 flex rounded-xl border border-slate-100 bg-slate-50 p-1">
                  <button
                    type="button"
                    className={`flex-1 rounded-xl px-4 py-2 text-sm font-medium transition ${
                      activeTab === "change"
                        ? "bg-white shadow-sm"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                    onClick={() => setActiveTab("change")}
                  >
                    修改密码
                  </button>
                </div>

                {activeTab === "change" && (
                  <form onSubmit={handleChangePassword} className="space-y-4">
                    <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                      <p className="text-sm text-slate-600">
                        为保障账号安全，修改密码前需要验证手机号。
                      </p>
                    </div>

                    <div>
                      <label className="text-sm font-medium text-slate-700" htmlFor="sms-code-change">
                        短信验证码
                      </label>
                      <div className="mt-2 flex flex-col gap-3 sm:flex-row">
                        <input
                          id="sms-code-change"
                          className="min-w-0 flex-1 rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm outline-none transition focus:border-slate-400"
                          value={smsCode}
                          onChange={(e) => setSmsCode(e.target.value.trim())}
                          placeholder="请输入验证码"
                          required
                        />
                        <button
                          type="button"
                          className="rounded-3xl border border-slate-200 bg-white px-5 py-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
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
                      <label className="text-sm font-medium text-slate-700" htmlFor="new-password-change">
                        新密码
                      </label>
                      <input
                        id="new-password-change"
                        type="password"
                        className="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm outline-none transition focus:border-slate-400"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="至少 8 位字符"
                        minLength={8}
                        required
                      />
                    </div>

                    <div>
                      <label className="text-sm font-medium text-slate-700" htmlFor="confirm-password">
                        确认新密码
                      </label>
                      <input
                        id="confirm-password"
                        type="password"
                        className="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm outline-none transition focus:border-slate-400"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="再次输入新密码"
                        minLength={8}
                        required
                      />
                    </div>

                    {message ? (
                      <div
                        className={`rounded-2xl px-4 py-3 text-sm ${
                          message.type === "error"
                            ? "border border-rose-200 bg-rose-50 text-rose-700"
                            : "border border-emerald-200 bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        {message.text}
                      </div>
                    ) : null}

                    {debugCode ? (
                      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                        当前为短信 Mock 模式，调试验证码：{debugCode}
                      </div>
                    ) : null}

                    <button
                      type="submit"
                      className="w-full rounded-3xl bg-slate-900 px-5 py-4 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
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
