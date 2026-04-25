const SUPPORTED_AUDIO_MIME_TYPES = ["audio/wav", "audio/mpeg", "audio/mp4"] as const;
const AUDIO_MIME_TYPE_ALIASES: Record<string, SupportedAudioMimeType> = {
  "audio/x-wav": "audio/wav",
};

export type SupportedAudioMimeType = (typeof SUPPORTED_AUDIO_MIME_TYPES)[number];

export function normalizeSupportedAudioMimeType(value: string) {
  const normalizedValue = value.trim().toLowerCase();

  return AUDIO_MIME_TYPE_ALIASES[normalizedValue] ?? normalizedValue;
}

export function isSupportedAudioMimeType(value: string): value is SupportedAudioMimeType {
  return SUPPORTED_AUDIO_MIME_TYPES.includes(normalizeSupportedAudioMimeType(value) as SupportedAudioMimeType);
}

export function getSupportedAudioMimeTypes() {
  return [...SUPPORTED_AUDIO_MIME_TYPES];
}

export function getAudioExtension(mimeType: SupportedAudioMimeType) {
  if (mimeType === "audio/wav") {
    return "wav";
  }

  if (mimeType === "audio/mpeg") {
    return "mp3";
  }

  return "m4a";
}
