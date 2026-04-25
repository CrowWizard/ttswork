"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";

export default function RegisterPage() {
  const router = useRouter();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [sendingSms, setSendingSms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [smsCountdown, setSmsCountdown] = useState(0);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [debugCode, setDebugCode] = useState<string | null>(null);

  async function sendSmsCode() {
    if (sendingSms || smsCountdown > 0) {
      return;
    }

    setSendingSms(true);
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
          phoneNumber,
          scene: "register",
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        retryAfterSeconds?: number;
        expiresInSeconds?: number;
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
      setSendingSms(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          phoneNumber,
          code,
          password: password.trim() || undefined,
        }),
      });

      const payload = (await response.json()) as {
        user?: {
          id: string;
          phoneNumber: string;
          hasPassword: boolean;
          phoneVerifiedAt: string | null;
          createdAt: string;
        };
        error?: string;
      };

      if (!response.ok || !payload.user) {
        throw new Error(payload.error ?? "注册失败");
      }

      setMessage({ type: "success", text: "注册成功，正在跳转..." });
      router.push("/");
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "注册失败",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-cream via-white to-mist px-4 py-8 sm:px-6 sm:py-10">
      <div className="mx-auto flex w-full max-w-md flex-col gap-8">
        <section className="w-full rounded-[28px] border border-orange-100 bg-white p-6 shadow-soft sm:p-8">
          <div className="text-center">
            <h1 className="text-2xl font-semibold">注册账号</h1>
            <p className="mt-2 text-sm text-slate-500">创建账号，开启语音建声之旅</p>
          </div>

          <form onSubmit={handleRegister} className="mt-6 space-y-4">
            <div>
              <label className="text-sm font-medium text-slate-700" htmlFor="reg-phone">
                手机号
              </label>
              <input
                id="reg-phone"
                type="tel"
                className="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm outline-none transition focus:border-slate-400"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, "").slice(0, 11))}
                placeholder="请输入 11 位手机号"
                inputMode="numeric"
                required
              />
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700" htmlFor="reg-code">
                验证码
              </label>
              <div className="mt-2 flex flex-col gap-3 sm:flex-row">
                <input
                  id="reg-code"
                  className="min-w-0 flex-1 rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm outline-none transition focus:border-slate-400"
                  value={code}
                  onChange={(e) => setCode(e.target.value.trim())}
                  placeholder="请输入短信验证码"
                  required
                />
                <button
                  type="button"
                  className="rounded-3xl border border-slate-200 bg-white px-5 py-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => void sendSmsCode()}
                  disabled={sendingSms || smsCountdown > 0 || phoneNumber.length !== 11}
                >
                  {sendingSms ? "发送中..." : smsCountdown > 0 ? `${smsCountdown}s 后重发` : "发送验证码"}
                </button>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700" htmlFor="reg-password">
                密码（可选）
                <span className="ml-2 text-xs text-slate-400">至少 8 位</span>
              </label>
              <input
                id="reg-password"
                type="password"
                className="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm outline-none transition focus:border-slate-400"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="留空则仅可使用短信登录"
              />
              <p className="mt-1 text-xs text-slate-400">
                设置密码后可使用密码登录，未设置密码仅可使用短信验证码登录
              </p>
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
              disabled={submitting || phoneNumber.length !== 11 || !code}
            >
              {submitting ? "注册中..." : "注册"}
            </button>
          </form>

          <div className="mt-6 text-center">
            <span className="text-sm text-slate-500">已有账号？</span>{" "}
            <Link href="/" className="text-sm font-medium text-slate-700 underline underline-offset-4 transition hover:text-slate-900">
              立即登录
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
