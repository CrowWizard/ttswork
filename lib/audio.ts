import { MIN_RECORD_SECONDS } from "@/lib/constants";

export function isRecordDurationAccepted(durationSeconds: number) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return false;
  }

  return durationSeconds >= MIN_RECORD_SECONDS;
}
