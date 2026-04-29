from __future__ import annotations

from typing import Any

import requests

from config import WorkerConfig


class AsrService:
    def __init__(self, config: WorkerConfig):
        self._config = config
        self._session = requests.Session()

    def transcribe(
        self,
        *,
        bvid: str,
        title: str,
        audio_url: str,
        duration_seconds: float | None,
    ) -> str:
        if self._config.qwen_mock_mode:
            return self._build_mock_transcript(bvid, title, duration_seconds)

        if not self._config.video_analysis_asr_url:
            raise RuntimeError("未配置 VIDEO_ANALYSIS_ASR_URL，无法处理无字幕视频")

        payload = {
            "audioUrl": audio_url,
            "bvid": bvid,
            "title": title,
            "durationSeconds": duration_seconds,
            "model": self._config.video_analysis_asr_model or None,
        }
        response = self._session.post(
            self._config.video_analysis_asr_url,
            json=payload,
            timeout=self._config.http_timeout_seconds,
        )
        response.raise_for_status()
        body = response.json()

        for key in ("text", "transcript"):
            value = body.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()

        result = body.get("result")
        if isinstance(result, dict):
            text = result.get("text") or result.get("transcript")
            if isinstance(text, str) and text.strip():
                return text.strip()

        raise RuntimeError("ASR 服务返回缺少 text/transcript 字段")

    def _build_mock_transcript(self, bvid: str, title: str, duration_seconds: float | None) -> str:
        duration_text = f"约 {int(duration_seconds)} 秒" if duration_seconds else "时长未知"
        return (
            f"这是一段基于音频兜底生成的模拟转写。视频标题是《{title}》，BV 号为 {bvid}，{duration_text}。\n"
            "讲解通常先抛出主题，再给出关键步骤、案例和注意事项。\n"
            "由于当前处于 mock 模式，这里的转写文本用于验证无字幕走 ASR 的任务链路与结构化分析回写。"
        )
