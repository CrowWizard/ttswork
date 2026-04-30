import { useCallback, useEffect, useRef, useState } from "react";
import { MultiRecorder, PCM_WORKLET_URL } from "react-ts-audio-recorder";
import { isRecordDurationAccepted } from "@/lib/audio";
import { getBlobDurationSeconds } from "@/lib/audio-browser";
import { resolveSupportedAudioMimeType } from "@/lib/audio-format";
import { INPUT_AUDIO_FIELD, MAX_RECORD_SECONDS, MIN_RECORD_SECONDS, RECORD_DURATION_SECONDS_FIELD } from "@/lib/constants";
import type {
  AuthMode,
  AuthUser,
  StatusState,
  TtsHistoryItem,
  TtsResult,
  TtsSceneItem,
  TtsUsageState,
  VoiceProfileResponse,
} from "./types";
import { readJsonSafely, toUserFacingErrorMessage } from "./utils";

export function useVoiceStudioState() {
  const recorderRef = useRef<MultiRecorder | null>(null);
  const enrollmentPollingTimerRef = useRef<number | null>(null);
  const finalRecordDurationRef = useRef(0);
  const recordStartedAtRef = useRef<number | null>(null);
  const recordingStartingRef = useRef(false);
  const recordingStopReasonRef = useRef<"manual" | "auto">("manual");

  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authResolving, setAuthResolving] = useState(true);
  const [authMode, setAuthMode] = useState<AuthMode>("sms");
  const [authPhoneNumber, setAuthPhoneNumber] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [password, setPassword] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [sendingSms, setSendingSms] = useState(false);
  const [smsCountdown, setSmsCountdown] = useState(0);
  const [authMessage, setAuthMessage] = useState<StatusState | null>(null);
  const [debugCode, setDebugCode] = useState<string | null>(null);

  const [profile, setProfile] = useState<VoiceProfileResponse | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [recording, setRecording] = useState(false);
  const [recordStartedAt, setRecordStartedAt] = useState<number | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [workspaceNotice, setWorkspaceNotice] = useState<StatusState | null>(null);
  const [uploading, setUploading] = useState(false);
  const [enrollmentPolling, setEnrollmentPolling] = useState(false);
  const [enrollmentPollingMessage, setEnrollmentPollingMessage] = useState<string | null>(null);
  const [deletingRecordingId, setDeletingRecordingId] = useState<string | null>(null);
  const [, setSelectedRecordingId] = useState<string | null>(null);
  const [ttsText, setTtsText] = useState("");
  const [ttsUsage, setTtsUsage] = useState<TtsUsageState | null>(null);
  const [redeemUsageCode, setRedeemUsageCode] = useState("");
  const [redeemingUsageCode, setRedeemingUsageCode] = useState(false);
  const [redeemMessage, setRedeemMessage] = useState<StatusState | null>(null);
  const [ttsError, setTtsError] = useState<string | null>(null);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [ttsResult, setTtsResult] = useState<TtsResult | null>(null);
  const [ttsHistory, setTtsHistory] = useState<TtsHistoryItem[]>([]);
  const [scenes, setScenes] = useState<TtsSceneItem[]>([]);
  const [selectedSceneKey, setSelectedSceneKey] = useState("");
  const ttsTextLength = ttsText.trim().length;
  const hasPureVoice = Boolean(profile?.activeVoices.pure?.voiceId && !profile.activeVoices.pure.isInvalidated);
  const hasSceneVoice = Boolean(profile?.activeVoices.scene?.voiceId && !profile.activeVoices.scene.isInvalidated);
  const usingSceneVoice = Boolean(selectedSceneKey);
  const canUseActiveVoiceTts = usingSceneVoice ? hasSceneVoice : hasPureVoice;
  const ttsTextLimit = 500;
  const pointsBalance = ttsUsage?.pointsBalance ?? authUser?.pointsBalance ?? 0;
  const ttsCostPoints = ttsUsage?.ttsCostPoints ?? 20;
  const canSubmitTts =
    Boolean(authUser) && ttsTextLength > 0 && ttsTextLength <= ttsTextLimit && canUseActiveVoiceTts && pointsBalance >= ttsCostPoints;

  const clearWorkspaceFeedback = useCallback(() => {
    setWorkspaceError(null);
    setWorkspaceNotice(null);
  }, []);

  const resetWorkspaceState = useCallback(() => {
    setProfile(null);
    setLoadingProfile(false);
    clearWorkspaceFeedback();
    setRecording(false);
    setRecordStartedAt(null);
    setUploading(false);
    setEnrollmentPolling(false);
    setEnrollmentPollingMessage(null);
    setDeletingRecordingId(null);
    setTtsLoading(false);
    setTtsResult(null);
    setTtsHistory([]);
    setTtsUsage(null);
    setRedeemUsageCode("");
    setRedeemMessage(null);
  }, [clearWorkspaceFeedback]);

  const refreshTtsUsage = useCallback(async () => {
    try {
      const response = await fetch("/api/tts/usage", {
        cache: "no-store",
        credentials: "include",
      });

      if (!response.ok) {
        return;
      }

      const data = await readJsonSafely(response);
      setTtsUsage(data as TtsUsageState);
    } catch {}
  }, []);

  const handleUnauthorized = useCallback(
    (message = "登录已失效，请重新登录") => {
      resetWorkspaceState();
      setAuthUser(null);
      setAuthMessage({ type: "error", title: "登录状态失效", text: message });
    },
    [resetWorkspaceState],
  );

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

      const data = await readJsonSafely(response);
      setTtsHistory(Array.isArray(data) ? (data as TtsHistoryItem[]) : []);
    } catch {}
  }, [handleUnauthorized]);

  const refreshScenes = useCallback(async () => {
    try {
      const response = await fetch("/api/tts/scenes", {
        cache: "no-store",
        credentials: "include",
      });

      if (!response.ok) {
        return;
      }

      const data = await readJsonSafely(response);
      setScenes(Array.isArray(data) ? (data as TtsSceneItem[]) : []);
    } catch {}
  }, []);

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

      const data = (await readJsonSafely(response)) as VoiceProfileResponse & { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "加载声纹信息失败");
      }

      setProfile(data);
      setSelectedRecordingId((current) => {
        if (!current) {
          return data.recordings[data.recordings.length - 1]?.id ?? null;
        }

        return data.recordings.some((item) => item.id === current)
          ? current
          : (data.recordings[data.recordings.length - 1]?.id ?? null);
      });
    } catch (error) {
      setWorkspaceError(toUserFacingErrorMessage(error, "加载声纹信息失败，请稍后重试"));
    } finally {
      setLoadingProfile(false);
    }
  }, [handleUnauthorized]);

  const stopEnrollmentPolling = useCallback(() => {
    if (enrollmentPollingTimerRef.current !== null) {
      window.clearTimeout(enrollmentPollingTimerRef.current);
      enrollmentPollingTimerRef.current = null;
    }

    setEnrollmentPolling(false);
    setEnrollmentPollingMessage(null);
  }, []);

  const startEnrollmentPolling = useCallback((recordingId: string) => {
    if (enrollmentPollingTimerRef.current !== null) {
      window.clearTimeout(enrollmentPollingTimerRef.current);
      enrollmentPollingTimerRef.current = null;
    }

    setEnrollmentPolling(true);
    setEnrollmentPollingMessage("正在自动生成声纹，请稍等...");

    const poll = async (attempt: number) => {
      try {
        const response = await fetch("/api/voice/profile", {
          cache: "no-store",
          credentials: "include",
        });

        if (response.status === 401 || response.status === 403) {
          handleUnauthorized();
          stopEnrollmentPolling();
          return;
        }

        const data = (await readJsonSafely(response)) as VoiceProfileResponse & { error?: string };

        if (!response.ok) {
          throw new Error(data.error ?? "刷新声纹状态失败");
        }

        setProfile(data);
        setSelectedRecordingId(data.recordings[0]?.id ?? null);

        const relatedEnrollments = data.recentEnrollments.filter((item) => item.recordingId === recordingId);
        const pendingEnrollments = relatedEnrollments.filter((item) => item.status === "PENDING");
        const failedEnrollments = relatedEnrollments.filter((item) => item.status === "FAILED");
        const readyEnrollments = relatedEnrollments.filter((item) => item.status === "READY");

        if (pendingEnrollments.length === 0 && relatedEnrollments.length >= 2) {
          stopEnrollmentPolling();

          if (failedEnrollments.length > 0) {
            const failedMessage = failedEnrollments.map((item) => item.errorMessage).find(Boolean);
            setWorkspaceError(failedMessage ?? "部分声纹自动生成失败，请重新上传或录制语音");
            return;
          }

          if (readyEnrollments.length >= 2) {
            setWorkspaceNotice({ type: "success", title: "声纹已生成", text: "纯粹版和场景版声纹已自动生成，可继续输入文本生成语音。" });
            return;
          }
        }

        if (attempt >= 60) {
          stopEnrollmentPolling();
          setWorkspaceNotice({ type: "warning", title: "声纹仍在生成", text: "声纹生成时间较长，请稍后刷新页面查看结果。" });
          return;
        }

        setEnrollmentPollingMessage(`正在自动生成声纹，请稍等...（${attempt + 1}/60）`);
        enrollmentPollingTimerRef.current = window.setTimeout(() => void poll(attempt + 1), 2000);
      } catch (error) {
        if (attempt >= 60) {
          stopEnrollmentPolling();
          setWorkspaceError(toUserFacingErrorMessage(error, "声纹状态刷新失败，请稍后刷新页面查看结果"));
          return;
        }

        enrollmentPollingTimerRef.current = window.setTimeout(() => void poll(attempt + 1), 2000);
      }
    };

    void poll(1);
  }, [handleUnauthorized, stopEnrollmentPolling]);

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
        void refreshProfile();
        void refreshTtsHistory();
        void refreshTtsUsage();
        return;
      }

      const payload = (await readJsonSafely(response)) as { user?: AuthUser; error?: string };

      if (!response.ok || !payload.user) {
        throw new Error(payload.error ?? "登录状态恢复失败");
      }

      const nextUser = payload.user;
      setAuthUser(nextUser);
      setTtsUsage((current) => current ? { ...current, pointsBalance: nextUser.pointsBalance } : current);
      setAuthPhoneNumber(nextUser.phoneNumber);
      setAuthMessage(null);
      setAuthResolving(false);
    } catch {
      setAuthUser(null);
      setAuthResolving(false);
      void refreshProfile();
      void refreshTtsHistory();
      void refreshTtsUsage();
    }
  }, [refreshProfile, refreshTtsHistory, refreshTtsUsage]);

  useEffect(() => {
    void refreshAuth();
    void refreshScenes();

    return () => {
      if (enrollmentPollingTimerRef.current !== null) {
        window.clearTimeout(enrollmentPollingTimerRef.current);
      }
      recorderRef.current?.close();
      recorderRef.current = null;
    };
  }, [refreshAuth, refreshScenes]);

  useEffect(() => {
    if (!authUser) {
      return;
    }

    void refreshProfile();
    void refreshTtsHistory();
    void refreshTtsUsage();
  }, [authUser, refreshProfile, refreshTtsHistory, refreshTtsUsage]);

  useEffect(() => {
    if (smsCountdown <= 0) {
      return;
    }

    const timer = window.setInterval(() => {
      setSmsCountdown((value) => (value <= 1 ? 0 : value - 1));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [smsCountdown]);

  useEffect(() => {
    if (!selectedSceneKey) {
      return;
    }

    const matchedScene = scenes.find((item) => item.key === selectedSceneKey);

    if (!matchedScene) {
      setSelectedSceneKey("");
    }
  }, [scenes, selectedSceneKey]);

  function startRecordTimer() {
    const startedAt = Date.now();

    recordStartedAtRef.current = startedAt;
    setRecordStartedAt(startedAt);
  }

  function stopRecordTimer() {
    const startedAt = recordStartedAtRef.current;
    const elapsedSeconds = startedAt ? (Date.now() - startedAt) / 1000 : 0;

    recordStartedAtRef.current = null;
    setRecordStartedAt(null);

    return elapsedSeconds;
  }

  const sendSmsCode = useCallback(async () => {
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
        title: "验证码已发送",
        text: payload.debugCode ? "当前为 Mock 短信模式，请查看下方调试验证码。" : "请查收短信并继续登录。",
      });
    } catch (error) {
      setAuthMessage({
        type: "error",
        title: "验证码发送失败",
        text: toUserFacingErrorMessage(error, "验证码发送失败，请稍后重试"),
      });
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

      const nextUser = payload.user;
      setAuthUser(nextUser);
      setTtsUsage((current) => current ? { ...current, pointsBalance: nextUser.pointsBalance } : current);
      setSmsCode("");
      setDebugCode(null);
      setAuthMessage({ type: "success", title: "登录成功", text: "正在进入语音复刻工作台。" });
    } catch (error) {
      setAuthMessage({
        type: "error",
        title: "短信登录失败",
        text: toUserFacingErrorMessage(error, "登录失败，请检查验证码后重试"),
      });
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

      const nextUser = payload.user;
      setAuthUser(nextUser);
      setTtsUsage((current) => current ? { ...current, pointsBalance: nextUser.pointsBalance } : current);
      setPassword("");
      setAuthMessage({ type: "success", title: "登录成功", text: "正在进入语音复刻工作台。" });
    } catch (error) {
      setAuthMessage({
        type: "error",
        title: "密码登录失败",
        text: toUserFacingErrorMessage(error, "登录失败，请检查手机号和密码后重试"),
      });
    } finally {
      setAuthSubmitting(false);
    }
  }, [authPhoneNumber, password]);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } finally {
      setAuthUser(null);
      setProfile(null);
      setTtsHistory([]);
      setTtsUsage(null);
      setRedeemUsageCode("");
      setRedeemMessage(null);
      clearWorkspaceFeedback();
      setSmsCode("");
      setPassword("");
      setDebugCode(null);
      setAuthMessage({ type: "success", title: "已退出登录", text: "当前账号会话已结束。" });
    }
  }, [clearWorkspaceFeedback]);

  const uploadRecording = useCallback(async (audioFile: File, durationSeconds: number) => {
    const formData = new FormData();
    formData.append(INPUT_AUDIO_FIELD, audioFile, audioFile.name);
    formData.append(RECORD_DURATION_SECONDS_FIELD, durationSeconds.toFixed(3));

    try {
      const response = await fetch("/api/voice/recordings", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const payload = (await readJsonSafely(response)) as { error?: string; recordingId?: string };

      if (response.status === 401 || response.status === 403) {
        handleUnauthorized();
        return;
      }

      if (!response.ok) {
        throw new Error(payload.error ?? "上传录音失败");
      }

      setSelectedRecordingId(payload.recordingId ?? null);
      setWorkspaceNotice({ type: "success", title: "录音上传完成", text: "录音已保存，系统正在自动生成纯粹版和场景版声纹。" });

      if (payload.recordingId) {
        startEnrollmentPolling(payload.recordingId);
      } else {
        await refreshProfile();
      }
    } catch (error) {
      setWorkspaceError(toUserFacingErrorMessage(error, "上传录音失败，请稍后重试"));
    } finally {
      setUploading(false);
    }
  }, [handleUnauthorized, refreshProfile, startEnrollmentPolling]);

  const uploadSelectedAudioFile = useCallback(async (audioFile: File | null) => {
    if (!audioFile || uploading || enrollmentPolling || Boolean(deletingRecordingId) || recording) {
      return;
    }

    clearWorkspaceFeedback();
    setTtsResult(null);

    const supportedMimeType = resolveSupportedAudioMimeType(audioFile.type, audioFile.name);

    if (!supportedMimeType) {
      setWorkspaceError("上传文件仅支持 MP3、WAV、W4V 格式");
      return;
    }

    setUploading(true);

    try {
      const normalizedFile = supportedMimeType === audioFile.type ? audioFile : new File([audioFile], audioFile.name, { type: supportedMimeType });
      const durationSeconds = await getBlobDurationSeconds(normalizedFile);

      if (!isRecordDurationAccepted(durationSeconds)) {
        throw new Error(`录音不足 ${MIN_RECORD_SECONDS} 秒，请上传不少于 ${MIN_RECORD_SECONDS} 秒的音频。`);
      }

      await uploadRecording(normalizedFile, durationSeconds);
    } catch (error) {
      setWorkspaceError(toUserFacingErrorMessage(error, "上传录音失败，请稍后重试"));
      setUploading(false);
    }
  }, [uploading, enrollmentPolling, deletingRecordingId, recording, clearWorkspaceFeedback, uploadRecording]);

  const startRecording = useCallback(async () => {
    if (
      recording ||
      recordingStartingRef.current ||
      uploading ||
      enrollmentPolling ||
      Boolean(deletingRecordingId)
    ) {
      return;
    }

    recordingStartingRef.current = true;
    clearWorkspaceFeedback();
    setTtsResult(null);

    console.info("[voice enroll] recording start requested", {
      recording,
      uploading,
      enrollmentPolling,
      deletingRecordingId,
    });

    try {
      const recorder = new MultiRecorder({
        format: "wav",
        sampleRate: 48000,
        workletURL: PCM_WORKLET_URL,
      });

      recorderRef.current = recorder;
      recordingStopReasonRef.current = "manual";
      await recorder.init();
      await recorder.startRecording();
      startRecordTimer();
      setRecording(true);
      recordingStartingRef.current = false;

      console.info("[voice enroll] recording started", {
        format: "wav",
        workletURL: PCM_WORKLET_URL,
      });
    } catch (error) {
      recorderRef.current?.close();
      recorderRef.current = null;
      recordingStartingRef.current = false;
      stopRecordTimer();
      setWorkspaceError(toUserFacingErrorMessage(error, "无法访问麦克风，请检查浏览器权限后重试"));
    }
  }, [recording, uploading, enrollmentPolling, deletingRecordingId, clearWorkspaceFeedback]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;

    if (!recorder) {
      return;
    }

    recorderRef.current = null;

    const isAutoStop = recordingStopReasonRef.current === "auto";
    recordingStopReasonRef.current = "manual";

    console.info("[voice enroll] recording stop requested", {
      reason: isAutoStop ? "auto" : "manual",
    });

    finalRecordDurationRef.current = stopRecordTimer();
    setUploading(true);
    clearWorkspaceFeedback();

    if (isAutoStop) {
      setWorkspaceNotice({
        type: "info",
        title: "录音已自动结束",
        text: `单次录音最长 ${MAX_RECORD_SECONDS} 秒，已自动停止并开始上传。`,
      });
    }

    setRecording(false);
    void (async () => {
      try {
        const audioBlob = await recorder.stopRecording();
        const recordDurationSeconds = finalRecordDurationRef.current;

        console.info("[voice enroll] recorded blob", {
          blobType: audioBlob.type,
          size: audioBlob.size,
          durationSeconds: recordDurationSeconds,
        });

        if (!isRecordDurationAccepted(recordDurationSeconds)) {
          setWorkspaceError(`录音不足 ${MIN_RECORD_SECONDS} 秒，请继续录满 ${MIN_RECORD_SECONDS} 秒后再结束。`);
          setUploading(false);
          return;
        }

        const audioFile = new File([audioBlob], "enrollment.wav", { type: audioBlob.type || "audio/wav" });
        await uploadRecording(audioFile, recordDurationSeconds);
      } catch (error) {
        setWorkspaceError(toUserFacingErrorMessage(error, "录音处理失败，请重新录制"));
        setUploading(false);
      } finally {
        recorder.close();
      }
    })();
  }, [clearWorkspaceFeedback, uploadRecording]);

  useEffect(() => {
    if (!recording || !recordStartedAt) {
      return;
    }

    const elapsedMilliseconds = Date.now() - recordStartedAt;
    const remainingMilliseconds = Math.max(MAX_RECORD_SECONDS * 1000 - elapsedMilliseconds, 0);

    const timer = window.setTimeout(() => {
      if (!recorderRef.current) {
        return;
      }

      recordingStopReasonRef.current = "auto";
      stopRecording();
    }, remainingMilliseconds);

    return () => window.clearTimeout(timer);
  }, [recording, recordStartedAt, stopRecording]);

  const deleteRecording = useCallback(async (recordingId: string) => {
    setDeletingRecordingId(recordingId);
    clearWorkspaceFeedback();

    try {
      const response = await fetch(`/api/voice/recordings/${recordingId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const payload = (await readJsonSafely(response)) as { error?: string };

      if (response.status === 401 || response.status === 403) {
        handleUnauthorized();
        return;
      }

      if (!response.ok) {
        throw new Error(payload.error ?? "删除录音素材失败");
      }

      await refreshProfile();
      setTtsResult(null);
      setWorkspaceNotice({ type: "info", title: "录音素材已删除", text: "录音素材及对应声纹已删除或作废，请重新上传或录制后再生成语音。" });
    } catch (error) {
      setWorkspaceError(toUserFacingErrorMessage(error, "删除录音素材失败，请稍后重试"));
    } finally {
      setDeletingRecordingId(null);
    }
  }, [clearWorkspaceFeedback, handleUnauthorized, refreshProfile]);

  const redeemUsageCodeForPoints = useCallback(async () => {
    if (redeemingUsageCode) {
      return;
    }

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
      const payload = (await readJsonSafely(response)) as {
        error?: string;
        pointsBalance?: number;
        redeemedPoints?: number;
      };

      if (response.status === 401 || response.status === 403) {
        handleUnauthorized();
        return;
      }

      if (!response.ok || typeof payload.pointsBalance !== "number") {
        throw new Error(payload.error ?? "兑换失败");
      }

      setRedeemUsageCode("");
      setTtsUsage((current) => current ? { ...current, pointsBalance: payload.pointsBalance! } : current);
      setAuthUser((current) => current ? { ...current, pointsBalance: payload.pointsBalance! } : current);
      setRedeemMessage({ type: "success", text: `已兑换 ${payload.redeemedPoints ?? 200} 积分` });
      void refreshTtsUsage();
    } catch (error) {
      setRedeemMessage({ type: "error", text: toUserFacingErrorMessage(error, "兑换失败，请稍后重试") });
    } finally {
      setRedeemingUsageCode(false);
    }
  }, [handleUnauthorized, redeemUsageCode, redeemingUsageCode, refreshTtsUsage]);

  const submitTts = useCallback(async () => {
    if (!canUseActiveVoiceTts) {
      setTtsError(usingSceneVoice ? "请先建立场景版声纹后再进行文本转语音" : "请先建立纯粹版声纹后再进行文本转语音");
      return;
    }

    setTtsLoading(true);
    setTtsResult(null);
    setTtsError(null);
    clearWorkspaceFeedback();

    try {
      const selectedScene = scenes.find((item) => item.key === selectedSceneKey) ?? null;

      const response = await fetch("/api/tts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          text: ttsText,
          profileKind: selectedScene ? "SCENE" : "PURE",
          sceneKey: selectedScene?.key,
          instruction: selectedScene?.instruction,
        }),
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
      setWorkspaceNotice({ type: "success", title: "语音合成完成", text: "可在右侧结果区直接播放或下载。" });
      void refreshTtsHistory();
      void refreshTtsUsage();
      void refreshAuth();
    } catch (error) {
      setTtsError(toUserFacingErrorMessage(error, "语音合成失败，请稍后重试"));
    } finally {
      setTtsLoading(false);
    }
  }, [
    canUseActiveVoiceTts,
    clearWorkspaceFeedback,
    handleUnauthorized,
    refreshTtsHistory,
    refreshTtsUsage,
    refreshAuth,
    scenes,
    selectedSceneKey,
    ttsText,
    usingSceneVoice,
  ]);

  const handleRecordButtonClick = useCallback(() => {
    console.info("[voice enroll] record button clicked", {
      recording,
      recordingStarting: recordingStartingRef.current,
      recorderReady: Boolean(recorderRef.current),
    });

    if (recording) {
      stopRecording();
      return;
    }

    void startRecording();
  }, [recording, startRecording, stopRecording]);

  return {
    authPanel: {
      authMode,
      authPhoneNumber,
      smsCode,
      password,
      authSubmitting,
      sendingSms,
      smsCountdown,
      authMessage,
      debugCode,
      onAuthModeChange: setAuthMode,
      onPhoneNumberChange: setAuthPhoneNumber,
      onSmsCodeChange: setSmsCode,
      onPasswordChange: setPassword,
      onSendSms: () => void sendSmsCode(),
      onSubmitSmsLogin: () => void submitSmsLogin(),
      onSubmitPasswordLogin: () => void submitPasswordLogin(),
    },
    header: {
      authResolving,
      authUser,
      pointsBalance,
      redeemUsageCode,
      redeemingUsageCode,
      redeemMessage,
      onRedeemUsageCodeChange: setRedeemUsageCode,
      onRedeemUsageCode: () => void redeemUsageCodeForPoints(),
      onLogout: () => void logout(),
    },
    recordingPanel: {
      loadingProfile,
      profile,
      recording,
      recordStartedAt,
      uploading,
      deletingRecordingId,
      onDeleteRecording: (recordingId: string) => void deleteRecording(recordingId),
      onUploadAudioFile: (file: File | null) => void uploadSelectedAudioFile(file),
      workspaceError,
      workspaceNotice,
      onRecordButtonClick: handleRecordButtonClick,
      enrollmentPolling,
      enrollmentPollingMessage,
    },
    ttsPanel: {
      isAuthenticated: Boolean(authUser),
      hasPureVoice,
      hasSceneVoice,
      canSubmitTts,
      ttsText,
      ttsUsage,
      ttsLoading,
      ttsResult,
      ttsError,
      ttsHistory,
      scenes,
      selectedSceneKey,
      onTtsTextChange: setTtsText,
      onSceneChange: setSelectedSceneKey,
      onSubmitTts: () => void submitTts(),
    },
  };
}
