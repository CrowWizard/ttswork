from __future__ import annotations

import json
import logging
import time
from typing import Any
from urllib import request

import requests as http_requests

from config import WorkerConfig

logger = logging.getLogger(__name__)

_DASHSCOPE_TRANSCRIPTION_URL = "https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription"
_DASHSCOPE_TASK_URL = "https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}"


class AsrService:
    def __init__(self, config: WorkerConfig):
        self._config = config
        self._session = http_requests.Session()

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

        if not self._config.dashscope_api_key:
            raise RuntimeError("未配置 DASHSCOPE_API_KEY，无法处理无字幕视频")

        model = self._config.dashscope_asr_model or "qwen3-asr-flash-filetrans"
        api_key = self._config.dashscope_api_key

        logger.info("dashscope.asr 提交转写任务: bvid=%s, model=%s", bvid, model)
        task_id = self._submit_task(api_key, model, audio_url)
        logger.info("dashscope.asr 任务已提交: task_id=%s, 开始等待完成", task_id)

        timeout = self._config.dashscope_asr_timeout or 300
        transcription_url = self._poll_task(api_key, task_id, timeout)

        logger.info("dashscope.asr 转写完成，下载结果: %s", transcription_url[:80])
        transcription_data = self._download_transcription(transcription_url)
        text = self._extract_text(transcription_data, bvid)

        logger.info("dashscope.asr 转写文本长度: %d 字符", len(text))
        return text

    def _submit_task(self, api_key: str, model: str, audio_url: str) -> str:
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "X-DashScope-Async": "enable",
        }
        payload = {
            "model": model,
            "input": {"file_url": audio_url},
            "parameters": {"channel_id": [0], "enable_itn": False},
        }

        resp = self._session.post(
            _DASHSCOPE_TRANSCRIPTION_URL,
            headers=headers,
            data=json.dumps(payload),
            timeout=30,
        )

        if resp.status_code != 200:
            raise RuntimeError(
                f"DashScope ASR 任务提交失败: HTTP {resp.status_code}, body={resp.text[:200]}"
            )

        body = resp.json()
        task_id = (body.get("output") or {}).get("task_id")
        if not task_id:
            raise RuntimeError(f"DashScope ASR 任务提交返回缺少 task_id: {json.dumps(body, ensure_ascii=False)[:200]}")

        return task_id

    def _poll_task(self, api_key: str, task_id: str, timeout_seconds: int) -> str:
        headers = {
            "Authorization": f"Bearer {api_key}",
            "X-DashScope-Async": "enable",
            "Content-Type": "application/json",
        }
        url = _DASHSCOPE_TASK_URL.format(task_id=task_id)
        deadline = time.monotonic() + timeout_seconds
        poll_interval = 5

        while time.monotonic() < deadline:
            resp = self._session.get(url, headers=headers, timeout=30)
            if resp.status_code != 200:
                raise RuntimeError(
                    f"DashScope ASR 任务查询失败: HTTP {resp.status_code}, task_id={task_id}"
                )

            body = resp.json()
            output = body.get("output") or {}
            task_status = output.get("task_status", "UNKNOWN")

            if task_status == "SUCCEEDED":
                result = output.get("result") or {}
                transcription_url = result.get("transcription_url")
                if not transcription_url:
                    raise RuntimeError(f"DashScope ASR 转写成功但缺少 transcription_url: task_id={task_id}")
                return transcription_url

            if task_status == "FAILED":
                code = output.get("code", "UNKNOWN")
                message = output.get("message", "")
                raise RuntimeError(
                    f"DashScope ASR 转写失败: code={code}, message={message}, task_id={task_id}"
                )

            logger.debug("dashscope.asr 轮询: task_id=%s, status=%s", task_id, task_status)
            time.sleep(poll_interval)

        raise RuntimeError(f"DashScope ASR 转写超时 ({timeout_seconds}s): task_id={task_id}")

    def _download_transcription(self, url: str) -> dict[str, Any]:
        try:
            with request.urlopen(url, timeout=60) as resp:
                raw = resp.read().decode("utf-8")
            return json.loads(raw)
        except Exception as exc:
            raise RuntimeError(f"DashScope ASR 转写结果下载失败: {exc}") from exc

    def _extract_text(self, data: dict[str, Any], bvid: str) -> str:
        transcripts = data.get("transcripts") or []
        if not transcripts:
            raise RuntimeError(f"DashScope ASR 转写 JSON 缺少 transcripts: bvid={bvid}")

        parts: list[str] = []
        for transcript in transcripts:
            text = str(transcript.get("text") or "").strip()
            if text:
                parts.append(text)

            sentences = transcript.get("sentences") or []
            for sentence in sentences:
                sentence_text = str(sentence.get("text") or "").strip()
                if sentence_text and sentence_text != text:
                    parts.append(sentence_text)

        if not parts:
            raise RuntimeError(f"DashScope ASR 转写文本为空: bvid={bvid}")

        return "\n".join(parts)

    def _build_mock_transcript(self, bvid: str, title: str, duration_seconds: float | None) -> str:
        duration_text = f"约 {int(duration_seconds)} 秒" if duration_seconds else "时长未知"
        return (
            f"这是一段基于音频兜底生成的模拟转写。视频标题是《{title}》，BV 号为 {bvid}，{duration_text}。\n"
            "讲解通常先抛出主题，再给出关键步骤、案例和注意事项。\n"
            "由于当前处于 mock 模式，这里的转写文本用于验证无字幕走 ASR 的任务链路与结构化分析回写。"
        )
