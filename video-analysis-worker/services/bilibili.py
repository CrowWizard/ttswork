from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from config import WorkerConfig
from lib.biliapi import BiliApi


@dataclass(slots=True)
class SubtitleTrack:
    url: str
    language: str | None


@dataclass(slots=True)
class VideoSnapshot:
    bvid: str
    cid: int
    title: str
    author_name: str | None
    author_mid: str | None
    cover_url: str | None
    duration_seconds: float | None
    publish_time: datetime | None
    subtitle_tracks: list[SubtitleTrack]


class BilibiliService:
    def __init__(self, config: WorkerConfig):
        self._api = BiliApi(
            timeout_seconds=config.http_timeout_seconds,
            user_agent=config.bilibili_user_agent,
            cookie_header=config.bilibili_cookie,
        )

    def fetch_video_snapshot(self, bvid: str) -> VideoSnapshot:
        snapshot = self._api.fetch_video_snapshot(bvid)
        return VideoSnapshot(
            bvid=snapshot.bvid,
            cid=snapshot.cid,
            title=snapshot.title,
            author_name=snapshot.author_name,
            author_mid=snapshot.author_mid,
            cover_url=snapshot.cover_url,
            duration_seconds=snapshot.duration_seconds,
            publish_time=snapshot.publish_time,
            subtitle_tracks=[SubtitleTrack(url=track.url, language=track.language) for track in snapshot.subtitle_tracks],
        )

    def fetch_audio_url(self, bvid: str, cid: int) -> str:
        return self._api.fetch_audio_url(bvid, cid)
