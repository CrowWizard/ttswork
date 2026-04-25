import { useEffect, useState } from "react";

export function useRecordingElapsedSeconds(recording: boolean, recordStartedAt: number | null) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!recording || !recordStartedAt) {
      setElapsedSeconds(0);
      return;
    }

    setElapsedSeconds((Date.now() - recordStartedAt) / 1000);

    const timer = window.setInterval(() => {
      setElapsedSeconds((Date.now() - recordStartedAt) / 1000);
    }, 500);

    return () => window.clearInterval(timer);
  }, [recording, recordStartedAt]);

  return elapsedSeconds;
}
