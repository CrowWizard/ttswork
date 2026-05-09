from __future__ import annotations

import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote, urlparse

import requests as http_requests

from config import WorkerConfig


@dataclass(frozen=True)
class StoredAudio:
    bucket: str
    object_key: str
    minio_uri: str
    public_url: str
    content_type: str
    size_bytes: int


class AudioStorageService:
    def __init__(self, config: WorkerConfig):
        try:
            from minio import Minio
        except ModuleNotFoundError as exc:
            raise RuntimeError("缺少 minio 依赖，请执行 `pip install -r video-analysis-worker/requirements.txt`") from exc

        self._config = config
        self._session = http_requests.Session()
        endpoint = f"{config.minio_endpoint}:{config.minio_port}"
        self._client = Minio(
            endpoint,
            access_key=config.minio_access_key,
            secret_key=config.minio_secret_key,
            secure=config.minio_use_ssl,
        )

    def download_and_store(self, *, bvid: str, cid: int, audio_url: str) -> StoredAudio:
        if not audio_url:
            raise RuntimeError("B站音频地址为空，无法保存到 MinIO")

        self._ensure_bucket()
        temp_path: Path | None = None
        try:
            temp_path, content_type, size_bytes = self._download_audio(audio_url)
            object_key = self._build_object_key(bvid, cid, audio_url, content_type)
            self._client.fput_object(
                self._config.minio_bucket,
                object_key,
                str(temp_path),
                content_type=content_type,
            )
            public_url = _build_public_object_url(
                self._config.minio_public_base_url,
                self._config.minio_bucket,
                object_key,
            )
            return StoredAudio(
                bucket=self._config.minio_bucket,
                object_key=object_key,
                minio_uri=f"minio://{self._config.minio_bucket}/{object_key}",
                public_url=public_url,
                content_type=content_type,
                size_bytes=size_bytes,
            )
        finally:
            if temp_path and temp_path.exists():
                temp_path.unlink()

    def _ensure_bucket(self) -> None:
        if self._client.bucket_exists(self._config.minio_bucket):
            return

        self._client.make_bucket(self._config.minio_bucket)

    def _download_audio(self, audio_url: str) -> tuple[Path, str, int]:
        headers = {
            "User-Agent": self._config.bilibili_user_agent,
            "Referer": "https://www.bilibili.com/",
        }
        try:
            resp = self._session.get(
                audio_url,
                headers=headers,
                stream=True,
                timeout=self._config.http_timeout_seconds,
            )
            resp.raise_for_status()
        except http_requests.RequestException as exc:
            raise RuntimeError(f"B站音频下载失败: {exc}") from exc

        content_type = _normalize_content_type(resp.headers.get("content-type"))
        with tempfile.NamedTemporaryFile(
            prefix="bili-asr-audio-",
            suffix=_extension_for_content_type(content_type),
            delete=False,
        ) as fh:
            size_bytes = 0
            for chunk in resp.iter_content(chunk_size=1024 * 1024):
                if not chunk:
                    continue

                fh.write(chunk)
                size_bytes += len(chunk)

        temp_path = Path(fh.name)
        if size_bytes <= 0:
            temp_path.unlink(missing_ok=True)
            raise RuntimeError("B站音频下载结果为空")

        return temp_path, content_type, size_bytes

    def _build_object_key(self, bvid: str, cid: int, audio_url: str, content_type: str) -> str:
        extension = _extension_from_url(audio_url) or _extension_for_content_type(content_type)
        safe_bvid = "".join(ch if ch.isalnum() else "-" for ch in bvid).strip("-") or "unknown"
        return f"video-analysis/asr-audio/{safe_bvid}/{cid}-{int(time.time())}{extension}"


def _normalize_content_type(value: str | None) -> str:
    if not value:
        return "audio/mp4"

    return value.split(";", 1)[0].strip() or "audio/mp4"


def _extension_for_content_type(content_type: str) -> str:
    mapping = {
        "audio/mp4": ".m4a",
        "audio/mpeg": ".mp3",
        "audio/aac": ".aac",
        "audio/wav": ".wav",
        "audio/x-wav": ".wav",
        "audio/webm": ".webm",
    }
    return mapping.get(content_type.lower(), ".m4a")


def _extension_from_url(audio_url: str) -> str:
    suffix = Path(urlparse(audio_url).path).suffix.lower()
    return suffix if suffix in {".m4a", ".mp3", ".aac", ".wav", ".webm", ".mp4"} else ""


def _build_public_object_url(public_base_url: str, bucket: str, object_key: str) -> str:
    base = public_base_url.rstrip("/")
    encoded_key = quote(object_key.lstrip("/"), safe="/")
    return f"{base}/{bucket}/{encoded_key}"
