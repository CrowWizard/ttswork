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
  sceneKey?: string | null;
  instruction?: string | null;
};

export type TtsHistoryItem = {
  jobId: string;
  text: string;
  status: string;
  createdAt: string;
  downloadUrl: string;
  profileKind: VoiceProfileKind;
  sceneKey?: string | null;
  instruction?: string | null;
};

export type TtsSceneItem = {
  key: string;
  label: string;
  instruction: string;
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
  loadingProfile: boolean;
  profile: VoiceProfileResponse | null;
  recording: boolean;
  recordStartedAt: number | null;
  uploading: boolean;
  creatingPureVoice: boolean;
  creatingSceneVoice: boolean;
  invalidatingVoiceId: string | null;
  deletingRecordingId: string | null;
  selectedRecordingId: string | null;
  onSelectRecording: (recordingId: string) => void;
  onDeleteRecording: (recordingId: string) => void;
  onUploadAudioFile: (file: File | null) => void;
  workspaceError: string | null;
  workspaceNotice: StatusState | null;
  onRecordButtonClick: () => void;
  onCreatePureVoice: () => void;
  onCreateSceneVoice: () => void;
  onInvalidateVoice: (enrollmentId: string) => void;
};

export type TtsPanelProps = {
  isAuthenticated: boolean;
  hasPureVoice: boolean;
  hasSceneVoice: boolean;
  canSubmitTts: boolean;
  ttsText: string;
  ttsLoading: boolean;
  ttsResult: TtsResult | null;
  ttsHistory: TtsHistoryItem[];
  scenes: TtsSceneItem[];
  selectedSceneKey: string;
  onTtsTextChange: (value: string) => void;
  onSceneChange: (value: string) => void;
  onSubmitTts: () => void;
};
