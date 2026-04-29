from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import urlencode

if TYPE_CHECKING:
    from patchright.async_api import BrowserContext, Page


class BiliApiError(RuntimeError):
    pass


@dataclass
class BiliResponse:
    status: int
    url: str
    headers: dict[str, str]
    text: str
    cookies: dict[str, str]

    def json(self) -> Any:
        try:
            return json.loads(self.text)
        except json.JSONDecodeError as exc:
            raise BiliApiError("B站接口返回非 JSON 数据") from exc


class PatchrightClient:
    def __init__(
        self,
        *,
        timeout_seconds: int = 20,
        user_agent: str | None = None,
        cookie_header: str = "",
        profile_dir: str | None = None,
        headless: bool = True,
    ):
        self._timeout_ms = timeout_seconds * 1000
        self._user_agent = user_agent
        self._cookie_header = cookie_header
        self._profile_dir = Path(
            profile_dir
            or os.environ.get("BILIAPI_PROFILE_DIR")
            or Path(__file__).resolve().parents[2] / ".biliapi-profile"
        )
        self._headless = headless
        self._playwright = None
        self._context: "BrowserContext | None" = None
        self._page: "Page | None" = None

    async def request_json(
        self,
        url: str,
        *,
        params: dict[str, Any] | None = None,
        method: str = "GET",
        data: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        response = await self.request(url, params=params, method=method, data=data, headers=headers)
        if response.status < 200 or response.status >= 300:
            raise BiliApiError(f"B站接口 HTTP 异常 status={response.status}")

        payload = response.json()
        if not isinstance(payload, dict):
            raise BiliApiError("B站接口 JSON 顶层结构异常")

        code = payload.get("code")
        if code not in (0, None):
            raise BiliApiError(str(payload.get("message") or f"B站接口返回异常 code={code}"))

        data_payload = payload.get("data")
        if not isinstance(data_payload, dict):
            raise BiliApiError("B站接口返回缺少 data")

        return data_payload

    async def request(
        self,
        url: str,
        *,
        params: dict[str, Any] | None = None,
        method: str = "GET",
        data: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> BiliResponse:
        await self._ensure_context()
        final_url = _append_query(url, params)
        request_headers = self._default_headers()
        request_headers.update(headers or {})
        page = await self._ensure_page()
        body = urlencode(data or {}) if data else None

        try:
            result = await page.evaluate(
                """
                async ({ url, method, headers, body }) => {
                    const response = await fetch(url, {
                        method,
                        headers,
                        body,
                        credentials: 'include',
                    });
                    return {
                        status: response.status,
                        url: response.url,
                        headers: Object.fromEntries(response.headers.entries()),
                        text: await response.text(),
                    };
                }
                """,
                {
                    "url": final_url,
                    "method": method.upper(),
                    "headers": request_headers,
                    "body": body,
                },
            )
        except Exception:
            result = await self._request_with_context(final_url, method, body, request_headers)

        cookies = await self._cookies_dict()
        return BiliResponse(
            status=int(result["status"]),
            url=str(result["url"]),
            headers={str(k): str(v) for k, v in dict(result["headers"]).items()},
            text=str(result["text"]),
            cookies=cookies,
        )

    async def add_bilibili_cookies(self, cookies: dict[str, str]) -> None:
        await self._ensure_context()
        valid_items = {key: value for key, value in cookies.items() if value}
        if not valid_items or self._context is None:
            return

        await self._context.add_cookies(
            [
                {
                    "name": key,
                    "value": value,
                    "domain": ".bilibili.com",
                    "path": "/",
                    "httpOnly": key.upper() == "SESSDATA",
                    "secure": True,
                    "sameSite": "Lax",
                }
                for key, value in valid_items.items()
            ]
        )

    async def open_login_page(self) -> None:
        page = await self._ensure_page()
        await page.goto("https://passport.bilibili.com/login", wait_until="domcontentloaded")

    async def is_logged_in(self) -> bool:
        cookies = await self._cookies_dict()
        return bool(cookies.get("SESSDATA"))

    async def wait_for_login(self, *, timeout_seconds: int = 180) -> dict[str, str]:
        await self._ensure_context()
        deadline = _monotonic_seconds() + timeout_seconds
        while _monotonic_seconds() < deadline:
            cookies = await self._cookies_dict()
            if cookies.get("SESSDATA"):
                return cookies
            page = await self._ensure_page()
            await page.wait_for_timeout(1000)

        raise BiliApiError("等待 B 站登录超时")

    async def close(self) -> None:
        if self._context is not None:
            await self._context.close()
            self._context = None
            self._page = None
        if self._playwright is not None:
            await self._playwright.stop()
            self._playwright = None

    async def _ensure_context(self) -> None:
        if self._context is not None:
            return

        try:
            from patchright.async_api import async_playwright
        except ModuleNotFoundError as exc:
            raise BiliApiError("缺少 patchright 依赖，请执行 `pip install -r video-analysis-worker/requirements.txt`") from exc

        self._profile_dir.mkdir(parents=True, exist_ok=True)
        try:
            self._playwright = await async_playwright().start()
            self._context = await self._playwright.chromium.launch_persistent_context(
                user_data_dir=str(self._profile_dir),
                headless=self._headless,
                user_agent=self._user_agent,
                viewport={"width": 1366, "height": 768},
                locale="zh-CN",
                timezone_id="Asia/Shanghai",
                args=["--disable-blink-features=AutomationControlled"],
            )
            self._context.set_default_timeout(self._timeout_ms)
            if self._cookie_header:
                await self.add_bilibili_cookies(_parse_cookie_header(self._cookie_header))
        except Exception as exc:
            raise BiliApiError(
                f"无法启动 Patchright 浏览器上下文，请确认系统依赖（如 libnss3、libxss1 等）已安装，"
                f"或在有图形界面的环境中运行。错误: {exc}"
            ) from exc

    async def _ensure_page(self) -> Page:
        # 先确保上下文已初始化
        await self._ensure_context()
        if self._page is not None and not self._page.is_closed():
            return self._page
        if self._context is None:
            raise BiliApiError("Patchright 上下文未初始化")

        self._page = await self._context.new_page()
        await self._page.goto("https://www.bilibili.com/", wait_until="domcontentloaded")
        return self._page

    async def _request_with_context(
        self,
        url: str,
        method: str,
        body: str | None,
        headers: dict[str, str],
    ) -> dict[str, Any]:
        if self._context is None:
            raise BiliApiError("Patchright 上下文未初始化")
        response = await self._context.request.fetch(
            url,
            method=method.upper(),
            data=body,
            headers=headers,
            timeout=self._timeout_ms,
        )
        return {
            "status": response.status,
            "url": response.url,
            "headers": response.headers,
            "text": await response.text(),
        }

    async def _cookies_dict(self) -> dict[str, str]:
        if self._context is None:
            return {}
        cookies = await self._context.cookies(["https://www.bilibili.com", "https://api.bilibili.com"])
        return {str(item["name"]): str(item["value"]) for item in cookies}

    def _default_headers(self) -> dict[str, str]:
        headers = {
            "Referer": "https://www.bilibili.com/",
            "Origin": "https://www.bilibili.com",
            "Accept": "application/json, text/plain, */*",
        }
        if self._user_agent:
            headers["User-Agent"] = self._user_agent
        return headers


def _append_query(url: str, params: dict[str, Any] | None) -> str:
    if not params:
        return url
    query = urlencode({key: value for key, value in params.items() if value is not None})
    separator = "&" if "?" in url else "?"
    return f"{url}{separator}{query}"


def _monotonic_seconds() -> float:
    import time

    return time.monotonic()


def _parse_cookie_header(cookie_header: str) -> dict[str, str]:
    cookies: dict[str, str] = {}
    for piece in cookie_header.split(";"):
        if "=" not in piece:
            continue
        key, value = piece.split("=", 1)
        key = key.strip()
        value = value.strip()
        if key and value:
            cookies[key] = value
    return cookies
