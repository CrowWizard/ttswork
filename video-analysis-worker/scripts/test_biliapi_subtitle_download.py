from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any

WORKER_DIR = Path(__file__).resolve().parents[1]
if str(WORKER_DIR) not in sys.path:
    sys.path.insert(0, str(WORKER_DIR))

from lib.biliapi.client import PatchrightClient


async def main() -> None:
    args = parse_args()
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    client = PatchrightClient(
        timeout_seconds=args.timeout,
        profile_dir=args.profile_dir,
        headless=False,
    )
    try:
        await ensure_login(client, args.login_timeout)
        view = await client.request_json(
            "https://api.bilibili.com/x/web-interface/view",
            params={"bvid": args.bvid},
        )
        pages = view.get("pages") or []
        if not pages:
            raise RuntimeError("视频缺少分 P 信息，无法获取 cid")

        if args.page < 1 or args.page > len(pages):
            raise RuntimeError(f"分 P 序号超出范围，当前视频共有 {len(pages)} 个分 P")

        page_info = pages[args.page - 1]
        cid = int(page_info["cid"])
        print(f"使用分 P: {args.page}, cid: {cid}, 标题: {page_info.get('part', 'N/A')}")

        player = await client.request_json(
            "https://api.bilibili.com/x/player/v2",
            params={"bvid": args.bvid, "cid": cid, "web_location": 1315873},
        )

        # 检查字幕接口返回的 cid 是否一致
        if player.get("subtitle", {}).get("cid") and int(player["subtitle"]["cid"]) != cid:
            print(f"警告：字幕接口返回的 cid={player['subtitle']['cid']} 与当前分 P cid={cid} 不一致，可能字幕不匹配")
        track = choose_subtitle_track(player, args.language)
        # 尝试多种字段名
        subtitle_url = track.get("subtitle_url") or track.get("url") or track.get("subtitleUrl")
        if not subtitle_url or not str(subtitle_url).strip():
            raise RuntimeError(f"字幕轨道 URL 为空或无效，可用字段: {list(track.keys())}")
        subtitle_url = absolute_url(subtitle_url)

        response = await client.request(subtitle_url)
        if response.status < 200 or response.status >= 300:
            raise RuntimeError(f"字幕下载失败 status={response.status}")

        subtitle_payload = response.json()
        json_path = output_dir / f"{args.bvid}_p{args.page}.subtitle.json"
        text_path = output_dir / f"{args.bvid}_p{args.page}.subtitle.txt"
        json_path.write_text(json.dumps(subtitle_payload, ensure_ascii=False, indent=2), encoding="utf-8")
        text_path.write_text(extract_subtitle_text(subtitle_payload), encoding="utf-8")

        print(f"已下载字幕 JSON: {json_path}")
        print(f"已导出字幕文本: {text_path}")
        print(f"字幕语言: {track.get('lan_doc') or track.get('lan') or 'unknown'}")
        print(f"字幕地址: {subtitle_url}")
    finally:
        await client.close()


async def ensure_login(client: PatchrightClient, timeout_seconds: int) -> None:
    await client.open_login_page()
    if await client.is_logged_in():
        print("已检测到现有 B 站登录态，继续下载字幕。")
        return

    print("已打开有头浏览器，请在 B 站登录页扫码或完成登录。")
    await client.wait_for_login(timeout_seconds=timeout_seconds)
    print("B 站登录成功，Cookie 已写入 Patchright 持久化 profile。")


def extract_subtitle_url(track: dict[str, Any]) -> str:
    # 优先使用 url，其次 subtitle_url
    url = track.get("url") or track.get("subtitle_url")
    if not url or not str(url).strip():
        raise RuntimeError(f"字幕轨道 URL 为空或无效，可用字段: {list(track.keys())}")
    url = str(url)
    if url.startswith("//"):
        url = "https:" + url
    return url

def choose_subtitle_track(player: dict[str, Any], language: str | None) -> dict[str, Any]:
    subtitle = player.get("subtitle") or {}
    tracks = subtitle.get("subtitles") or subtitle.get("list") or []
    if not tracks:
        raise RuntimeError("当前视频没有可下载字幕")

    # 调试：打印所有轨道的字段和 URL 有效性
    valid_tracks = []
    for i, track in enumerate(tracks):
        try:
            url = extract_subtitle_url(track)
            print(f"轨道 {i}: lan={track.get('lan')}, lan_doc={track.get('lan_doc')}, "
                  f"subtitle_url={track.get('subtitle_url')}, url={track.get('url')} -> 有效 URL: {url[:50]}...")
            valid_tracks.append((i, track, url))
        except RuntimeError as e:
            print(f"轨道 {i}: lan={track.get('lan')}, lan_doc={track.get('lan_doc')} -> 无效: {e}")

    if not valid_tracks:
        raise RuntimeError("所有字幕轨道的 URL 均无效")

    # 优先选择指定语言的轨道
    if language:
        for i, track, url in valid_tracks:
            lan = str(track.get("lan") or "").lower()
            lan_doc = str(track.get("lan_doc") or "").lower()
            if language.lower() in lan or language.lower() in lan_doc:
                return track

    # 否则返回第一个有效轨道
    return valid_tracks[0][1]


def extract_subtitle_text(payload: dict[str, Any]) -> str:
    body = payload.get("body")
    if not isinstance(body, list):
        raise RuntimeError("字幕 JSON 缺少 body 列表")

    lines: list[str] = []
    for item in body:
        if not isinstance(item, dict):
            continue
        content = " ".join(str(item.get("content") or "").strip().split())
        if content:
            lines.append(content)
    return "\n".join(lines).strip() + "\n"


def absolute_url(value: Any) -> str:
    text = str(value or "")
    if text.startswith("//"):
        return f"https:{text}"
    return text


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="使用有头 Patchright 登录 B 站并下载指定视频字幕")
    parser.add_argument("--bvid", required=True, help="要测试的 BVID，例如 BV1xx411c7mD")
    parser.add_argument("--page", type=int, default=1, help="分 P 序号，从 1 开始")
    parser.add_argument("--language", default="zh", help="字幕语言关键词，默认优先中文")
    parser.add_argument("--output-dir", default=str(WORKER_DIR / "tmp"), help="字幕输出目录")
    parser.add_argument("--profile-dir", default=None, help="Patchright 持久化 profile 目录")
    parser.add_argument("--timeout", type=int, default=30, help="单个请求超时时间，秒")
    parser.add_argument("--login-timeout", type=int, default=180, help="等待扫码/网页登录超时时间，秒")
    return parser.parse_args()


if __name__ == "__main__":
    asyncio.run(main())
