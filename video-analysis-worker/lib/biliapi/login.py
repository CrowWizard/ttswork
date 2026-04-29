from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from urllib.parse import parse_qs, urlparse

from .client import PatchrightClient


class QrCodeLoginState(str, Enum):
    SCAN = "scan"
    CONFIRM = "confirm"
    TIMEOUT = "timeout"
    DONE = "done"


@dataclass
class QrCodeLogin:
    client: PatchrightClient
    qr_url: str = ""
    qr_key: str = ""

    async def generate(self) -> str:
        data = await self.client.request_json("https://passport.bilibili.com/x/passport-login/web/qrcode/generate")
        self.qr_url = str(data["url"])
        self.qr_key = str(data["qrcode_key"])
        return self.qr_url

    async def poll(self) -> QrCodeLoginState:
        data = await self.client.request_json(
            "https://passport.bilibili.com/x/passport-login/web/qrcode/poll",
            params={"qrcode_key": self.qr_key},
        )
        code = data.get("code")
        if code == 86101:
            return QrCodeLoginState.SCAN
        if code == 86090:
            return QrCodeLoginState.CONFIRM
        if code == 86038:
            return QrCodeLoginState.TIMEOUT

        await self.client.add_bilibili_cookies(_cookies_from_redirect_url(str(data.get("url") or "")))
        return QrCodeLoginState.DONE


def _cookies_from_redirect_url(value: str) -> dict[str, str]:
    parsed = urlparse(value)
    query = parse_qs(parsed.query)
    return {
        "SESSDATA": _first(query, "SESSDATA"),
        "bili_jct": _first(query, "bili_jct"),
        "DedeUserID": _first(query, "DedeUserID"),
        "ac_time_value": _first(query, "ac_time_value"),
    }


def _first(query: dict[str, list[str]], key: str) -> str:
    values = query.get(key) or []
    return values[0] if values else ""
