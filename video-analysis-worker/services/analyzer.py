from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests
from pydantic import BaseModel, Field, ValidationError

from config import WorkerConfig

PROMPT_VERSION = "video-analysis-v1"


class StructureSection(BaseModel):
    title: str = Field(min_length=1)
    startSeconds: int = Field(ge=0)
    endSeconds: int = Field(ge=0)
    summary: str = Field(min_length=1)


class Highlight(BaseModel):
    quote: str = Field(min_length=1)
    reason: str = Field(min_length=1)
    timestampSeconds: int = Field(ge=0)


class CopySuggestion(BaseModel):
    type: str = Field(min_length=1)
    content: str = Field(min_length=1)


class AnalysisResult(BaseModel):
    summary: str = Field(min_length=1)
    structureSections: list[StructureSection]
    highlights: list[Highlight]
    copySuggestions: list[CopySuggestion]


@dataclass(slots=True)
class AnalysisOutput:
    summary: str
    structure_sections: list[dict[str, Any]]
    highlights: list[dict[str, Any]]
    copy_suggestions: list[dict[str, Any]]
    model_name: str
    prompt_version: str = PROMPT_VERSION


class AnalyzerService:
    def __init__(self, config: WorkerConfig, prompt_path: Path):
        self._config = config
        self._session = requests.Session()
        self._prompt_template = prompt_path.read_text(encoding="utf-8")

    def analyze(self, *, title: str, transcript_text: str, duration_seconds: float | None) -> AnalysisOutput:
        if self._config.qwen_mock_mode:
            result = self._build_mock_result(title, transcript_text, duration_seconds)
            return self._to_output(result, "mock-video-analysis")

        if not self._config.qwen_api_key:
            raise RuntimeError("未配置 QWEN_API_KEY，无法执行视频结构化分析")

        prompt = self._build_prompt(title, transcript_text, duration_seconds)
        payload = {
            "model": self._config.video_analysis_llm_model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
        }
        response = self._session.post(
            self._config.video_analysis_llm_url,
            headers={
                "Authorization": f"Bearer {self._config.qwen_api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=self._config.http_timeout_seconds,
        )
        response.raise_for_status()
        body = response.json()
        content = _extract_message_content(body)
        parsed = self._parse_result(content)
        return self._to_output(parsed, self._config.video_analysis_llm_model)

    def _build_prompt(self, title: str, transcript_text: str, duration_seconds: float | None) -> str:
        duration_text = str(int(duration_seconds)) if duration_seconds else "unknown"
        transcript = transcript_text.strip()
        return self._prompt_template.format(
            title=title,
            duration_seconds=duration_text,
            transcript_text=transcript[:20000],
        )

    def _parse_result(self, raw_text: str) -> AnalysisResult:
        normalized_text = _strip_json_fence(raw_text)
        try:
            payload = json.loads(normalized_text)
        except json.JSONDecodeError as exc:
            raise RuntimeError("分析结果格式不合法") from exc

        try:
            return AnalysisResult.model_validate(payload)
        except ValidationError as exc:
            raise RuntimeError("分析结果格式不合法") from exc

    def _build_mock_result(
        self,
        title: str,
        transcript_text: str,
        duration_seconds: float | None,
    ) -> AnalysisResult:
        sentences = _split_sentences(transcript_text)
        if not sentences:
            sentences = [transcript_text.strip() or title]

        total_duration = max(int(duration_seconds or 180), 60)
        section_count = min(3, max(1, len(sentences)))
        step = max(total_duration // section_count, 1)

        sections: list[StructureSection] = []
        for index in range(section_count):
            sentence = sentences[min(index, len(sentences) - 1)]
            start_seconds = index * step
            end_seconds = total_duration if index == section_count - 1 else min((index + 1) * step, total_duration)
            sections.append(
                StructureSection(
                    title=f"第 {index + 1} 段要点",
                    startSeconds=start_seconds,
                    endSeconds=end_seconds,
                    summary=sentence,
                )
            )

        highlights = [
            Highlight(
                quote=sentence,
                reason="这句话概括了该段的核心信息，适合直接做内容摘录。",
                timestampSeconds=min(index * step, total_duration),
            )
            for index, sentence in enumerate(sentences[:3])
        ]
        copy_suggestions = [
            CopySuggestion(type="title", content=f"{title}：3 个重点快速看懂"),
            CopySuggestion(type="opening", content=f"先用一句话说明《{title}》最值得看的原因，再抛出结论。"),
            CopySuggestion(type="description", content="正文先给总结，再按章节展开关键观点与可执行建议。"),
        ]
        summary = " ".join(sentences[:2]).strip()[:280]

        return AnalysisResult(
            summary=summary or f"《{title}》围绕核心主题展开说明，并提供了可复用的结构化要点。",
            structureSections=sections,
            highlights=highlights,
            copySuggestions=copy_suggestions,
        )

    def _to_output(self, result: AnalysisResult, model_name: str) -> AnalysisOutput:
        return AnalysisOutput(
            summary=result.summary,
            structure_sections=[item.model_dump() for item in result.structureSections],
            highlights=[item.model_dump() for item in result.highlights],
            copy_suggestions=[item.model_dump() for item in result.copySuggestions],
            model_name=model_name,
        )


def _extract_message_content(body: dict[str, Any]) -> str:
    choices = body.get("choices") or []
    if not choices:
        raise RuntimeError("分析模型返回缺少 choices")

    message = choices[0].get("message") or {}
    content = message.get("content")
    if isinstance(content, str) and content.strip():
        return content

    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict) and isinstance(item.get("text"), str):
                parts.append(item["text"])
        joined = "\n".join(part for part in parts if part.strip()).strip()
        if joined:
            return joined

    raise RuntimeError("分析模型返回缺少文本内容")


def _strip_json_fence(raw_text: str) -> str:
    text = raw_text.strip()
    match = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", text, flags=re.DOTALL)
    return match.group(1).strip() if match else text


def _split_sentences(text: str) -> list[str]:
    fragments = re.split(r"[。！？!?\n]+", text)
    return [fragment.strip() for fragment in fragments if fragment.strip()]
