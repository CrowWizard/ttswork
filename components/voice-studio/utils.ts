export function formatDuration(durationSeconds: number) {
  return `${durationSeconds.toFixed(1)} 秒`;
}

export function buildAudioFilename(jobId: string, profileKind?: "PURE" | "SCENE") {
  return `tts-${profileKind === "SCENE" ? "scene" : "pure"}-${jobId}.wav`;
}

export function pickRecordingMimeType() {
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

export async function readJsonSafely(response: Response) {
  return response.json().catch(() => ({}));
}

export function toUserFacingErrorMessage(error: unknown, fallbackMessage: string) {
  if (!(error instanceof Error)) {
    return fallbackMessage;
  }

  const message = error.message.trim();

  if (!message) {
    return fallbackMessage;
  }

  if (/Unexpected token|is not valid JSON|JSON|<!DOCTYPE html>|<html/i.test(message)) {
    return fallbackMessage;
  }

  return message;
}
