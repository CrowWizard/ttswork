from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any


def init_logger(log_file_path: Path, log_level: str) -> logging.Logger:
    log_file_path.parent.mkdir(parents=True, exist_ok=True)

    logger = logging.getLogger("video-analysis-worker")
    logger.handlers.clear()
    logger.setLevel(_normalize_log_level(log_level))
    logger.propagate = False

    formatter = JsonFormatter()

    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(formatter)
    logger.addHandler(stream_handler)

    file_handler = logging.FileHandler(log_file_path, encoding="utf-8")
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    return logger


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname.lower(),
            "event": getattr(record, "event", record.getMessage()),
        }

        context = getattr(record, "context", None)
        if isinstance(context, dict):
            payload.update(_safe_serialize(context))

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)

        return json.dumps(payload, ensure_ascii=False)


def log_event(logger: logging.Logger, level: str, event: str, **context: Any) -> None:
    logger.log(
        _normalize_log_level(level),
        event,
        extra={"event": event, "context": context},
    )


def _safe_serialize(value: Any) -> Any:
    if isinstance(value, Exception):
        return {
            "errorName": value.__class__.__name__,
            "errorMessage": str(value),
        }

    if isinstance(value, dict):
        return {key: _safe_serialize(item) for key, item in value.items()}

    if isinstance(value, (list, tuple)):
        return [_safe_serialize(item) for item in value]

    return value


def _normalize_log_level(level: str) -> int:
    return getattr(logging, str(level).upper(), logging.INFO)
