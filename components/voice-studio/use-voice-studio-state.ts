import { useCallback, useEffect, useRef, useState } from "react";
import { MultiRecorder, PCM_WORKLET_URL } from "react-ts-audio-recorder";
import { isRecordDurationAccepted } from "@/lib/audio";
import { getBlobDurationSeconds } from "@/lib/audio-browser";
import { resolveSupportedAudioMimeType } from "@/lib/audio-format";
import { INPUT_AUDIO_FIELD, MAX_RECORD_SECONDS, MIN_RECORD_SECONDS, RECORD_DURATION_SECONDS_FIELD } from "@/lib/constants";
import { useAuth } from "@/components/auth-context";
import type {
  StatusState,
  TtsHistoryItem,
  TtsResult,
  TtsSceneItem,
  TtsUsageState,
  VoiceProfileResponse,
} from "./types";
import { readJsonSafely, toUserFacingErrorMessage } from "./utils";

export function useVoiceStudioState() {
  const auth = useAuth();

  const recorderRef = useRef<MultiRecorder | null>(null);
  const enrollmentPollingTimerRef = useRef<number | null>(null);
  const finalRecordDurationRef = useRef(0);
  const recordStartedAtRef = useRef<number | null>(null);
  const recordingStartingRef = useRef(false);
  const recordingStopReasonRef = useRef<"manual" | "auto">("manual");

  const profileLoadedOnceRef = useRef(false);
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
  const canSubmitTts =
    Boolean(auth.authUser) && ttsTextLength > 0 && ttsTextLength <= ttsTextLimit && canUseActiveVoiceTts && auth.pointsBalance >= 20;

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
  }, [clearWorkspaceFeedback]);

  const refreshTtsUsage = useCallback(async () => {
    try {
      const response = await fetch("/api/tts/usage", {
        cache: "no-store",
        credentials: "include",
      });
      if (!response.ok) return;
      const data = await readJsonSafely(response);
      setTtsUsage(data as TtsUsageState);
      if (data && typeof data === "object" && "pointsBalance" in data) {
        auth.updatePointsBalance((data as TtsUsageState).pointsBalance);
      }
    } catch {}
  }, [auth]);

  const handleUnauthorized = useCallback(() => {
    resetWorkspaceState();
    profileLoadedOnceRef.current = false;
    void auth.refreshAuth();
    auth.openLoginModal();
  }, [auth, resetWorkspaceState]);

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
      if (!response.ok) return;
      const data = await readJsonSafely(response);
      setTtsHistory(Array.isArray(data) ? (data as TtsHistoryItem[]) : []);
    } catch {
      // 忽略网络错误
    }
  }, [handleUnauthorized]);

  const refreshScenes = useCallback(async () => {
    try {
      const response = await fetch("/api/tts/scenes", {
        cache: "no-store",
        credentials: "include",
      });
      if (!response.ok) return;
      const data = await readJsonSafely(response);
      setScenes(Array.isArray(data) ? (data as TtsSceneItem[]) : []);
    } catch {
      // 忽略网络错误
    }
  }, []);

  const refreshProfile = useCallback(async (isInitialLoad = false) => {
    if (isInitialLoad) {
      setLoadingProfile(true);
    }
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
      if (isInitialLoad) {
        setLoadingProfile(false);
      }
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

  useEffect(() => {
    void refreshScenes();
    return () => {
      if (enrollmentPollingTimerRef.current !== null) {
        window.clearTimeout(enrollmentPollingTimerRef.current);
      }
      recorderRef.current?.close();
      recorderRef.current = null;
    };
  }, [refreshScenes]);

  useEffect(() => {
    if (!auth.authUser) return;
    const isFirstLoad = !profileLoadedOnceRef.current;
    profileLoadedOnceRef.current = true;
    void refreshProfile(isFirstLoad);
    void refreshTtsHistory();
    void refreshTtsUsage();
  }, [auth.authUser, refreshProfile, refreshTtsHistory, refreshTtsUsage]);

  useEffect(() => {
    if (!selectedSceneKey) return;
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
    if (!audioFile || uploading || enrollmentPolling || Boolean(deletingRecordingId) || recording) return;
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
    if (recording || recordingStartingRef.current || uploading || enrollmentPolling || Boolean(deletingRecordingId)) return;
    recordingStartingRef.current = true;
    clearWorkspaceFeedback();
    setTtsResult(null);
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
    if (!recorder) return;
    recorderRef.current = null;
    const isAutoStop = recordingStopReasonRef.current === "auto";
    recordingStopReasonRef.current = "manual";
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
    if (!recording || !recordStartedAt) return;
    const elapsedMilliseconds = Date.now() - recordStartedAt;
    const remainingMilliseconds = Math.max(MAX_RECORD_SECONDS * 1000 - elapsedMilliseconds, 0);
    const timer = window.setTimeout(() => {
      if (!recorderRef.current) return;
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
        headers: { "Content-Type": "application/json" },
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
      void auth.refreshAuth();
    } catch (error) {
      setTtsError(toUserFacingErrorMessage(error, "语音合成失败，请稍后重试"));
    } finally {
      setTtsLoading(false);
    }
  }, [canUseActiveVoiceTts, clearWorkspaceFeedback, handleUnauthorized, refreshTtsHistory, refreshTtsUsage, auth, scenes, selectedSceneKey, ttsText, usingSceneVoice]);

  const handleRecordButtonClick = useCallback(() => {
    if (recording) {
      stopRecording();
      return;
    }
    void startRecording();
  }, [recording, startRecording, stopRecording]);

  return {
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
      isAuthenticated: Boolean(auth.authUser),
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