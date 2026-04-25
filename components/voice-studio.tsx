"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isRecordDurationAccepted } from "@/lib/audio";
import { convertBlobToWavFile } from "@/lib/audio-browser";
import { INPUT_AUDIO_FIELD, MIN_RECORD_SECONDS, RECORD_DURATION_SECONDS_FIELD } from "@/lib/constants";

type VoiceProfileResponse = {
  userId: string;
  activeVoice: {
    id: string;
    voiceId: string | null;
    status: string;
    durationSeconds: number;
    createdAt: string;
    playbackUrl: string | null;
    isInvalidated: boolean;
  } | null;
  recentEnrollments: Array<{
    id: string;
    status: string;
    voiceId: string | null;
    durationSeconds: number;
    createdAt: string;
    errorMessage: string | null;
    isInvalidated: boolean;
  }>;
};

type TtsResult = {
  jobId: string;
  status: string;
  downloadUrl: string;
  voiceIdSnapshot: string;
};

type TtsHistoryItem = {
  jobId: string;
  text: string;
  status: string;
  createdAt: string;
  downloadUrl: string;
};

type AuthUser = {
  id: string;
  phoneNumber: string;
  hasPassword: boolean;
  phoneVerifiedAt: string | null;
  createdAt: string;
};

type AuthMessage = {
  type: "error" | "success";
  text: string;
};

function formatDuration(durationSeconds: number) {
  return `${durationSeconds.toFixed(1)} 秒`;
}

function buildAudioFilename(jobId: string) {
  return `tts-${jobId}.wav`;
}

function pickRecordingMimeType() {
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
    return "audio/webm;codecs=opus";
  }

  if (MediaRecorder.isTypeSupported("audio/webm")) {
    return "audio/webm";
  }

  if (MediaRecorder.isTypeSupported("audio/mp4")) {
    return "audio/mp4";
  }

  return "";
}

async function readJsonSafely(response: Response) {
  return response.json().catch(() => ({}));
}

