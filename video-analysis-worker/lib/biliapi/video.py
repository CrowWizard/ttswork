from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from .client import BiliApiError, PatchrightClient
from .login import QrCodeLogin


@dataclass
class SubtitleTrack:
    url: str
    language: str | None


@dataclass
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


class BiliApi:
    def __init__(
        self,
        *,
        timeout_seconds: int = 20,
        user_agent: str | None = None,
        cookie_header: str = "",
        profile_dir: str | None = None,
    ):
        self._loop = asyncio.new_event_loop()
        self._client = PatchrightClient(
            timeout_seconds=timeout_seconds,
            user_agent=user_agent,
            cookie_header=cookie_header,
            profile_dir=profile_dir,
        )

    def fetch_video_snapshot(self, bvid: str) -> VideoSnapshot:
        return self._run(self._fetch_video_snapshot(bvid))

    def fetch_audio_url(self, bvid: str, cid: int) -> str:
        return self._run(self._fetch_audio_url(bvid, cid))

    def create_qrcode_login(self) -> QrCodeLogin:
        return QrCodeLogin(self._client)

    def close(self) -> None:
        self._run(self._client.close())
        self._loop.close()

    async def _fetch_video_snapshot(self, bvid: str) -> VideoSnapshot:
        view_payload = await self._client.request_json(
            "https://api.bilibili.com/x/web-interface/view",
            params={"bvid": bvid},
        )
        pages = view_payload.get("pages") or []
        cid = int(pages[0]["cid"]) if pages else 0
        if cid <= 0:
            raise BiliApiError("B站视频缺少可分析分P信息")

        subtitle_tracks = await self._fetch_subtitle_tracks(bvid, cid)
        owner = view_payload.get("owner") or {}
        pubdate = view_payload.get("pubdate")
        publish_time = None
        if isinstance(pubdate, (int, float)):
            publish_time = datetime.fromtimestamp(pubdate, tz=timezone.utc)

        return VideoSnapshot(
            bvid=bvid,
            cid=cid,
            title=str(view_payload.get("title") or bvid),
            author_name=_optional_string(owner.get("name")),
            author_mid=_optional_string(owner.get("mid")),
            cover_url=_optional_string(view_payload.get("pic")),
            duration_seconds=_optional_float(view_payload.get("duration")),
            publish_time=publish_time,
            subtitle_tracks=subtitle_tracks,
        )

    async def _fetch_audio_url(self, bvid: str, cid: int) -> str:
        payload = await self._client.request_json(
            "https://api.bilibili.com/x/player/playurl",
            params={
                "bvid": bvid,
                "cid": cid,
                "qn": 127,
                "fnval": 4048,
                "fnver": 0,
                "fourk": 1,
                "from_client": "BROWSER",
                "web_location": 1315873,
            },
        )
        dash = payload.get("dash") or {}
        audio_items = dash.get("audio") or []
        if not audio_items:
            raise BiliApiError("B站音频地址不可用")

        selected = sorted(audio_items, key=lambda item: int(item.get("bandwidth") or 0), reverse=True)[0]
        audio_url = _absolute_url(selected.get("baseUrl") or selected.get("base_url") or selected.get("url"))
        if not audio_url:
            raise BiliApiError("B站音频地址解析失败")
        return audio_url

    async def _fetch_subtitle_tracks(self, bvid: str, cid: int) -> list[SubtitleTrack]:
        payload = await self._client.request_json(
            "https://api.bilibili.com/x/player/v2",
            params={"bvid": bvid, "cid": cid, "web_location": 1315873},
        )
        subtitle_info = payload.get("subtitle") or {}
        raw_tracks = subtitle_info.get("subtitles") or subtitle_info.get("list") or []
        tracks: list[SubtitleTrack] = []
        for item in raw_tracks:
            # 优先使用 url，其次 subtitle_url
            raw = item.get("url") or item.get("subtitle_url")
            url = _absolute_url(raw)
            if not url:
                continue
            tracks.append(SubtitleTrack(url=url, language=_optional_string(item.get("lan_doc") or item.get("lan"))))
        return tracks

    def _run(self, task):
        return self._loop.run_until_complete(task)


def _absolute_url(value: Any) -> str | None:
    if not value:
        return None
    text = str(value)
    if text.startswith("//"):
        return f"https:{text}"
    return text


def _optional_string(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _optional_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
