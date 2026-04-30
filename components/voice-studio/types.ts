export type VoiceProfileResponse = {
  userId: string | null;
  anonymousUserId?: string | null;
  activeVoices: {
    pure: ActiveVoiceSummary | null;
    scene: ActiveVoiceSummary | null;
  };
  recordings: VoiceRecordingItem[];
  recentEnrollments: Array<{
    id: string;
    status: string;
    voiceId: string | null;
    durationSeconds: number;
    createdAt: string;
    errorMessage: string | null;
    isInvalidated: boolean;
    profileKind: VoiceProfileKind;
    recordingId: string;
  }>;
};

export type VoiceProfileKind = "PURE" | "SCENE";

export type ActiveVoiceSummary = {
  id: string;
  voiceId: string | null;
  status: string;
  durationSeconds: number;
  createdAt: string;
  isInvalidated: boolean;
  profileKind: VoiceProfileKind;
  recordingId: string;
};

export type VoiceRecordingItem = {
  id: string;
  status: string;
  durationSeconds: number;
  createdAt: string;
  playbackUrl: string;
  originalFilename: string | null;
};

export type TtsResult = {
  jobId: string;
  status: string;
  downloadUrl: string;
  voiceIdSnapshot: string;
  profileKind: VoiceProfileKind;
  accessKind: TtsAccessKind;
  sceneKey?: string | null;
  instruction?: string | null;
};

export type TtsAccessKind = "FREE_TRIAL" | "GENERAL_USAGE_CODE" | "USAGE_CODE" | "POINTS";

export type TtsHistoryItem = {
  jobId: string;
  text: string;
  status: string;
  createdAt: string;
  downloadUrl: string;
  profileKind: VoiceProfileKind;
  accessKind: TtsAccessKind;
  sceneKey?: string | null;
  instruction?: string | null;
};

export type TtsSceneItem = {
  key: string;
  label: string;
  instruction: string;
};

export type TtsUsageState = {
  isAuthenticated: boolean;
  pointsBalance: number;
  ttsCostPoints: number;
  usageCodeRedeemPoints: number;
};

export type AuthUser = {
  id: string;
  phoneNumber: string;
  hasPassword: boolean;
  phoneVerifiedAt: string | null;
  pointsBalance: number;
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

export type UserHeaderProps = {
  authResolving: boolean;
  authUser: AuthUser | null;
  pointsBalance: number;
  redeemUsageCode: string;
  redeemingUsageCode: boolean;
  redeemMessage: StatusState | null;
  onRedeemUsageCodeChange: (value: string) => void;
  onRedeemUsageCode: () => void;
  onLogout: () => void;
};

export type WorkspaceHeaderProps = object;

export type RecordingPanelProps = {
  loadingProfile: boolean;
  profile: VoiceProfileResponse | null;
  recording: boolean;
  recordStartedAt: number | null;
  uploading: boolean;
  deletingRecordingId: string | null;
  onDeleteRecording: (recordingId: string) => void;
  onUploadAudioFile: (file: File | null) => void;
  workspaceError: string | null;
  workspaceNotice: StatusState | null;
  onRecordButtonClick: () => void;
  enrollmentPolling: boolean;
  enrollmentPollingMessage: string | null;
};

export type TtsPanelProps = {
  isAuthenticated: boolean;
  hasPureVoice: boolean;
  hasSceneVoice: boolean;
  canSubmitTts: boolean;
  ttsText: string;
  ttsUsage: TtsUsageState | null;
  ttsLoading: boolean;
  ttsResult: TtsResult | null;
  ttsError: string | null;
  ttsHistory: TtsHistoryItem[];
  scenes: TtsSceneItem[];
  selectedSceneKey: string;
  onTtsTextChange: (value: string) => void;
  onSceneChange: (value: string) => void;
  onSubmitTts: () => void;
};
