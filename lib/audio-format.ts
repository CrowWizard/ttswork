const SUPPORTED_AUDIO_MIME_TYPES = ["audio/wav", "audio/mpeg", "audio/mp4"] as const;
const SUPPORTED_AUDIO_EXTENSIONS = ["wav", "mp3", "w4v"] as const;
const AUDIO_MIME_TYPE_ALIASES: Record<string, SupportedAudioMimeType> = {
  "audio/x-wav": "audio/wav",
  "video/mp4": "audio/mp4",
};
const AUDIO_EXTENSION_TO_MIME_TYPE: Record<SupportedAudioExtension, SupportedAudioMimeType> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  w4v: "audio/mp4",
};

export type SupportedAudioMimeType = (typeof SUPPORTED_AUDIO_MIME_TYPES)[number];
export type SupportedAudioExtension = (typeof SUPPORTED_AUDIO_EXTENSIONS)[number];

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

export function getSupportedAudioExtensions() {
  return [...SUPPORTED_AUDIO_EXTENSIONS];
}

export function getSupportedAudioAcceptValue() {
  return SUPPORTED_AUDIO_EXTENSIONS.map((extension) => `.${extension}`).join(",");
}

export function getAudioExtensionFromFilename(filename: string) {
  const normalizedFilename = filename.trim().toLowerCase();
  const extension = normalizedFilename.includes(".") ? normalizedFilename.split(".").pop() : "";

  if (!extension || !SUPPORTED_AUDIO_EXTENSIONS.includes(extension as SupportedAudioExtension)) {
    return null;
  }

  return extension as SupportedAudioExtension;
}

export function resolveSupportedAudioMimeType(value: string, filename?: string) {
  const normalizedMimeType = normalizeSupportedAudioMimeType(value);

  if (SUPPORTED_AUDIO_MIME_TYPES.includes(normalizedMimeType as SupportedAudioMimeType)) {
    return normalizedMimeType as SupportedAudioMimeType;
  }

  const extension = filename ? getAudioExtensionFromFilename(filename) : null;

  return extension ? AUDIO_EXTENSION_TO_MIME_TYPE[extension] : null;
}

export function getAudioExtension(mimeType: SupportedAudioMimeType) {
  if (mimeType === "audio/wav") {
    return "wav";
  }

  if (mimeType === "audio/mpeg") {
    return "mp3";
  }

  return "w4v";
}
