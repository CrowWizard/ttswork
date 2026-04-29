from __future__ import annotations

from typing import Any

import requests

from config import WorkerConfig
from services.bilibili import SubtitleTrack


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
        if not tracks:
            raise SubtitleUnavailableError("当前视频没有可用字幕")

        for track in tracks:
            text = self._fetch_track_text(track)
            if text:
                return text

        raise SubtitleFetchError("字幕内容为空")

    def _fetch_track_text(self, track: SubtitleTrack) -> str:
        response = self._session.get(track.url, timeout=self._timeout)
        response.raise_for_status()
        payload = response.json()
        body = payload.get("body")
        if not isinstance(body, list):
            raise SubtitleFetchError("字幕接口返回缺少 body")

        lines = [_normalize_line(item) for item in body]
        text = "\n".join(line for line in lines if line)
        return text.strip()


def _normalize_line(item: Any) -> str:
    if not isinstance(item, dict):
        return ""

    content = str(item.get("content") or "").strip()
    return " ".join(content.split())
