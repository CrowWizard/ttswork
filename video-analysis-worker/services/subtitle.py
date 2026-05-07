from __future__ import annotations

from typing import Any

import requests

from config import WorkerConfig
from services.bilibili import SubtitleTrack
from services.transcript import TranscriptPayload


class SubtitleUnavailableError(RuntimeError):
    pass


class SubtitleFetchError(RuntimeError):
    pass


class SubtitleService:
    def __init__(self, config: WorkerConfig):
        self._timeout = config.http_timeout_seconds
        self._session = requests.Session()
        self._session.headers.update({"User-Agent": config.bilibili_user_agent})

    def fetch_text(self, tracks: list[SubtitleTrack]) -> str:
        return self.fetch_payload(tracks).text

    def fetch_payload(self, tracks: list[SubtitleTrack]) -> TranscriptPayload:
        if not tracks:
            raise SubtitleUnavailableError("当前视频没有可用字幕")

        for track in tracks:
            payload = self._fetch_track_payload(track)
            if payload.text:
                return payload

        raise SubtitleFetchError("字幕内容为空")

    def _fetch_track_text(self, track: SubtitleTrack) -> str:
        return self._fetch_track_payload(track).text

    def _fetch_track_payload(self, track: SubtitleTrack) -> TranscriptPayload:
        response = self._session.get(track.url, timeout=self._timeout)
        response.raise_for_status()
        payload = response.json()
        body = payload.get("body")
        if not isinstance(body, list):
            raise SubtitleFetchError("字幕接口返回缺少 body")

        lines = [_normalize_line(item) for item in body]
        text = "\n".join(line for line in lines if line)
        timeline_lines = [_normalize_timeline_line(item) for item in body]
        timeline_text = "\n".join(line for line in timeline_lines if line).strip() or text.strip()
        duration = _extract_duration(body)
        return TranscriptPayload(text=text.strip(), timeline_text=timeline_text, duration_seconds=duration)


def _normalize_line(item: Any) -> str:
    if not isinstance(item, dict):
        return ""

    content = str(item.get("content") or "").strip()
    return " ".join(content.split())


def _normalize_timeline_line(item: Any) -> str:
    if not isinstance(item, dict):
        return ""

    content = _normalize_line(item)
    if not content:
        return ""

    start = _to_seconds(item.get("from"))
    if start is None:
        return content

    return f"[{_format_seconds_to_time(start)}] {content}"


def _extract_duration(body: list[Any]) -> float | None:
    durations = [_to_seconds(item.get("to")) for item in body if isinstance(item, dict)]
    valid = [item for item in durations if item is not None]
    return max(valid) if valid else None


def _to_seconds(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None

    try:
        seconds = float(value)
    except (TypeError, ValueError):
        return None

    return seconds if seconds >= 0 else None


def _format_seconds_to_time(seconds: float) -> str:
    minutes, secs = divmod(int(seconds), 60)
    return f"{minutes:02d}:{secs:02d}"
