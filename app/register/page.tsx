"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { StatusMessage } from "@/components/ui/status-message";

export default function RegisterPage() {
  const router = useRouter();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [sendingSms, setSendingSms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [smsCountdown, setSmsCountdown] = useState(0);
  const [message, setMessage] = useState<{ type: "error" | "success"; title?: string; text: string } | null>(null);
  const [debugCode, setDebugCode] = useState<string | null>(null);

  useEffect(() => {
    if (smsCountdown <= 0) {
      return;
    }

    const timer = window.setInterval(() => {
      setSmsCountdown((value) => (value <= 1 ? 0 : value - 1));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [smsCountdown]);

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
        title: "验证码已发送",
        text: payload.debugCode ? "当前为 Mock 短信模式，请查看下方调试验证码。" : "请查收短信并继续注册。",
      });
    } catch (error) {
      setMessage({
        type: "error",
        title: "验证码发送失败",
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

      setMessage({ type: "success", title: "注册成功", text: "正在进入语音复刻工作台。" });
      router.push("/");
    } catch (error) {
      setMessage({
        type: "error",
        title: "注册失败",
        text: error instanceof Error ? error.message : "注册失败",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen px-4 py-8 sm:px-6 sm:py-10">
      <div className="mx-auto flex w-full max-w-md flex-col gap-8">
        <section className="app-card w-full p-6 sm:p-8">
          <div className="text-center">
            <h1 className="text-2xl font-semibold">注册账号</h1>
            <p className="mt-2 text-sm text-text-muted">创建账号后即可进入语音复刻工作台</p>
          </div>

          <div className="mt-6 rounded-xl border border-border-subtle bg-surface-muted p-4 text-sm text-text-secondary">
            <div className="font-medium text-text-primary">注册后会自动登录</div>
            <p className="mt-1 leading-6">手机号用于接收验证码和找回账号；密码可以稍后在个人设置中补充。</p>
          </div>

          <form onSubmit={handleRegister} className="mt-5 space-y-4">
            <div>
              <label className="text-sm font-medium text-text-secondary" htmlFor="reg-phone">
                手机号
              </label>
              <input
                 id="reg-phone"
                 type="tel"
                 className="app-input"
                 value={phoneNumber}
                 onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, "").slice(0, 11))}
                 placeholder="请输入 11 位手机号"
                 inputMode="numeric"
                 autoComplete="tel"
                 required
                 aria-required="true"
               />
            </div>

            <div>
              <label className="text-sm font-medium text-text-secondary" htmlFor="reg-code">
                验证码
              </label>
              <div className="mt-2 flex flex-col gap-3 sm:flex-row">
                 <input
                   id="reg-code"
                   className="app-input min-w-0 flex-1"
                   value={code}
                   onChange={(e) => setCode(e.target.value.trim())}
                   placeholder="请输入短信验证码"
                   inputMode="numeric"
                   autoComplete="one-time-code"
                   required
                   aria-required="true"
                 />
                <button
                  type="button"
                  className="app-button-secondary"
                  onClick={() => void sendSmsCode()}
                  disabled={sendingSms || smsCountdown > 0 || phoneNumber.length !== 11}
                >
                  {sendingSms ? "发送中..." : smsCountdown > 0 ? `${smsCountdown}s 后重发` : "发送验证码"}
                </button>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-text-secondary" htmlFor="reg-password">
                密码（可选）
                <span className="ml-2 text-xs text-text-muted">至少 8 位</span>
              </label>
               <input
                 id="reg-password"
                 type="password"
                 className="app-input"
                 value={password}
                 onChange={(e) => setPassword(e.target.value)}
                 placeholder="留空则仅可使用短信登录"
                 autoComplete="new-password"
                 minLength={8}
               />
              <p className="mt-1 text-xs text-text-muted">
                设置密码后可使用密码登录，未设置密码仅可使用短信验证码登录
              </p>
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
              disabled={submitting || phoneNumber.length !== 11 || !code}
            >
              {submitting ? "注册中..." : "注册"}
            </button>
            <p className="text-center text-xs leading-5 text-text-muted">
              提交即创建账号会话，本地不会展示或保存短信验证码以外的调试信息。
            </p>
          </form>

          <div className="mt-6 text-center">
            <span className="text-sm text-text-muted">已有账号？</span>{" "}
            <Link href="/" className="text-sm font-medium text-text-secondary underline underline-offset-4 transition hover:text-text-primary">
              立即登录
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
