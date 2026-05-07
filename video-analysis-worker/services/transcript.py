from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TranscriptPayload:
    text: str
    timeline_text: str
    duration_seconds: float | None = None
