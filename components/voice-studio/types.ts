import type { KeyboardEvent, MouseEvent, TouchEvent } from "react";

export type VoiceProfileResponse = {
  userId: string | null;
  anonymousUserId?: string | null;
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

export type TtsResult = {
  jobId: string;
  status: string;
  downloadUrl: string;
  voiceIdSnapshot: string;
};

export type TtsHistoryItem = {
  jobId: string;
  text: string;
  status: string;
  createdAt: string;
  downloadUrl: string;
};

export type AuthUser = {
  id: string;
  phoneNumber: string;
  hasPassword: boolean;
  phoneVerifiedAt: string | null;
  createdAt: string;
};

export type StatusTone = "error" | "success" | "info" | "warning";

export type StatusState = {
  type: StatusTone;
  title?: string;
  text: string;
};

export type AuthMode = "sms" | "password";

export type AuthPanelProps = {
  authMode: AuthMode;
  authPhoneNumber: string;
  smsCode: string;
  password: string;
  authSubmitting: boolean;
  sendingSms: boolean;
  smsCountdown: number;
  authMessage: StatusState | null;
  debugCode: string | null;
  onAuthModeChange: (mode: AuthMode) => void;
  onPhoneNumberChange: (value: string) => void;
  onSmsCodeChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSendSms: () => void;
  onSubmitSmsLogin?: () => void;
  onSubmitPasswordLogin?: () => void;
};

export type WorkspaceHeaderProps = {
  authResolving: boolean;
  authUser: AuthUser | null;
  onLogout: () => void;
};

export type RecordingPanelProps = {
  activeVoiceLabel: string;
  canPlaybackActiveVoice: boolean;
  activeVoicePlaybackUrl: string | null;
  loadingProfile: boolean;
  profile: VoiceProfileResponse | null;
  recording: boolean;
  recordStartedAt: number | null;
  enrolling: boolean;
  invalidating: boolean;
  workspaceError: string | null;
  workspaceNotice: StatusState | null;
  onRecordButtonMouseDown: (event: MouseEvent<HTMLButtonElement>) => void;
  onRecordButtonMouseUp: () => void;
  onRecordButtonMouseLeave: () => void;
  onRecordButtonTouchStart: (event: TouchEvent<HTMLButtonElement>) => void;
  onRecordButtonTouchEnd: (event: TouchEvent<HTMLButtonElement>) => void;
  onRecordButtonTouchCancel: (event: TouchEvent<HTMLButtonElement>) => void;
  onRecordButtonKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onInvalidateActiveVoice: () => void;
};

export type TtsPanelProps = {
  isAuthenticated: boolean;
  hasActiveVoice: boolean;
  canSubmitTts: boolean;
  ttsText: string;
  ttsLoading: boolean;
  ttsResult: TtsResult | null;
  ttsHistory: TtsHistoryItem[];
  ttsUsedCount: number;
  onTtsTextChange: (value: string) => void;
  onSubmitTts: () => void;
};