export function VoiceStudio() {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const finalRecordDurationRef = useRef(0);
  const recordStartedAtRef = useRef<number | null>(null);
  const recordTimerRef = useRef<number | null>(null);

  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authResolving, setAuthResolving] = useState(true);
  const [authMode, setAuthMode] = useState<"sms" | "password">("sms");
  const [authPhoneNumber, setAuthPhoneNumber] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [password, setPassword] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [sendingSms, setSendingSms] = useState(false);
  const [smsCountdown, setSmsCountdown] = useState(0);
  const [authMessage, setAuthMessage] = useState<AuthMessage | null>(null);
  const [debugCode, setDebugCode] = useState<string | null>(null);

  const [profile, setProfile] = useState<VoiceProfileResponse | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [recording, setRecording] = useState(false);
  const [recordElapsedSeconds, setRecordElapsedSeconds] = useState(0);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [invalidating, setInvalidating] = useState(false);
  const [ttsText, setTtsText] = useState("欢迎使用手机号登录后的建声与语音合成工作台。");
  const [ttsLoading, setTtsLoading] = useState(false);
  const [ttsResult, setTtsResult] = useState<TtsResult | null>(null);
  const [ttsHistory, setTtsHistory] = useState<TtsHistoryItem[]>([]);

  const activeVoiceLabel = useMemo(() => {
    if (!profile?.activeVoice?.voiceId) {
      return "尚未生成 active voice";
    }

    if (profile.activeVoice.isInvalidated) {
      return "当前 active voice 已作废";
    }

    return profile.activeVoice.voiceId;
  }, [profile]);

  const canSubmitTts = Boolean(profile?.activeVoice?.voiceId) && !profile?.activeVoice?.isInvalidated;
  const canPlaybackActiveVoice = Boolean(profile?.activeVoice?.playbackUrl) && !profile?.activeVoice?.isInvalidated;

  const resetWorkspaceState = useCallback(() => {
    setProfile(null);
    setLoadingProfile(false);
    setRecordError(null);
    setEnrolling(false);
    setInvalidating(false);
    setTtsLoading(false);
    setTtsResult(null);
    setTtsHistory([]);
  }, []);

  const handleUnauthorized = useCallback((message = "登录已失效，请重新登录") => {
    resetWorkspaceState();
    setAuthUser(null);
    setAuthMessage({ type: "error", text: message });
  }, [resetWorkspaceState]);

  const refreshTtsHistory = useCallback(async () => {
    try {
      const response = await fetch("/api/tts", {
        cache: "no-store",
        credentials: "include",
      });

      if (response.status === 401 || response.status === 403) {
        handleUnauthorized();
        return;
      }

      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as TtsHistoryItem[];
      setTtsHistory(data);
    } catch {}
  }, [handleUnauthorized]);

  const refreshProfile = useCallback(async () => {
    setLoadingProfile(true);

    try {
      const response = await fetch("/api/voice/profile", {
        cache: "no-store",
        credentials: "include",
      });

      if (response.status === 401 || response.status === 403) {
        handleUnauthorized();
        return;
      }

      const data = (await response.json()) as VoiceProfileResponse & { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "加载声纹信息失败");
      }

      setProfile(data);
    } catch (error) {
      setRecordError(error instanceof Error ? error.message : "加载声纹信息失败");
    } finally {
      setLoadingProfile(false);
    }
  }, [handleUnauthorized]);

  const refreshAuth = useCallback(async () => {
    setAuthResolving(true);

    try {
      const response = await fetch("/api/auth/me", {
        cache: "no-store",
        credentials: "include",
      });

      if (response.status === 401 || response.status === 403) {
        setAuthUser(null);
        resetWorkspaceState();
        setAuthResolving(false);
        return;
      }

      const payload = (await readJsonSafely(response)) as { user?: AuthUser; error?: string };

      if (!response.ok || !payload.user) {
        throw new Error(payload.error ?? "登录状态恢复失败");
      }

      setAuthUser(payload.user);
      setAuthPhoneNumber(payload.user.phoneNumber);
      setAuthMessage(null);
      setAuthResolving(false);
    } catch {
      setAuthUser(null);
      setAuthResolving(false);
    }
  }, [resetWorkspaceState]);

  useEffect(() => {
    void refreshAuth();

    return () => {
      if (recordTimerRef.current !== null) {
        window.clearInterval(recordTimerRef.current);
      }

      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [refreshAuth]);

  useEffect(() => {
    if (!authUser) {
      return;
    }

    void refreshProfile();
    void refreshTtsHistory();
  }, [authUser, refreshProfile, refreshTtsHistory]);

  useEffect(() => {
    if (smsCountdown <= 0) {
      return;
    }

    const timer = window.setInterval(() => {
      setSmsCountdown((value) => (value <= 1 ? 0 : value - 1));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [smsCountdown]);

  function startRecordTimer() {
    recordStartedAtRef.current = Date.now();
    setRecordElapsedSeconds(0);

    if (recordTimerRef.current !== null) {
      window.clearInterval(recordTimerRef.current);
    }

    recordTimerRef.current = window.setInterval(() => {
      const startedAt = recordStartedAtRef.current;

      if (!startedAt) {
        return;
      }

      setRecordElapsedSeconds((Date.now() - startedAt) / 1000);
    }, 100);
  }

  function stopRecordTimer() {
    const startedAt = recordStartedAtRef.current;
    const elapsedSeconds = startedAt ? (Date.now() - startedAt) / 1000 : recordElapsedSeconds;

    if (recordTimerRef.current !== null) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }

    setRecordElapsedSeconds(elapsedSeconds);
    recordStartedAtRef.current = null;

    return elapsedSeconds;
  }

  async function sendSmsCode() {
    if (sendingSms || smsCountdown > 0) {
      return;
    }

    setSendingSms(true);
    setAuthMessage(null);
    setDebugCode(null);

    try {
      const response = await fetch("/api/auth/sms/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          phoneNumber: authPhoneNumber,
          scene: "login",
        }),
      });

      const payload = (await readJsonSafely(response)) as {
        error?: string;
        retryAfterSeconds?: number;
        debugCode?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "验证码发送失败");
      }

      setSmsCountdown(payload.retryAfterSeconds ?? 60);
      setDebugCode(payload.debugCode ?? null);
      setAuthMessage({
        type: "success",
        text: payload.debugCode ? `验证码已发送，当前调试验证码：${payload.debugCode}` : "验证码已发送，请查收短信",
      });
    } catch (error) {
      setAuthMessage({
        type: "error",
        text: error instanceof Error ? error.message : "验证码发送失败",
      });
    } finally {
      setSendingSms(false);
    }
  }

  async function submitSmsLogin() {
    setAuthSubmitting(true);
    setAuthMessage(null);

    try {
      const response = await fetch("/api/auth/login/sms", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          phoneNumber: authPhoneNumber,
          code: smsCode,
        }),
      });

      const payload = (await readJsonSafely(response)) as { user?: AuthUser; error?: string };

      if (!response.ok || !payload.user) {
        throw new Error(payload.error ?? "登录失败");
      }

      setAuthUser(payload.user);
      setSmsCode("");
      setDebugCode(null);
      setAuthMessage({ type: "success", text: "登录成功" });
    } catch (error) {
      setAuthMessage({
        type: "error",
        text: error instanceof Error ? error.message : "登录失败",
      });
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function submitPasswordLogin() {
    setAuthSubmitting(true);
    setAuthMessage(null);

    try {
      const response = await fetch("/api/auth/login/password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          phoneNumber: authPhoneNumber,
          password,
        }),
      });

      const payload = (await readJsonSafely(response)) as { user?: AuthUser; error?: string };

      if (!response.ok || !payload.user) {
        throw new Error(payload.error ?? "登录失败");
      }

      setAuthUser(payload.user);
      setPassword("");
      setAuthMessage({ type: "success", text: "登录成功" });
    } catch (error) {
      setAuthMessage({
        type: "error",
        text: error instanceof Error ? error.message : "登录失败",
      });
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function logout() {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } finally {
      setAuthUser(null);
      setProfile(null);
      setTtsHistory([]);
      setTtsResult(null);
      setRecordError(null);
      setSmsCode("");
      setPassword("");
      setDebugCode(null);
      setAuthMessage({ type: "success", text: "已退出登录" });
    }
  }

  async function submitEnrollmentAudio(audioFile: File, durationSeconds: number) {
    const formData = new FormData();
    formData.append(INPUT_AUDIO_FIELD, audioFile, audioFile.name);
    formData.append(RECORD_DURATION_SECONDS_FIELD, durationSeconds.toFixed(3));

    console.info("[voice enroll] submit audio", {
      name: audioFile.name,
      type: audioFile.type,
      size: audioFile.size,
      durationSeconds,
    });

    try {
      const response = await fetch("/api/voice/enroll", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const payload = (await readJsonSafely(response)) as { error?: string; voiceId?: string };

      if (response.status === 401 || response.status === 403) {
        handleUnauthorized();
        return;
      }

      if (!response.ok) {
        throw new Error(payload.error ?? (response.status === 502 ? "接口繁忙" : "建声失败"));
      }

      await refreshProfile();
      setRecordError(`建声完成，voiceId: ${payload.voiceId}`);
    } catch (error) {
      setRecordError(error instanceof Error ? error.message : "建声失败");
    } finally {
      setEnrolling(false);
    }
  }

  async function startRecording() {
    if (!authUser || recording || enrolling || invalidating) {
      return;
    }

    setRecordError(null);
    setTtsResult(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickRecordingMimeType();

      if (!mimeType) {
        stream.getTracks().forEach((track) => track.stop());
        setRecordError("当前浏览器不支持录音。请更换支持 MediaRecorder 的浏览器。");
        return;
      }

      const mediaRecorder = new MediaRecorder(stream, { mimeType });

      streamRef.current = stream;
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;

        const audioBlob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType });
        const recordDurationSeconds = finalRecordDurationRef.current;

        console.info("[voice enroll] recorded blob", {
          sourceMimeType: mediaRecorder.mimeType,
          blobType: audioBlob.type,
          size: audioBlob.size,
          durationSeconds: recordDurationSeconds,
          chunkCount: chunksRef.current.length,
        });

        if (!isRecordDurationAccepted(recordDurationSeconds)) {
          setRecordError(`录音不足 ${MIN_RECORD_SECONDS} 秒，请按住按钮说满 ${MIN_RECORD_SECONDS} 秒。`);
          setEnrolling(false);
          return;
        }

        const audioFile = await convertBlobToWavFile(audioBlob);
        await submitEnrollmentAudio(audioFile, recordDurationSeconds);
      };

      mediaRecorder.start();
      startRecordTimer();
      setRecording(true);
    } catch (error) {
      stopRecordTimer();
      setRecordError(error instanceof Error ? error.message : "无法访问麦克风");
    }
  }

  function stopRecording() {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === "inactive") {
      return;
    }

    finalRecordDurationRef.current = stopRecordTimer();
    setEnrolling(true);
    setRecordError(null);
    mediaRecorderRef.current.stop();
    setRecording(false);
  }

  async function invalidateActiveVoice() {
    const activeVoiceId = profile?.activeVoice?.id;

    if (!activeVoiceId || invalidating) {
      return;
    }

    setInvalidating(true);
    setRecordError(null);
    setTtsResult(null);

    try {
      const response = await fetch(`/api/voice/enrollments/${activeVoiceId}/invalidate`, {
        method: "POST",
        credentials: "include",
      });
      const payload = (await readJsonSafely(response)) as { error?: string };

      if (response.status === 401 || response.status === 403) {
        handleUnauthorized();
        return;
      }

      if (!response.ok) {
        throw new Error(payload.error ?? "作废 active voice 失败");
      }

      await refreshProfile();
      setRecordError("当前 active voice 已作废。");
    } catch (error) {
      setRecordError(error instanceof Error ? error.message : "作废 active voice 失败");
    } finally {
      setInvalidating(false);
    }
  }

  async function submitTts() {
    setTtsLoading(true);
    setTtsResult(null);
    setRecordError(null);

    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ text: ttsText }),
      });
      const payload = (await readJsonSafely(response)) as TtsResult & { error?: string };

      if (response.status === 401 || response.status === 403) {
        handleUnauthorized();
        return;
      }

      if (!response.ok) {
        throw new Error(payload.error ?? "语音合成失败");
      }

      setTtsResult(payload);
      void refreshTtsHistory();
    } catch (error) {
      setRecordError(error instanceof Error ? error.message : "语音合成失败");
    } finally {
      setTtsLoading(false);
    }
  }

  function renderAuthPanel() {
    return (
      <section className="mx-auto w-full max-w-md rounded-[28px] border border-orange-100 bg-white p-6 shadow-soft sm:p-8">
        <div className="text-center">
          <h2 className="text-2xl font-semibold">登录</h2>
        </div>

        <div className="mt-6 space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-700" htmlFor="auth-phone-number">
              手机号
            </label>
            <input
              id="auth-phone-number"
              className="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm outline-none transition focus:border-slate-400"
              value={authPhoneNumber}
              onChange={(event) => setAuthPhoneNumber(event.target.value.replace(/\D/g, "").slice(0, 11))}
              placeholder="请输入 11 位手机号"
              inputMode="numeric"
            />
          </div>

          <div className="flex rounded-2xl border border-slate-100 bg-slate-50 p-1">
            <button
              type="button"
              className={`flex-1 rounded-xl px-4 py-2 text-sm font-medium transition ${authMode === "sms" ? "bg-white shadow-sm" : "text-slate-500"}`}
              onClick={() => setAuthMode("sms")}
            >
              短信登录
            </button>
            <button
              type="button"
              className={`flex-1 rounded-xl px-4 py-2 text-sm font-medium transition ${authMode === "password" ? "bg-white shadow-sm" : "text-slate-500"}`}
              onClick={() => setAuthMode("password")}
            >
              密码登录
            </button>
          </div>

          {authMode === "sms" ? (
            <>
              <div>
                <label className="text-sm font-medium text-slate-700" htmlFor="auth-sms-code">
                  验证码
                </label>
                <div className="mt-2 flex flex-col gap-3 sm:flex-row">
                  <input
                    id="auth-sms-code"
                    className="min-w-0 flex-1 rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm outline-none transition focus:border-slate-400"
                    value={smsCode}
                    onChange={(event) => setSmsCode(event.target.value.trim())}
                    placeholder="请输入短信验证码"
                  />
                  <button
                    type="button"
                    className="rounded-3xl border border-slate-200 bg-white px-5 py-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => void sendSmsCode()}
                    disabled={sendingSms || smsCountdown > 0 || authPhoneNumber.length !== 11}
                  >
                    {sendingSms ? "发送中..." : smsCountdown > 0 ? `${smsCountdown}s 后重发` : "发送验证码"}
                  </button>
                </div>
              </div>

              <button
                type="button"
                className="w-full rounded-3xl bg-slate-900 px-5 py-4 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                onClick={() => void submitSmsLogin()}
                disabled={authSubmitting}
              >
                {authSubmitting ? "提交中..." : "短信登录"}
              </button>
            </>
          ) : (
            <>
              <div>
                <label className="text-sm font-medium text-slate-700" htmlFor="auth-password">
                  密码
                </label>
                <input
                  id="auth-password"
                  type="password"
                  className="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm outline-none transition focus:border-slate-400"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="请输入密码"
                />
              </div>

              <button
                type="button"
                className="w-full rounded-3xl bg-slate-900 px-5 py-4 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                onClick={() => void submitPasswordLogin()}
                disabled={authSubmitting}
              >
                {authSubmitting ? "提交中..." : "密码登录"}
              </button>
            </>
          )}

          <div className="text-center">
            <Link href="/register" className="text-sm text-slate-500 underline underline-offset-4 transition hover:text-slate-700">
              还没有账号？去注册
            </Link>
          </div>

          {authMessage ? (
            <div
              className={`rounded-2xl px-4 py-3 text-sm ${
                authMessage.type === "error"
                  ? "border border-rose-200 bg-rose-50 text-rose-700"
                  : "border border-emerald-200 bg-emerald-50 text-emerald-700"
              }`}
            >
              {authMessage.text}
            </div>
          ) : null}

          {debugCode ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              当前为短信 Mock 模式，调试验证码：{debugCode}
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  // Always render the main layout, never block on authLoading
  return (
    <main className="min-h-screen bg-gradient-to-br from-cream via-white to-mist px-4 py-8 sm:px-6 sm:py-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <section className="w-full rounded-[28px] border border-white/70 bg-white/85 p-6 shadow-soft backdrop-blur sm:rounded-[32px] sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-4xl">语音复刻工作台</h1>
              <p className="mt-3 text-sm leading-6 text-slate-500">
                {authResolving
                  ? "正在检查登录状态..."
                  : authUser
                  ? "按住录音按钮录制你的声音，松开后自动建立声纹。随后输入任意文字即可用你的声音合成语音。"
                  : "请登录后使用建声与语音合成功能"}
              </p>
            </div>

            {authUser ? (
              <div className="rounded-3xl border border-slate-100 bg-white/90 px-4 py-4 text-sm text-slate-600 shadow-sm">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-400">当前账号</div>
                <div className="mt-1 font-medium text-slate-800">{authUser.phoneNumber}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {authUser.hasPassword ? "已设置密码，可用密码或短信登录" : "未设置密码，仅可短信登录"}
                </div>
                <div className="mt-3 flex gap-2">
                  <Link
                    href="/settings"
                    className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                  >
                    个人设置
                  </Link>
                  <button
                    type="button"
                    className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                    onClick={() => void logout()}
                  >
                    退出登录
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        {!authUser ? (
          renderAuthPanel()
        ) : (
          <section className="grid w-full gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="w-full rounded-[28px] border border-orange-100 bg-white p-6 shadow-soft sm:p-8">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl font-semibold">1. 建声录音</h2>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">按住录音建声</span>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3 sm:text-right">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">active voice</div>
                  <div className="mt-1 max-w-56 truncate text-sm font-medium text-slate-700">
                    {loadingProfile ? "加载中..." : activeVoiceLabel}
                  </div>
                </div>
              </div>

              <div className="mt-6 rounded-3xl border border-slate-100 bg-slate-50 p-4 sm:p-5">
                <div className="text-sm font-medium text-slate-700">当前声纹回放</div>
                {canPlaybackActiveVoice && profile?.activeVoice ? (
                  <>
                    <div className="mt-3 text-sm text-slate-600">
                      当前时长：{formatDuration(profile.activeVoice.durationSeconds)}
                    </div>
                    <div className="mt-4 flex items-center gap-3">
                      <audio className="min-w-0 flex-1" controls src={profile.activeVoice.playbackUrl ?? undefined} />
                      <button
                        type="button"
                        className="flex h-10 w-10 items-center justify-center rounded-2xl border border-rose-200 bg-white text-lg font-semibold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => void invalidateActiveVoice()}
                        disabled={invalidating}
                        aria-label="作废当前 active voice"
                      >
                        {invalidating ? "…" : "×"}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="mt-3 text-sm text-slate-500">当前没有可回放的 active voice。</div>
                )}
              </div>

              <div className="mt-8 flex flex-col gap-4">
                {recording ? (
                  <div className="text-center text-sm font-medium text-rose-600">
                    已说话：{formatDuration(recordElapsedSeconds)}
                  </div>
                ) : null}

                <button
                  type="button"
                  onMouseDown={() => void startRecording()}
                  onMouseUp={stopRecording}
                  onMouseLeave={stopRecording}
                  onTouchStart={() => void startRecording()}
                  onTouchEnd={stopRecording}
                  className={`rounded-3xl px-6 py-8 text-lg font-semibold transition ${
                    recording ? "bg-rose-500 text-white" : "bg-amber-100 text-amber-950 hover:bg-amber-200"
                  }`}
                  disabled={enrolling || invalidating}
                >
                  {recording ? "松开结束录音" : enrolling ? "上传并建立声纹中..." : `按住说话（至少 ${MIN_RECORD_SECONDS} 秒）`}
                </button>

                {recordError ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    {recordError}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="w-full rounded-[28px] border border-sky-100 bg-white p-6 shadow-soft sm:p-8">
              <h2 className="text-2xl font-semibold">2. 文本转语音</h2>

              <label className="mt-6 block text-sm font-medium text-slate-700" htmlFor="tts-text">
                输入文本
              </label>
              <textarea
                id="tts-text"
                className="mt-3 min-h-44 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm outline-none transition focus:border-slate-400"
                value={ttsText}
                onChange={(event) => setTtsText(event.target.value)}
                maxLength={500}
              />

              <button
                type="button"
                className="mt-5 w-full rounded-3xl bg-slate-900 px-5 py-4 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                onClick={() => void submitTts()}
                disabled={ttsLoading || !canSubmitTts}
              >
                {ttsLoading ? "合成中..." : "生成语音"}
              </button>

              {ttsResult ? (
                <div className="mt-6 rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                  <div className="text-sm text-emerald-800">任务已完成：{ttsResult.jobId}</div>
                  <div className="mt-1 text-sm text-emerald-800">voiceIdSnapshot：{ttsResult.voiceIdSnapshot}</div>
                  <audio className="mt-4 w-full" controls src={ttsResult.downloadUrl} />
                  <a
                    className="mt-4 inline-flex w-full items-center justify-center rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-600"
                    href={ttsResult.downloadUrl}
                    download={buildAudioFilename(ttsResult.jobId)}
                  >
                    下载生成语音
                  </a>
                </div>
              ) : null}

              {ttsHistory.length > 0 ? (
                <div className="mt-6">
                  <h3 className="text-sm font-semibold text-slate-700">历史语音</h3>
                  <div className="mt-3 flex flex-col gap-3">
                    {ttsHistory.map((item) => (
                      <div key={item.jobId} className="rounded-2xl border border-slate-100 bg-white p-3">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                          <div className="line-clamp-2 text-sm text-slate-700">{item.text}</div>
                          <div className="shrink-0 text-xs text-slate-400">{new Date(item.createdAt).toLocaleString()}</div>
                        </div>
                        <audio className="mt-2 h-8 w-full sm:h-auto" controls src={item.downloadUrl} />
                        <a
                          className="mt-3 inline-flex w-full items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 sm:w-auto"
                          href={item.downloadUrl}
                          download={buildAudioFilename(item.jobId)}
                        >
                          下载
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

