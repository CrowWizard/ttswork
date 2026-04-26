import type { KeyboardEvent, MouseEvent, TouchEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { isRecordDurationAccepted } from "@/lib/audio";
import { convertBlobToWavFile } from "@/lib/audio-browser";
import { INPUT_AUDIO_FIELD, MIN_RECORD_SECONDS, RECORD_DURATION_SECONDS_FIELD } from "@/lib/constants";
import type { AuthMode, AuthUser, StatusState, TtsHistoryItem, TtsResult, TtsSceneItem, VoiceProfileKind, VoiceProfileResponse } from "./types";
import { pickRecordingMimeType, readJsonSafely } from "./utils";

export function useVoiceStudioState() {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const finalRecordDurationRef = useRef(0);
  const recordStartedAtRef = useRef<number | null>(null);
  const pointerRecordingActiveRef = useRef(false);

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
  const [creatingPureVoice, setCreatingPureVoice] = useState(false);
  const [creatingSceneVoice, setCreatingSceneVoice] = useState(false);
  const [invalidatingVoiceId, setInvalidatingVoiceId] = useState<string | null>(null);
  const [deletingRecordingId, setDeletingRecordingId] = useState<string | null>(null);
  const [selectedRecordingId, setSelectedRecordingId] = useState<string | null>(null);
  const [ttsText, setTtsText] = useState("");
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
  const canSubmitTts = ttsTextLength > 0 && canUseActiveVoiceTts;

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
      setCreatingPureVoice(false);
      setCreatingSceneVoice(false);
      setInvalidatingVoiceId(null);
      setDeletingRecordingId(null);
      setTtsLoading(false);
      setTtsResult(null);
      setTtsHistory([]);
  }, [clearWorkspaceFeedback]);

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

      const data = (await response.json()) as TtsHistoryItem[];
      setTtsHistory(data);
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

      const data = (await response.json()) as TtsSceneItem[];
      setScenes(data);
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

      const data = (await response.json()) as VoiceProfileResponse & { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "加载声纹信息失败");
      }

        setProfile(data);
        setSelectedRecordingId((current) => {
          if (!current) {
            return data.recordings[0]?.id ?? null;
          }

          return data.recordings.some((item) => item.id === current) ? current : (data.recordings[0]?.id ?? null);
        });
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "加载声纹信息失败");
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
        setAuthResolving(false);
        void refreshProfile();
        void refreshTtsHistory();
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
      void refreshProfile();
      void refreshTtsHistory();
    }
  }, [refreshProfile, refreshTtsHistory]);

  useEffect(() => {
    void refreshAuth();
    void refreshScenes();

    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [refreshAuth, refreshScenes]);

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
        text: error instanceof Error ? error.message : "验证码发送失败",
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

      setAuthUser(payload.user);
      setSmsCode("");
      setDebugCode(null);
      setAuthMessage({ type: "success", title: "登录成功", text: "正在进入语音复刻工作台。" });
    } catch (error) {
      setAuthMessage({
        type: "error",
        title: "短信登录失败",
        text: error instanceof Error ? error.message : "登录失败",
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

      setAuthUser(payload.user);
      setPassword("");
      setAuthMessage({ type: "success", title: "登录成功", text: "正在进入语音复刻工作台。" });
    } catch (error) {
      setAuthMessage({
        type: "error",
        title: "密码登录失败",
        text: error instanceof Error ? error.message : "登录失败",
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

      await refreshProfile();
      setSelectedRecordingId(payload.recordingId ?? null);
      setWorkspaceNotice({ type: "success", title: "录音上传完成", text: "录音已存入 MinIO，可继续建立纯粹版或场景版声纹。" });
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "上传录音失败");
    } finally {
      setUploading(false);
    }
  }, [handleUnauthorized, refreshProfile]);

  const startRecording = useCallback(async () => {
    if (recording || uploading || creatingPureVoice || creatingSceneVoice || Boolean(invalidatingVoiceId) || Boolean(deletingRecordingId)) {
      return;
    }

    clearWorkspaceFeedback();
    setTtsResult(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickRecordingMimeType();

      if (!mimeType) {
        stream.getTracks().forEach((track) => track.stop());
        setWorkspaceError("当前浏览器不支持录音。请更换支持 MediaRecorder 的浏览器。");
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

        try {
          if (!isRecordDurationAccepted(recordDurationSeconds)) {
            setWorkspaceError(`录音不足 ${MIN_RECORD_SECONDS} 秒，请按住按钮说满 ${MIN_RECORD_SECONDS} 秒。`);
            setUploading(false);
            return;
          }

          const audioFile = await convertBlobToWavFile(audioBlob);
          await uploadRecording(audioFile, recordDurationSeconds);
        } catch (error) {
          setWorkspaceError(error instanceof Error ? error.message : "录音处理失败");
          setUploading(false);
        }
      };

      mediaRecorder.start();
      startRecordTimer();
      setRecording(true);
    } catch (error) {
      stopRecordTimer();
      setWorkspaceError(error instanceof Error ? error.message : "无法访问麦克风");
    }
  }, [recording, uploading, creatingPureVoice, creatingSceneVoice, invalidatingVoiceId, deletingRecordingId, clearWorkspaceFeedback, uploadRecording]);

  const stopRecording = useCallback(() => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === "inactive") {
      return;
    }

    finalRecordDurationRef.current = stopRecordTimer();
    setUploading(true);
    clearWorkspaceFeedback();
    mediaRecorderRef.current.stop();
    setRecording(false);
  }, [clearWorkspaceFeedback]);

  const createVoiceEnrollment = useCallback(async (profileKind: VoiceProfileKind) => {
    if (!selectedRecordingId) {
      setWorkspaceError("请先上传录音，再建立声纹");
      return;
    }

    if (profileKind === "PURE") {
      setCreatingPureVoice(true);
    } else {
      setCreatingSceneVoice(true);
    }

    clearWorkspaceFeedback();
    setTtsResult(null);

    try {
      const response = await fetch("/api/voice/enrollments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          recordingId: selectedRecordingId,
          profileKind,
        }),
      });
      const payload = (await readJsonSafely(response)) as { error?: string; voiceId?: string };

      if (response.status === 401 || response.status === 403) {
        handleUnauthorized();
        return;
      }

      if (!response.ok) {
        throw new Error(payload.error ?? "建立声纹失败");
      }

      await refreshProfile();
      setWorkspaceNotice({
        type: "success",
        title: profileKind === "PURE" ? "纯粹版声纹已建立" : "场景版声纹已建立",
        text: payload.voiceId ? `当前声纹 ID：${payload.voiceId}` : "声纹已可用于后续文本转语音。",
      });
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "建立声纹失败");
    } finally {
      if (profileKind === "PURE") {
        setCreatingPureVoice(false);
      } else {
        setCreatingSceneVoice(false);
      }
    }
  }, [selectedRecordingId, clearWorkspaceFeedback, refreshProfile, handleUnauthorized]);

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
      setWorkspaceNotice({ type: "info", title: "录音素材已删除", text: "后续建声将只能使用当前列表中保留的最新录音素材。" });
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "删除录音素材失败");
    } finally {
      setDeletingRecordingId(null);
    }
  }, [clearWorkspaceFeedback, handleUnauthorized, refreshProfile]);

  const invalidateVoice = useCallback(async (enrollmentId: string) => {
    setInvalidatingVoiceId(enrollmentId);
    clearWorkspaceFeedback();
    setTtsResult(null);

    try {
      const response = await fetch(`/api/voice/enrollments/${enrollmentId}/invalidate`, {
        method: "POST",
        credentials: "include",
      });
      const payload = (await readJsonSafely(response)) as { error?: string };

      if (response.status === 401 || response.status === 403) {
        handleUnauthorized();
        return;
      }

      if (!response.ok) {
        throw new Error(payload.error ?? "作废声纹失败");
      }

      await refreshProfile();
      setWorkspaceNotice({ type: "info", title: "声纹已作废", text: "如需继续使用，请重新基于录音建立新的声纹。" });
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "作废声纹失败");
    } finally {
      setInvalidatingVoiceId(null);
    }
  }, [clearWorkspaceFeedback, refreshProfile, handleUnauthorized]);

  const submitTts = useCallback(async () => {
    if (!canUseActiveVoiceTts) {
      setWorkspaceError(usingSceneVoice ? "请先建立场景版声纹后再进行文本转语音" : "请先建立纯粹版声纹后再进行文本转语音");
      return;
    }

    setTtsLoading(true);
    setTtsResult(null);
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
      if (authUser) {
        void refreshTtsHistory();
      }
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "语音合成失败");
    } finally {
      setTtsLoading(false);
    }
  }, [authUser, canUseActiveVoiceTts, clearWorkspaceFeedback, handleUnauthorized, refreshTtsHistory, scenes, selectedSceneKey, ttsText, usingSceneVoice]);

  const handleRecordButtonMouseDown = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    if (event.button !== 0) {
      return;
    }

    pointerRecordingActiveRef.current = true;
    void startRecording();
  }, [startRecording]);

  const handleRecordButtonMouseUp = useCallback(() => {
    if (!pointerRecordingActiveRef.current) {
      return;
    }

    pointerRecordingActiveRef.current = false;
    stopRecording();
  }, [stopRecording]);

  const handleRecordButtonMouseLeave = useCallback(() => {
    if (!pointerRecordingActiveRef.current) {
      return;
    }

    pointerRecordingActiveRef.current = false;
    stopRecording();
  }, [stopRecording]);

  const handleRecordButtonTouchStart = useCallback((event: TouchEvent<HTMLButtonElement>) => {
    event.preventDefault();
    pointerRecordingActiveRef.current = true;
    void startRecording();
  }, [startRecording]);

  const handleRecordButtonTouchEnd = useCallback((event: TouchEvent<HTMLButtonElement>) => {
    event.preventDefault();

    if (!pointerRecordingActiveRef.current) {
      return;
    }

    pointerRecordingActiveRef.current = false;
    stopRecording();
  }, [stopRecording]);

  const handleRecordButtonTouchCancel = useCallback((event: TouchEvent<HTMLButtonElement>) => {
    event.preventDefault();

    if (!pointerRecordingActiveRef.current) {
      return;
    }

    pointerRecordingActiveRef.current = false;
    stopRecording();
  }, [stopRecording]);

  const handleRecordButtonKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
  }, []);

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
      onLogout: () => void logout(),
    },
    recordingPanel: {
      loadingProfile,
      profile,
      recording,
      recordStartedAt,
      uploading,
      creatingPureVoice,
      creatingSceneVoice,
      invalidatingVoiceId,
      deletingRecordingId,
      selectedRecordingId,
      onSelectRecording: setSelectedRecordingId,
      onDeleteRecording: (recordingId: string) => void deleteRecording(recordingId),
      workspaceError,
      workspaceNotice,
      onRecordButtonMouseDown: handleRecordButtonMouseDown,
      onRecordButtonMouseUp: handleRecordButtonMouseUp,
      onRecordButtonMouseLeave: handleRecordButtonMouseLeave,
      onRecordButtonTouchStart: handleRecordButtonTouchStart,
      onRecordButtonTouchEnd: handleRecordButtonTouchEnd,
      onRecordButtonTouchCancel: handleRecordButtonTouchCancel,
      onRecordButtonKeyDown: handleRecordButtonKeyDown,
      onCreatePureVoice: () => void createVoiceEnrollment("PURE"),
      onCreateSceneVoice: () => void createVoiceEnrollment("SCENE"),
      onInvalidateVoice: (enrollmentId: string) => void invalidateVoice(enrollmentId),
    },
    ttsPanel: {
      isAuthenticated: Boolean(authUser),
      hasPureVoice,
      hasSceneVoice,
      canSubmitTts,
      ttsText,
      ttsLoading,
      ttsResult,
      ttsHistory,
      scenes,
      selectedSceneKey,
      onTtsTextChange: setTtsText,
      onSceneChange: setSelectedSceneKey,
      onSubmitTts: () => void submitTts(),
    },
  };
}
