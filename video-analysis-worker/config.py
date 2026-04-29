from __future__ import annotations

import os
import socket
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from dotenv import dotenv_values
import yaml

WORKER_DIR = Path(__file__).resolve().parent
ROOT_DIR = WORKER_DIR.parent


@dataclass(slots=True)
class WorkerConfig:
    db_host: str
    db_port: int
    db_name: str
    db_user: str
    db_password: str
    db_schema: str
    log_level: str
    log_dir: str
    worker_id: str
    poll_interval_seconds: int
    http_timeout_seconds: int
    qwen_mock_mode: bool
    qwen_api_key: str
    bilibili_cookie: str
    bilibili_user_agent: str
    video_analysis_asr_url: str
    video_analysis_asr_model: str
    video_analysis_llm_url: str
    video_analysis_llm_model: str
    loaded_env_paths: list[str]
    config_file_path: str | None

    @property
    def database_dsn(self) -> str:
        user = _encode_dsn_part(self.db_user)
        password = _encode_dsn_part(self.db_password)
        return (
            f"postgresql://{user}:{password}@{self.db_host}:{self.db_port}/"
            f"{self.db_name}?options=-csearch_path%3D{self.db_schema}"
        )

    @property
    def log_file_path(self) -> Path:
        return Path(self.log_dir) / "video-analysis-worker.log"


def load_config() -> WorkerConfig:
    env_values, loaded_env_paths = _load_env_values()
    file_config, config_file_path = _read_config_file()

    db_config = _as_dict(file_config.get("database"))
    server_config = _as_dict(file_config.get("server"))
    qwen_config = _as_dict(file_config.get("qwen"))
    database_url_config = _parse_database_url(_env_string("DATABASE_URL", env_values, ""))

    hostname = socket.gethostname()
    return WorkerConfig(
        db_host=_env_string(
            "DB_HOST",
            env_values,
            database_url_config.get("host") or db_config.get("host", "127.0.0.1"),
        ),
        db_port=_env_int(
            "DB_PORT",
            env_values,
            database_url_config.get("port") or db_config.get("port", 5432),
        ),
        db_name=_env_string(
            "DB_NAME",
            env_values,
            database_url_config.get("name") or db_config.get("name", "voice_mvp"),
        ),
        db_user=_env_string(
            "DB_USER",
            env_values,
            database_url_config.get("user") or db_config.get("user", "voice_mvp"),
        ),
        db_password=_env_string(
            "DB_PASSWORD",
            env_values,
            database_url_config.get("password") or db_config.get("password", "your_password"),
        ),
        db_schema=_env_string(
            "DB_SCHEMA",
            env_values,
            database_url_config.get("schema") or db_config.get("schema", "public"),
        ),
        log_level=_env_string("LOG_LEVEL", env_values, server_config.get("logLevel", "info")).lower(),
        log_dir=_env_string("LOG_DIR", env_values, server_config.get("logDir", str(ROOT_DIR / "logs"))),
        worker_id=_env_string(
            "VIDEO_ANALYSIS_WORKER_ID",
            env_values,
            f"video-analysis-worker-{hostname}",
        ),
        poll_interval_seconds=_env_int("VIDEO_ANALYSIS_POLL_INTERVAL_SECONDS", env_values, 5),
        http_timeout_seconds=_env_int("VIDEO_ANALYSIS_HTTP_TIMEOUT_SECONDS", env_values, 20),
        qwen_mock_mode=_env_bool("QWEN_MOCK_MODE", env_values, qwen_config.get("mockMode", True)),
        qwen_api_key=_env_string("QWEN_API_KEY", env_values, qwen_config.get("apiKey", "")),
        bilibili_cookie=_env_string("BILIBILI_COOKIE", env_values, ""),
        bilibili_user_agent=_env_string(
            "BILIBILI_USER_AGENT",
            env_values,
            (
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"
            ),
        ),
        video_analysis_asr_url=_env_string("VIDEO_ANALYSIS_ASR_URL", env_values, ""),
        video_analysis_asr_model=_env_string("VIDEO_ANALYSIS_ASR_MODEL", env_values, ""),
        video_analysis_llm_url=_env_string(
            "VIDEO_ANALYSIS_LLM_URL",
            env_values,
            "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
        ),
        video_analysis_llm_model=_env_string("VIDEO_ANALYSIS_LLM_MODEL", env_values, "qwen-plus"),
        loaded_env_paths=loaded_env_paths,
        config_file_path=config_file_path,
    )


def _load_env_values() -> tuple[dict[str, str], list[str]]:
    merged: dict[str, str] = {}
    loaded_paths: list[str] = []

    for env_path in (ROOT_DIR / ".env", WORKER_DIR / ".env"):
        if not env_path.is_file():
            continue

        merged.update({key: value for key, value in dotenv_values(env_path).items() if value is not None})
        loaded_paths.append(str(env_path))

    return merged, loaded_paths


def _read_config_file() -> tuple[dict[str, Any], str | None]:
    for path in _config_file_candidates():
        if not path.is_file():
            continue

        with path.open("r", encoding="utf-8") as fh:
            content = yaml.safe_load(fh) or {}

        return _as_dict(content), str(path)

    return {}, None


def _config_file_candidates() -> list[Path]:
    candidates: list[Path] = []
    config_path = os.environ.get("CONFIG_PATH")

    if config_path:
        candidates.append(Path(config_path).expanduser().resolve())

    candidates.extend(
        [
            ROOT_DIR / "config.yaml",
            ROOT_DIR / "config.yml",
            ROOT_DIR / "api-server" / "config.yaml",
            Path("/etc/voice-mvp/config.yaml"),
        ]
    )
    return candidates


def _env_string(key: str, env_values: dict[str, str], fallback: Any) -> str:
    if key in os.environ:
        return os.environ[key]

    if key in env_values:
        return env_values[key]

    return "" if fallback is None else str(fallback)


def _env_int(key: str, env_values: dict[str, str], fallback: Any) -> int:
    raw = _env_string(key, env_values, fallback)
    try:
        return int(raw)
    except (TypeError, ValueError):
        return int(fallback)


def _env_bool(key: str, env_values: dict[str, str], fallback: Any) -> bool:
    raw = _env_string(key, env_values, fallback)
    if isinstance(raw, bool):
        return raw
    return str(raw).lower() in {"1", "true", "yes", "on"}


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _encode_dsn_part(value: str) -> str:
    from urllib.parse import quote

    return quote(value, safe="")


def _parse_database_url(value: str) -> dict[str, Any]:
    if not value:
        return {}

    parsed = urlparse(value)
    if not parsed.scheme or not parsed.hostname:
        return {}

    query = parse_qs(parsed.query)
    schema = query.get("schema", [None])[0]
    return {
        "host": parsed.hostname,
        "port": parsed.port,
        "name": parsed.path.lstrip("/") or None,
        "user": parsed.username,
        "password": parsed.password,
        "schema": schema,
    }
