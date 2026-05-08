from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Optional, TypeVar

import requests
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from config import WorkerConfig

PROMPT_VERSION = "video-analysis-v3"
MAX_SUBTITLE_CHARS = 6000
TRANSCRIPT_PROMPT_LIMIT = 8000

HOOK_TYPE_ALIASES = {
    "数据对比": "数据冲击",
    "内容预告": "直给结论",
    "结论直给": "直给结论",
    "痛点追问": "痛点提问",
    "反常识": "反常理",
}

SEGMENT_FUNCTION_ALIASES = {
    "反常识揭秘": "认知冲突",
    "历史对比": "认知冲突",
    "风险预警": "情绪转折",
    "多结局推演": "悬念预告",
    "利益预告": "利益强化",
}

VIRAL_REASON_ALIASES = {
    "颠覆认知": "结论颠覆",
    "认知颠覆": "结论颠覆",
    "情绪共振": "情绪共鸣",
    "干货总结": "实用干货",
}

SHARE_SCENARIO_ALIASES = {
    "财经社群讨论": "评论区引用",
    "朋友圈/房产群转发": "朋友圈截图",
    "社群转发": "朋友圈截图",
    "收藏复盘": "收藏备用",
}

TITLE_FORMULA_ALIASES = {
    "数字冲击式": "数字式",
    "身份代入式": "悬念式",
    "身份共鸣式": "悬念式",
}

RHETORICAL_DEVICE_ALIASES = {
    "数字对比": "权威背书",
    "身份代入": "社交认同",
    "风险提醒": "损失厌恶",
}

TONE_TAG_ALIASES = {
    "硬核": "专业",
    "警示": "犀利",
    "理性": "权威",
}

INTERACTION_TYPE_ALIASES = {
    "悬念引导": "弹幕提问",
    "下期预告": "转发金句",
    "争议引导": "评论争议",
}

PLACEMENT_STRATEGY_ALIASES = {
    "标题/封面引流": "开头引流",
    "中段留人": "中部留存",
    "结尾收口": "结尾转化",
}


class AnalysisResultFormatError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        step: str,
        schema_name: str,
        raw_preview: str,
        response_length: int,
        validation_errors: list[dict[str, Any]] | None = None,
    ):
        super().__init__(message)
        self.step = step
        self.schema_name = schema_name
        self.raw_preview = raw_preview
        self.response_length = response_length
        self.validation_errors = validation_errors or []


TimeStr = str
T = TypeVar("T", bound=BaseModel)


class TimestampRange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start: TimeStr
    end: TimeStr

    @field_validator("start", "end")
    @classmethod
    def validate_time_format(cls, value: str) -> str:
        parts = value.split(":")
        if len(parts) not in [2, 3] or any(not part.isdigit() for part in parts):
            raise ValueError("invalid time format")

        return value


class Paragraph(BaseModel):
    model_config = ConfigDict(extra="forbid")

    time_range: TimestampRange
    summary: str = Field(min_length=1, max_length=200)
    key_sentences: list[str] = Field(default_factory=list, max_length=3)
    hook_candidate: bool = False


class ParagraphsWrapper(BaseModel):
    model_config = ConfigDict(extra="forbid")

    paragraphs: list[Paragraph]


class VideoHealthCard(BaseModel):
    model_config = ConfigDict(extra="forbid")

    one_line_summary: str = Field(min_length=1, max_length=50)
    core_keywords: list[str] = Field(max_length=3)
    has_hook: bool
    has_cta: bool
    hook_and_cta_quotes: list[str] = Field(default_factory=list)


class PackagingAnalysis(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title_formulas: list[str]
    title_hook_words: list[str] = Field(default_factory=list)
    primary_psychology: str = Field(min_length=1)
    secondary_psychology: Optional[str] = None
    keywords: list[str] = Field(default_factory=list)
    keyword_density: str = Field(min_length=1)
    seo_friendly: bool
    cover_text: Optional[str] = None
    cover_relation: str = Field(min_length=1)
    visual_emotion: str = Field(min_length=1)
    color_scheme: Optional[list[str]] = None
    typography_emotion: Optional[str] = None


class HookDetail(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str
    time: TimeStr
    type: Literal["直给结论", "痛点提问", "反常理", "展示后果", "展示高光片段", "昂贵设备", "数据冲击", "身份认同"]
    mechanism: str
    hook_score: int = Field(ge=1, le=10)


class SegmentHook(BaseModel):
    model_config = ConfigDict(extra="forbid")

    time: TimeStr
    text: str
    function: Literal["悬念预告", "认知冲突", "利益强化", "情绪转折", "互动引导"]
    next_segment_hint: Optional[str] = None
    hook_score: int = Field(ge=1, le=10)


class ViralQuote(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(max_length=20)
    time: TimeStr
    viral_reason: Literal["结论颠覆", "情绪共鸣", "金句格式", "圈层黑话", "实用干货", "反常识"]
    screenshot_friendly: bool
    share_scenario: Literal["评论区引用", "朋友圈截图", "弹幕刷屏", "收藏备用"]


class CTADetail(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str
    time: TimeStr
    cta_type: str = Field(min_length=1)
    target_audience: Optional[str] = None
    optimization_hint: Optional[str] = None


class StructuralBlocksOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    hook: Optional[str] = None
    promise: Optional[str] = None
    meat: list[str] = Field(default_factory=list)
    re_hook: Optional[str] = None
    cta: Optional[str] = None


class StructureExtract(BaseModel):
    model_config = ConfigDict(extra="forbid")

    visual_hook: Optional[HookDetail] = None
    promise_hook: Optional[HookDetail] = None
    segment_hooks: list[SegmentHook] = Field(default_factory=list)
    narrative_arc: list[dict[str, str]] = Field(default_factory=list)
    narrative_curve_text: Optional[str] = None
    structural_blocks: StructuralBlocksOutput = Field(default_factory=StructuralBlocksOutput)
    quotes: list[ViralQuote] = Field(default_factory=list)
    cta: Optional[CTADetail] = None
    logic_flow: str = Field(min_length=1)


class RhetoricalDevice(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: str = Field(min_length=1)
    text_snippet: str
    time_range: TimestampRange
    mechanism: str


class KnowledgePoint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    time_range: TimestampRange
    density: int = Field(ge=1, le=5)
    topic: str
    term_count: int = 0


class InteractionDesign(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: str = Field(min_length=1)
    trigger_text: str
    time: TimeStr
    expected_response: str
    placement_strategy: str = Field(min_length=1)


class SemanticAnalysis(BaseModel):
    model_config = ConfigDict(extra="forbid")

    psychological_triggers: list[str]
    rhetorical_devices: list[RhetoricalDevice] = Field(default_factory=list)
    tone_tags: list[str]
    net_slang: list[str] = Field(default_factory=list)
    persona_catchphrases: list[str] = Field(default_factory=list)
    interaction_designs: list[InteractionDesign] = Field(default_factory=list)
    knowledge_density_curve: list[KnowledgePoint] = Field(default_factory=list)
    cognitive_load: str = Field(min_length=1)
    overload_warnings: list[str] = Field(default_factory=list)
    emotion_curve: list[dict[str, str]] = Field(default_factory=list)


class CreatorFix(BaseModel):
    model_config = ConfigDict(extra="forbid")

    priority: str = ""
    problem: str = ""
    reason: str = ""
    rewrite: str = ""


class CreatorActionPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    keep_points: list[str] = Field(default_factory=list)
    priority_fixes: list[CreatorFix] = Field(default_factory=list)
    title_rewrites: list[str] = Field(default_factory=list)
    opening_rewrites: list[str] = Field(default_factory=list)
    cta_rewrites: list[str] = Field(default_factory=list)
    overload_rewrites: list[str] = Field(default_factory=list)
    reuse_template: list[str] = Field(default_factory=list)


class MetadataJSON(BaseModel):
    model_config = ConfigDict(extra="forbid")

    video_duration: Optional[str] = None
    narrative_arc: list[dict[str, str]] = Field(default_factory=list)
    narrative_curve_text: Optional[str] = None
    structural_blocks: StructuralBlocksOutput = Field(default_factory=StructuralBlocksOutput)
    hook_score: Optional[int] = Field(default=None, ge=0, le=10)
    retention_risk_points: list[str] = Field(default_factory=list)
    golden_quote_count: Optional[int] = None
    interaction_count: Optional[int] = None
    cognitive_load_distribution: dict[str, int] = Field(default_factory=dict)
    creator_action_plan: Optional[CreatorActionPlan] = None


class Step2Output(BaseModel):
    model_config = ConfigDict(extra="forbid")

    packaging: PackagingAnalysis
    semantic: SemanticAnalysis


class Internalization(BaseModel):
    model_config = ConfigDict(extra="forbid")

    core_message: str = Field(min_length=1, max_length=20)
    clever_design: str = Field(min_length=1)
    optimization: str = Field(min_length=1)


class FinalReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    health_card: VideoHealthCard
    packaging: PackagingAnalysis
    script_layer: StructureExtract
    semantic_layer: SemanticAnalysis
    summary: Internalization
    metadata_json: MetadataJSON


class StructureSection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1)
    startSeconds: int = Field(ge=0)
    endSeconds: int = Field(ge=0)
    summary: str = Field(min_length=1)

    @model_validator(mode="after")
    def validate_time_range(self) -> "StructureSection":
        if self.endSeconds < self.startSeconds:
            raise ValueError("endSeconds must be greater than or equal to startSeconds")

        return self


class Highlight(BaseModel):
    model_config = ConfigDict(extra="forbid")

    quote: str = Field(min_length=1)
    reason: str = Field(min_length=1)
    timestampSeconds: int = Field(ge=0)


class CopySuggestion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: str = Field(min_length=1)
    content: str = Field(min_length=1)


@dataclass
class AnalysisOutput:
    summary: str
    structure_sections: list[dict[str, Any]]
    highlights: list[dict[str, Any]]
    copy_suggestions: list[dict[str, Any]]
    health_card: dict[str, Any]
    packaging_analysis: dict[str, Any]
    script_analysis: dict[str, Any]
    semantic_analysis: dict[str, Any]
    internalization_summary: dict[str, Any]
    metadata_json: dict[str, Any]
    model_name: str
    prompt_version: str = PROMPT_VERSION


STEP1_EXAMPLE = json.dumps({"visual_hook": {"text": "你是不是一觉得头发油就去疯狂洗头？", "time": "00:00", "type": "痛点提问", "mechanism": "通过提问日常习惯引发好奇", "hook_score": 8}, "promise_hook": {"text": "今天教你三个防脱秘籍", "time": "00:10", "type": "直给结论", "mechanism": "明确告知看完能得到具体方案", "hook_score": 7}, "segment_hooks": [{"time": "00:58", "text": "但这还不是最严重的", "function": "悬念预告", "next_segment_hint": "下一段将揭示更严重的后果", "hook_score": 9}], "narrative_arc": [{"time": "00:00", "event": "冲突引入"}, {"time": "02:00", "event": "解决方案"}], "narrative_curve_text": "00:00 [冲突引入] 原句 -> 02:00 [解决方案] 原句", "structural_blocks": {"hook": "00:00-00:05", "promise": "00:05-00:15", "meat": ["00:15-00:45"], "re_hook": "01:20-01:25", "cta": "02:00-02:10"}, "quotes": [{"text": "别傻了这样只会越洗越掉", "time": "00:05", "viral_reason": "反常识", "screenshot_friendly": True, "share_scenario": "弹幕刷屏"}], "cta": {"text": "点赞收藏明天洗头试试看", "time": "02:00", "cta_type": "组合", "target_audience": "有脱发焦虑的年轻人", "optimization_hint": "建议加入具体预期效果"}, "logic_flow": "问题-解决方案"}, ensure_ascii=False, indent=2)

STEP2_EXAMPLE = json.dumps({"packaging": {"title_formulas": ["悬念式", "反常识式"], "title_hook_words": ["千万别"], "primary_psychology": "焦虑", "secondary_psychology": "好奇", "keywords": ["洗头", "防脱"], "keyword_density": "高", "seo_friendly": True, "cover_text": "发量翻倍", "cover_relation": "互补", "visual_emotion": "焦虑", "color_scheme": ["红", "黄"], "typography_emotion": "冲击"}, "semantic": {"psychological_triggers": ["恐惧诉求"], "rhetorical_devices": [{"type": "恐惧诉求", "text_snippet": "头发会掉光", "time_range": {"start": "00:00", "end": "00:05"}, "mechanism": "通过后果引发焦虑"}], "tone_tags": ["网感", "亲切"], "net_slang": ["别傻了"], "persona_catchphrases": ["99%的人都不知道"], "interaction_designs": [{"type": "弹幕提问", "trigger_text": "你中招了没", "time": "00:05", "expected_response": "刷中招了", "placement_strategy": "中部留存"}], "knowledge_density_curve": [{"time_range": {"start": "00:15", "end": "00:45"}, "density": 4, "topic": "洗发水温", "term_count": 2}], "cognitive_load": "中", "overload_warnings": ["00:45-01:10 术语密集"], "emotion_curve": [{"time": "00:00", "emotion": "紧张"}]}}, ensure_ascii=False, indent=2)

STEP3_EXAMPLE = json.dumps({"health_card": {"one_line_summary": "洗头误区导致脱发, 三招解决", "core_keywords": ["洗头", "防脱", "误区"], "has_hook": True, "has_cta": True, "hook_and_cta_quotes": ["你是不是一觉得头发油就去疯狂洗头？", "点赞收藏明天洗头试试看"]}, "packaging": {}, "script_layer": {}, "semantic_layer": {}, "summary": {"core_message": "正确洗头防脱", "clever_design": "00:05用反常识句式制造焦虑", "optimization": "原句: 别傻了这样只会越洗越掉 -> 新句: 你以为在清洁头皮, 其实在亲手杀死毛囊。理由: 后果更具体"}, "metadata_json": {"retention_risk_points": ["01:00-01:30 连续干货无钩子"], "creator_action_plan": {"keep_points": ["保留反常识开头, 继续用日常误区切入。"], "priority_fixes": [{"priority": "P1", "problem": "开头只提问题, 后果不够具体。", "reason": "观众不知道不改会损失什么, 前 3 秒停留动力不足。", "rewrite": "把原句改成: 你以为洗得越勤越干净, 其实是在让头皮屏障越来越脆。"}, {"priority": "P2", "problem": "中段连续讲 3 个概念。", "reason": "普通观众需要同时记判断标准、原因和做法, 容易暂停退出。", "rewrite": "拆成: 先记一个判断标准 -> 给一个生活例子 -> 再讲下一步。"}, {"priority": "P3", "problem": "结尾 CTA 只说点赞收藏。", "reason": "动作太泛, 观众不知道评论什么或收藏后怎么用。", "rewrite": "改成: 评论区打出你的发质, 我按油头、干头、敏感头继续拆洗法。"}], "title_rewrites": ["别再天天洗头了: 这 3 个动作才是掉发元凶", "头发越洗越油? 先改掉这 3 个洗头误区"], "opening_rewrites": ["前 15 秒: 你是不是头发一油就立刻洗? 先停一下, 真正让你越洗越油的, 不是出油, 而是这 3 个动作。看完你就能按发质改洗法。"], "cta_rewrites": ["如果你不知道自己是哪种发质, 在评论区写油头/干头/敏感头, 我下一条按类型给你拆。"], "overload_rewrites": ["01:00-01:30: 把术语解释拆成三句: 先说判断标准, 再举生活例子, 最后给操作动作。"], "reuse_template": ["标题: 反常识误区 + 明确后果 + 数字步骤", "开头: 先指出观众正在做错的动作, 再给看完收益", "正文: 每段只讲一个误区, 用判断标准 -> 例子 -> 改法推进", "结尾: 引导观众评论自己的具体场景"]}}}, ensure_ascii=False, indent=2)


class AnalyzerService:
    def __init__(self, config: WorkerConfig, prompt_path: Path):
        self._config = config
        self._session = requests.Session()
        self._prompt_template = prompt_path.read_text(encoding="utf-8") if prompt_path.exists() else ""
        self._last_normalization_warnings: list[dict[str, Any]] = []

    @property
    def last_normalization_warnings(self) -> list[dict[str, Any]]:
        return list(self._last_normalization_warnings)

    def analyze(
        self,
        *,
        title: str,
        transcript_text: str,
        duration_seconds: float | None,
        timeline_text: str | None = None,
        cover_url: str | None = None,
        run_step: Any | None = None,
    ) -> AnalysisOutput:
        self._last_normalization_warnings = []
        if self._config.qwen_mock_mode:
            report, paragraphs = self._build_mock_report(title, transcript_text, duration_seconds)
            return self._to_output(report, paragraphs, "mock-video-analysis")

        if not self._config.qwen_api_key:
            raise RuntimeError("未配置 QWEN_API_KEY，无法执行视频结构化分析")

        total_duration = float(duration_seconds or 0)
        full_timeline = (timeline_text or transcript_text).strip()
        paragraphs: list[Paragraph] = []
        text_for_analysis = full_timeline[:20000]
        runner = run_step or (lambda _stage, _message, action, **_context: action())
        if len(full_timeline) > MAX_SUBTITLE_CHARS:
            paragraphs = runner(
                "ANALYSIS_PARAGRAPH_SUMMARY",
                "长字幕压缩分段",
                lambda: self._generate_paragraph_summary(full_timeline),
                transcriptLength=len(full_timeline),
                durationSeconds=total_duration,
            )
            text_for_analysis = self._build_compressed_text(full_timeline, paragraphs, total_duration)

        structure = runner(
            "ANALYSIS_STRUCTURE",
            "提取脚本结构",
            lambda: self._step1_extract_structure(text_for_analysis, total_duration),
            transcriptLength=len(text_for_analysis),
            durationSeconds=total_duration,
        )
        step2 = runner(
            "ANALYSIS_SEMANTIC_PACKAGING",
            "分析包装与语义",
            lambda: self._step2_analyze_semantic_packaging(title, cover_url, text_for_analysis),
            transcriptLength=len(text_for_analysis),
            hasCover=bool(cover_url),
        )
        report = runner(
            "ANALYSIS_FINAL_REPORT",
            "生成最终报告",
            lambda: self._step3_generate_report(title, cover_url, step2.packaging, structure, step2.semantic, total_duration),
            title=title,
            hasCover=bool(cover_url),
        )
        return self._to_output(report, paragraphs, self._config.video_analysis_llm_model)

    def _call_json_model(self, prompt: str, schema: type[T], temperature: float, *, step: str) -> T:
        payload = {
            "model": self._config.video_analysis_llm_model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": temperature,
            "response_format": {"type": "json_object"},
        }
        response = self._session.post(
            self._config.video_analysis_llm_url,
            headers={"Authorization": f"Bearer {self._config.qwen_api_key}", "Content-Type": "application/json"},
            json=payload,
            timeout=self._config.http_timeout_seconds,
        )
        response.raise_for_status()
        content = _extract_message_content(response.json())
        normalized_text = _strip_json_fence(content)
        try:
            raw_payload = json.loads(normalized_text)
            raw_payload = self._normalize_payload_for_schema(schema, raw_payload)
            return schema.model_validate(raw_payload)
        except (json.JSONDecodeError, ValidationError) as exc:
            validation_errors = exc.errors() if isinstance(exc, ValidationError) else []
            raise AnalysisResultFormatError(
                "分析结果格式不合法",
                step=step,
                schema_name=schema.__name__,
                raw_preview=normalized_text[:1200],
                response_length=len(normalized_text),
                validation_errors=validation_errors[:10],
            ) from exc

    def _normalize_payload_for_schema(self, schema: type[T], raw_payload: Any) -> Any:
        if not isinstance(raw_payload, dict):
            return raw_payload

        if schema is ParagraphsWrapper:
            return self._normalize_paragraph_summary_payload(raw_payload)

        if schema is StructureExtract:
            return self._normalize_structure_payload(raw_payload)

        if schema is Step2Output:
            return self._normalize_step2_payload(raw_payload)

        return raw_payload

    def _normalize_paragraph_summary_payload(self, raw_payload: dict[str, Any]) -> dict[str, Any]:
        paragraphs = raw_payload.get("paragraphs")
        if not isinstance(paragraphs, list):
            return raw_payload

        normalized_paragraphs: list[Any] = []
        for index, item in enumerate(paragraphs):
            if not isinstance(item, dict):
                normalized_paragraphs.append(item)
                continue

            normalized_item = dict(item)
            key_sentences = normalized_item.get("key_sentences")
            if isinstance(key_sentences, list) and len(key_sentences) > 3:
                normalized_item["key_sentences"] = key_sentences[:3]
                self._last_normalization_warnings.append(
                    {
                        "step": "ANALYSIS_PARAGRAPH_SUMMARY",
                        "field": "paragraphs.key_sentences",
                        "paragraphIndex": index,
                        "originalLength": len(key_sentences),
                        "trimmedLength": 3,
                        "strategy": "keep_first_3",
                    }
                )

            normalized_paragraphs.append(normalized_item)

        normalized_payload = dict(raw_payload)
        normalized_payload["paragraphs"] = normalized_paragraphs
        return normalized_payload

    def _normalize_structure_payload(self, raw_payload: dict[str, Any]) -> dict[str, Any]:
        normalized_payload = dict(raw_payload)

        for field_name in ["visual_hook", "promise_hook"]:
            hook = normalized_payload.get(field_name)
            if isinstance(hook, dict):
                normalized_payload[field_name] = self._normalize_hook_detail(hook, field_name)

        segment_hooks = normalized_payload.get("segment_hooks")
        if isinstance(segment_hooks, list):
            normalized_payload["segment_hooks"] = [
                self._normalize_segment_hook(item, index) if isinstance(item, dict) else item
                for index, item in enumerate(segment_hooks)
            ]

        quotes = normalized_payload.get("quotes")
        if isinstance(quotes, list):
            normalized_payload["quotes"] = [
                self._normalize_quote(item, index) if isinstance(item, dict) else item
                for index, item in enumerate(quotes)
            ]

        return normalized_payload

    def _normalize_step2_payload(self, raw_payload: dict[str, Any]) -> dict[str, Any]:
        normalized_payload = dict(raw_payload)

        packaging = normalized_payload.get("packaging")
        if isinstance(packaging, dict):
            normalized_payload["packaging"] = self._normalize_packaging_payload(packaging)

        semantic = normalized_payload.get("semantic")
        if isinstance(semantic, dict):
            normalized_payload["semantic"] = self._normalize_semantic_payload(semantic)

        return normalized_payload

    def _normalize_packaging_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        normalized = dict(payload)

        title_formulas = normalized.get("title_formulas")
        if isinstance(title_formulas, list):
            normalized["title_formulas"] = [
                self._map_alias(
                    step="ANALYSIS_SEMANTIC_PACKAGING",
                    field=f"packaging.title_formulas[{index}]",
                    value=item,
                    aliases=TITLE_FORMULA_ALIASES,
                )
                for index, item in enumerate(title_formulas)
            ]

        return normalized

    def _normalize_semantic_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        normalized = dict(payload)

        rhetorical_devices = normalized.get("rhetorical_devices")
        if isinstance(rhetorical_devices, list):
            normalized["rhetorical_devices"] = [
                self._normalize_rhetorical_device(item, index) if isinstance(item, dict) else item
                for index, item in enumerate(rhetorical_devices)
            ]

        tone_tags = normalized.get("tone_tags")
        if isinstance(tone_tags, list):
            normalized["tone_tags"] = [
                self._map_alias(
                    step="ANALYSIS_SEMANTIC_PACKAGING",
                    field=f"semantic.tone_tags[{index}]",
                    value=item,
                    aliases=TONE_TAG_ALIASES,
                )
                for index, item in enumerate(tone_tags)
            ]

        interaction_designs = normalized.get("interaction_designs")
        if isinstance(interaction_designs, list):
            normalized["interaction_designs"] = [
                self._normalize_interaction_design(item, index) if isinstance(item, dict) else item
                for index, item in enumerate(interaction_designs)
            ]

        return normalized

    def _normalize_rhetorical_device(self, payload: dict[str, Any], index: int) -> dict[str, Any]:
        normalized = dict(payload)
        normalized["type"] = self._map_alias(
            step="ANALYSIS_SEMANTIC_PACKAGING",
            field=f"semantic.rhetorical_devices[{index}].type",
            value=normalized.get("type"),
            aliases=RHETORICAL_DEVICE_ALIASES,
        )
        return normalized

    def _normalize_interaction_design(self, payload: dict[str, Any], index: int) -> dict[str, Any]:
        normalized = dict(payload)
        normalized["type"] = self._map_alias(
            step="ANALYSIS_SEMANTIC_PACKAGING",
            field=f"semantic.interaction_designs[{index}].type",
            value=normalized.get("type"),
            aliases=INTERACTION_TYPE_ALIASES,
        )
        normalized["placement_strategy"] = self._map_alias(
            step="ANALYSIS_SEMANTIC_PACKAGING",
            field=f"semantic.interaction_designs[{index}].placement_strategy",
            value=normalized.get("placement_strategy"),
            aliases=PLACEMENT_STRATEGY_ALIASES,
        )
        return normalized

    def _map_alias(self, *, step: str, field: str, value: Any, aliases: dict[str, str]) -> Any:
        if not isinstance(value, str) or value not in aliases:
            return value

        mapped = aliases[value]
        self._last_normalization_warnings.append(
            {
                "step": step,
                "field": field,
                "originalValue": value,
                "normalizedValue": mapped,
                "strategy": "alias_map",
            }
        )
        return mapped

    def _normalize_hook_detail(self, payload: dict[str, Any], field_name: str) -> dict[str, Any]:
        normalized = dict(payload)
        hook_type = normalized.get("type")
        if isinstance(hook_type, str) and hook_type in HOOK_TYPE_ALIASES:
            mapped = HOOK_TYPE_ALIASES[hook_type]
            normalized["type"] = mapped
            self._last_normalization_warnings.append(
                {
                    "step": "ANALYSIS_STRUCTURE",
                    "field": f"{field_name}.type",
                    "originalValue": hook_type,
                    "normalizedValue": mapped,
                    "strategy": "alias_map",
                }
            )

        return normalized

    def _normalize_segment_hook(self, payload: dict[str, Any], index: int) -> dict[str, Any]:
        normalized = dict(payload)
        function_value = normalized.get("function")
        if isinstance(function_value, str) and function_value in SEGMENT_FUNCTION_ALIASES:
            mapped = SEGMENT_FUNCTION_ALIASES[function_value]
            normalized["function"] = mapped
            self._last_normalization_warnings.append(
                {
                    "step": "ANALYSIS_STRUCTURE",
                    "field": f"segment_hooks[{index}].function",
                    "originalValue": function_value,
                    "normalizedValue": mapped,
                    "strategy": "alias_map",
                }
            )

        return normalized

    def _normalize_quote(self, payload: dict[str, Any], index: int) -> dict[str, Any]:
        normalized = dict(payload)

        viral_reason = normalized.get("viral_reason")
        if isinstance(viral_reason, str) and viral_reason in VIRAL_REASON_ALIASES:
            mapped_reason = VIRAL_REASON_ALIASES[viral_reason]
            normalized["viral_reason"] = mapped_reason
            self._last_normalization_warnings.append(
                {
                    "step": "ANALYSIS_STRUCTURE",
                    "field": f"quotes[{index}].viral_reason",
                    "originalValue": viral_reason,
                    "normalizedValue": mapped_reason,
                    "strategy": "alias_map",
                }
            )

        share_scenario = normalized.get("share_scenario")
        if isinstance(share_scenario, str) and share_scenario in SHARE_SCENARIO_ALIASES:
            mapped_scenario = SHARE_SCENARIO_ALIASES[share_scenario]
            normalized["share_scenario"] = mapped_scenario
            self._last_normalization_warnings.append(
                {
                    "step": "ANALYSIS_STRUCTURE",
                    "field": f"quotes[{index}].share_scenario",
                    "originalValue": share_scenario,
                    "normalizedValue": mapped_scenario,
                    "strategy": "alias_map",
                }
            )

        text = normalized.get("text")
        if isinstance(text, str) and len(text) > 20:
            normalized["text"] = text[:20]
            self._last_normalization_warnings.append(
                {
                    "step": "ANALYSIS_STRUCTURE",
                    "field": f"quotes[{index}].text",
                    "originalLength": len(text),
                    "trimmedLength": 20,
                    "strategy": "truncate_20_chars",
                }
            )

        return normalized

    def _generate_paragraph_summary(self, full_text: str) -> list[Paragraph]:
        example = json.dumps(
            {
                "paragraphs": [
                    {
                        "time_range": {"start": "00:00", "end": "00:58"},
                        "summary": "提出洗头误区并制造焦虑",
                        "key_sentences": ["90%的人都做错了"],
                        "hook_candidate": True,
                    }
                ]
            },
            ensure_ascii=False,
            indent=2,
        )
        prompt = (
            "你是视频内容分析师。将带时间轴的字幕按语义划分段落, 每段必须围绕同一个话题、观点、案例或行动建议; "
            "遇到主题切换、观点转折、案例切换、步骤切换时另起一段, 不要为了凑固定时长而截断语义。\n"
            "硬性约束: `key_sentences` 每段最多 3 条, 超过 3 条时只保留最重要的 3 条。\n"
            f"仅输出合法JSON对象, 严格仿照此结构示例:\n\n{example}\n\n"
            f"【字幕内容】{_truncate_for_prompt(full_text, TRANSCRIPT_PROMPT_LIMIT)}"
        )
        return self._call_json_model(prompt, ParagraphsWrapper, 0.1, step="ANALYSIS_PARAGRAPH_SUMMARY").paragraphs

    def _build_compressed_text(self, full_text: str, paragraphs: list[Paragraph], total_duration: float) -> str:
        head = _slice_timeline(full_text, 0, 30)
        tail = _slice_timeline(full_text, max(0, total_duration - 30), total_duration + 1) if total_duration else ""
        summaries = [
            f"[{item.time_range.start}-{item.time_range.end}] 摘要:{item.summary} | 关键句:{'; '.join(item.key_sentences)}"
            for item in paragraphs
        ]
        return f"{head.strip()}\n\n...(中间段落摘要)...\n" + "\n".join(summaries) + f"\n\n...(结尾)...\n{tail.strip()}"

    def _step1_extract_structure(self, text_for_structure: str, total_duration: float) -> StructureExtract:
        prompt = (
            "你是资深视频结构分析师。从字幕提取结构化信息。\n"
            "仅输出合法JSON对象, 必须严格仿照下方结构示例的字段名和格式。\n\n"
            f"=== 结构示例 ===\n{STEP1_EXAMPLE}\n\n"
            "字段约束: 所有时间戳格式 MM:SS; structural_blocks 的 hook/promise/re_hook/cta 是字符串时间范围; meat 是字符串数组; quotes.text 最多 20 字;\n"
            "hook.type 只能从 [直给结论, 痛点提问, 反常理, 展示后果, 展示高光片段, 昂贵设备, 数据冲击, 身份认同] 中选择;\n"
            "segment_hooks.function 只能从 [悬念预告, 认知冲突, 利益强化, 情绪转折, 互动引导] 中选择;\n"
            "quotes.viral_reason 只能从 [结论颠覆, 情绪共鸣, 金句格式, 圈层黑话, 实用干货, 反常识] 中选择;\n"
            "quotes.share_scenario 只能从 [评论区引用, 朋友圈截图, 弹幕刷屏, 收藏备用] 中选择;\n"
            "cta.cta_type 与 logic_flow 优先参考示例风格，但允许按内容语义自由表达; 禁止输出Markdown。\n\n"
            f"视频时长: {_format_seconds_to_time(total_duration)}\n【字幕】{text_for_structure}"
        )
        return self._call_json_model(prompt, StructureExtract, 0.2, step="ANALYSIS_STRUCTURE")

    def _step2_analyze_semantic_packaging(self, title: str, cover_url: str | None, text_for_semantic: str) -> Step2Output:
        prompt = (
            "你是传播心理学专家。基于视频信息完成包装层+语义层分析。\n"
            f"标题: \"{title}\" | 封面: {cover_url or '未提供'}\n"
            "仅输出合法JSON对象, 必须严格仿照下方结构示例。\n\n"
            f"=== 结构示例 ===\n{STEP2_EXAMPLE}\n\n"
            "字段约束: 所有结论必须尽量引用字幕原句和时间戳;\n"
            "PackagingAnalysis 与 SemanticAnalysis 中的标签字段优先参考示例风格，但允许按内容语义自由表达;\n"
            "布尔、时间范围、数值范围与对象结构必须保持合法; 禁止输出Markdown。\n\n"
            f"【字幕素材】{text_for_semantic}"
        )
        return self._call_json_model(prompt, Step2Output, 0.5, step="ANALYSIS_SEMANTIC_PACKAGING")

    def _step3_generate_report(
        self,
        title: str,
        cover_url: str | None,
        packaging: PackagingAnalysis,
        structure: StructureExtract,
        semantic: SemanticAnalysis,
        total_duration: float,
    ) -> FinalReport:
        prompt = (
            "你是内容架构师。基于已有分析数据, 完成最终报告。\n"
            f"标题: \"{title}\" | 封面: {cover_url or '未提供'}\n"
            "仅输出合法JSON对象, 必须严格仿照下方结构示例。\n\n"
            f"=== 结构示例 ===\n{STEP3_EXAMPLE}\n\n"
            "填写规则: health_card.core_keywords严格3个; summary.core_message尽量不超过15字; packaging/script_layer/semantic_layer直接复制透传数据; "
            "metadata_json.creator_action_plan 必须偏创作动作, 不要只诊断; priority_fixes 至少 3 个, 每个都要包含 problem、reason、rewrite; "
            "必须给出标题改写、开头15秒改写、CTA改写、信息过载片段改写和下一条视频复用模板; 禁止输出Markdown。\n\n"
            "=== 透传数据 ===\n"
            f"packaging: {packaging.model_dump_json(exclude_unset=True)}\n"
            f"script_layer: {structure.model_dump_json(exclude_unset=True)}\n"
            f"semantic_layer: {semantic.model_dump_json(exclude_unset=True)}"
        )
        report = self._call_json_model(prompt, FinalReport, 0.6, step="ANALYSIS_FINAL_REPORT")
        report.packaging = packaging
        report.script_layer = structure
        report.semantic_layer = semantic
        report.metadata_json = _postprocess_metadata(report.metadata_json, structure, semantic, packaging, total_duration)
        return report

    def _build_mock_report(self, title: str, transcript_text: str, duration_seconds: float | None) -> tuple[FinalReport, list[Paragraph]]:
        sentences = _split_sentences(transcript_text) or [title]
        duration = float(duration_seconds or 180)
        structure = StructureExtract(
            visual_hook=HookDetail(text=sentences[0][:40], time="00:00", type="直给结论", mechanism="用开场核心句快速交代主题", hook_score=7),
            promise_hook=None,
            segment_hooks=[],
            narrative_arc=[{"time": "00:00", "event": "主题引入"}, {"time": _format_seconds_to_time(duration), "event": "总结收束"}],
            narrative_curve_text=f"00:00 [主题引入] {sentences[0][:20]} -> {_format_seconds_to_time(duration)} [总结收束]",
            structural_blocks=StructuralBlocksOutput(hook="00:00-00:10", meat=["00:10-01:00"], cta=None),
            quotes=[ViralQuote(text=sentences[0][:20], time="00:00", viral_reason="实用干货", screenshot_friendly=True, share_scenario="收藏备用")],
            cta=None,
            logic_flow="递进式",
        )
        packaging = PackagingAnalysis(title_formulas=["数字式"], title_hook_words=[title[:8]], primary_psychology="好奇", keywords=[title[:12]], keyword_density="中", seo_friendly=True, cover_relation="无关", visual_emotion="专业")
        semantic = SemanticAnalysis(psychological_triggers=["好奇"], tone_tags=["专业"], cognitive_load="中", knowledge_density_curve=[KnowledgePoint(time_range=TimestampRange(start="00:00", end=_format_seconds_to_time(duration)), density=3, topic=title[:20])])
        report = FinalReport(
            health_card=VideoHealthCard(one_line_summary=f"{title[:24]}核心内容", core_keywords=[title[:6] or "视频", "结构", "传播"], has_hook=True, has_cta=False, hook_and_cta_quotes=[sentences[0][:40]]),
            packaging=packaging,
            script_layer=structure,
            semantic_layer=semantic,
            summary=Internalization(core_message=(title[:15] or "视频要点"), clever_design=f"00:00用直接开场降低理解成本: {sentences[0][:30]}", optimization="原句: 开场平铺 -> 新句: 先给反差结论再展开。理由: 更利于前三秒留存"),
            metadata_json=MetadataJSON(retention_risk_points=[]),
        )
        report.metadata_json = _postprocess_metadata(report.metadata_json, structure, semantic, packaging, duration)
        return report, []

    def _to_output(self, report: FinalReport, paragraphs: list[Paragraph], model_name: str) -> AnalysisOutput:
        structure_sections = _derive_structure_sections(paragraphs, report.script_layer)
        highlights = [Highlight(quote=item.text, reason=item.viral_reason, timestampSeconds=_parse_time_to_seconds(item.time)).model_dump() for item in report.script_layer.quotes]
        copy_suggestions = _derive_copy_suggestions(report.packaging, report.summary)
        summary = f"{report.health_card.one_line_summary}。核心信息：{report.summary.core_message}。巧妙设计：{report.summary.clever_design}"
        return AnalysisOutput(
            summary=summary[:500],
            structure_sections=structure_sections,
            highlights=highlights,
            copy_suggestions=copy_suggestions,
            health_card=report.health_card.model_dump(),
            packaging_analysis=report.packaging.model_dump(),
            script_analysis=report.script_layer.model_dump(),
            semantic_analysis=report.semantic_layer.model_dump(),
            internalization_summary=report.summary.model_dump(),
            metadata_json=report.metadata_json.model_dump(),
            model_name=model_name,
        )


def _postprocess_metadata(
    metadata: MetadataJSON,
    structure: StructureExtract,
    semantic: SemanticAnalysis,
    packaging: PackagingAnalysis,
    total_duration: float,
) -> MetadataJSON:
    densities = [item.density for item in semantic.knowledge_density_curve]
    total = len(densities) or 1
    low = len([item for item in densities if item <= 2])
    medium = densities.count(3)
    high = len([item for item in densities if item >= 4])
    metadata.hook_score = min((3 if structure.visual_hook else 0) + (3 if structure.promise_hook else 0) + min(len(structure.segment_hooks), 2) + (2 if structure.cta else 0), 10)
    metadata.golden_quote_count = len(structure.quotes)
    metadata.interaction_count = len(semantic.interaction_designs)
    metadata.video_duration = _format_seconds_to_time(total_duration)
    metadata.narrative_arc = structure.narrative_arc
    metadata.narrative_curve_text = structure.narrative_curve_text
    metadata.structural_blocks = structure.structural_blocks
    metadata.cognitive_load_distribution = {"low": round(low / total * 100), "medium": round(medium / total * 100), "high": round(high / total * 100)}
    metadata.creator_action_plan = _merge_creator_action_plan(metadata.creator_action_plan, structure, semantic, packaging)
    return metadata


def _merge_creator_action_plan(
    plan: CreatorActionPlan | None,
    structure: StructureExtract,
    semantic: SemanticAnalysis,
    packaging: PackagingAnalysis,
) -> CreatorActionPlan:
    fallback = _build_fallback_creator_action_plan(structure, semantic, packaging)
    merged = plan or CreatorActionPlan()
    merged.keep_points = _pick_non_empty(merged.keep_points, fallback.keep_points)
    merged.priority_fixes = _pick_non_empty_fixes(merged.priority_fixes, fallback.priority_fixes)
    merged.title_rewrites = _pick_non_empty(merged.title_rewrites, fallback.title_rewrites)
    merged.opening_rewrites = _pick_non_empty(merged.opening_rewrites, fallback.opening_rewrites)
    merged.cta_rewrites = _pick_non_empty(merged.cta_rewrites, fallback.cta_rewrites)
    merged.overload_rewrites = _pick_non_empty(merged.overload_rewrites, fallback.overload_rewrites)
    merged.reuse_template = _pick_non_empty(merged.reuse_template, fallback.reuse_template)
    return merged


def _build_fallback_creator_action_plan(
    structure: StructureExtract,
    semantic: SemanticAnalysis,
    packaging: PackagingAnalysis,
) -> CreatorActionPlan:
    fixes: list[CreatorFix] = []
    if not structure.visual_hook:
        fixes.append(
            CreatorFix(
                priority="P1",
                problem="开头抓注意力不足",
                reason="观众进入后还不知道为什么要继续看, 前 3 秒容易流失。",
                rewrite="把最强冲突、结果或反常识结论提前到第一句。",
            )
        )

    if not structure.promise_hook:
        fixes.append(
            CreatorFix(
                priority="P2",
                problem="开头 15 秒缺少观看收益",
                reason="观众不容易判断看完能获得什么, 会降低继续观看意愿。",
                rewrite="补一句明确承诺: 看完你可以拿走哪几个判断标准或操作步骤。",
            )
        )

    if semantic.overload_warnings or semantic.cognitive_load in ["高", "中高"]:
        fixes.append(
            CreatorFix(
                priority="P3",
                problem="信息密度偏高",
                reason="连续概念会增加理解负担, 普通观众可能暂停、回看或直接退出。",
                rewrite="把高密度段落拆成判断标准、例子、行动三句话。",
            )
        )

    if not structure.cta:
        fixes.append(
            CreatorFix(
                priority="P3",
                problem="结尾缺少具体行动引导",
                reason="只讲完观点不安排下一步, 评论、收藏和关注转化会变弱。",
                rewrite="用一个低门槛问题收尾, 引导观众评论自己的具体场景。",
            )
        )

    while len(fixes) < 3:
        priority = f"P{len(fixes) + 1}"
        fixes.append(
            CreatorFix(
                priority=priority,
                problem="段落承接可以更明确",
                reason="每段之间如果缺少转折或小结, 观众容易丢失主线。",
                rewrite="在每段结尾补一句: 这一点解决什么问题, 下一段为什么更关键。",
            )
        )

    formulas = " + ".join(packaging.title_formulas[:2]) if packaging.title_formulas else "明确人群 + 明确结果 + 情绪触发"
    primary_psychology = packaging.primary_psychology or "观众最关心的结果"
    first_hook = structure.visual_hook.text if structure.visual_hook else "先别急着照做, 真正影响结果的是接下来这个细节"
    cta_text = structure.cta.text if structure.cta else "把你的具体场景发在评论区, 我按类型继续拆解"
    overload_source = semantic.overload_warnings[0] if semantic.overload_warnings else "信息最密的一段"

    return CreatorActionPlan(
        keep_points=[
            f"保留{primary_psychology}触发, 继续让观众知道这件事和自己有关。",
            f"保留{formulas}的标题方向, 但把结果写得更具体。",
        ],
        priority_fixes=fixes[:3],
        title_rewrites=[
            f"别再忽略这个问题: 用 3 步看懂{primary_psychology}",
            f"真正拉开差距的不是努力, 而是这 3 个判断标准",
        ],
        opening_rewrites=[f"前 15 秒: {first_hook}。看完你能拿走 3 个判断标准, 直接检查自己有没有踩坑。"],
        cta_rewrites=[f"结尾改成: {cta_text}。我会挑 3 个高频场景继续做下一条。"],
        overload_rewrites=[f"{overload_source}: 拆成三句讲, 先给判断标准, 再举一个例子, 最后给观众下一步动作。"],
        reuse_template=[
            f"标题: {formulas} + 明确收益。",
            "开头: 前 3 秒给冲突, 15 秒内说明看完能带走什么。",
            f"正文: 按 {structure.logic_flow or '问题 -> 原因 -> 方法 -> 总结'} 推进, 每段只解决一个问题。",
            "结尾: 用具体问题引导评论, 用步骤价值引导收藏。",
        ],
    )


def _pick_non_empty(primary: list[str], fallback: list[str]) -> list[str]:
    values = [item for item in primary if item.strip()]
    return values or fallback


def _pick_non_empty_fixes(primary: list[CreatorFix], fallback: list[CreatorFix]) -> list[CreatorFix]:
    values = [item for item in primary if item.problem.strip() or item.reason.strip() or item.rewrite.strip()]
    if len(values) >= 3:
        return values[:3]

    return (values + fallback)[:3]


def _derive_structure_sections(paragraphs: list[Paragraph], structure: StructureExtract) -> list[dict[str, Any]]:
    if paragraphs:
        return [
            StructureSection(
                title=f"语义段 {index + 1}",
                startSeconds=_parse_time_to_seconds(item.time_range.start),
                endSeconds=max(
                    _parse_time_to_seconds(item.time_range.end),
                    _parse_time_to_seconds(item.time_range.start),
                ),
                summary=item.summary,
            ).model_dump()
            for index, item in enumerate(paragraphs)
        ]

    sections: list[dict[str, Any]] = []
    arc = structure.narrative_arc or []
    for index, item in enumerate(arc):
        start = _parse_time_to_seconds(str(item.get("time") or "00:00"))
        next_time = arc[index + 1].get("time") if index + 1 < len(arc) else None
        end = _parse_time_to_seconds(str(next_time)) if next_time else start
        title = item.get("event") or f"第 {index + 1} 段"
        sections.append(StructureSection(title=title, startSeconds=start, endSeconds=max(end, start), summary=title).model_dump())

    return sections


def _derive_copy_suggestions(packaging: PackagingAnalysis, summary: Internalization) -> list[dict[str, Any]]:
    title_content = " / ".join(packaging.title_hook_words[:3]) or "核心冲突明确"
    formulas = "、".join(packaging.title_formulas) or "清晰标题"
    return [
        CopySuggestion(type="标题优点", content=f"采用{formulas}写法，并突出“{title_content}”，有利于用户快速判断是否要点开。").model_dump(),
        CopySuggestion(type="结构优点", content=summary.clever_design).model_dump(),
        CopySuggestion(type="复用价值", content=f"可复用点：{summary.core_message}。后续同类内容可以借鉴这个核心表达与节奏安排。").model_dump(),
    ]


def _extract_message_content(body: dict[str, Any]) -> str:
    choices = body.get("choices") or []
    if not choices:
        raise RuntimeError("分析模型返回缺少 choices")

    message = choices[0].get("message") or {}
    content = message.get("content")
    if isinstance(content, str) and content.strip():
        return content

    if isinstance(content, list):
        parts = [item["text"] for item in content if isinstance(item, dict) and isinstance(item.get("text"), str)]
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


def _format_seconds_to_time(seconds: float) -> str:
    minutes, secs = divmod(max(int(seconds), 0), 60)
    return f"{minutes:02d}:{secs:02d}"


def _parse_time_to_seconds(time_text: str) -> int:
    match = re.search(r"(\d{1,2}:\d{2}(?::\d{2})?)", time_text)
    if not match:
        return 0

    parts = [int(part) for part in match.group(1).split(":")]
    if len(parts) == 2:
        return parts[0] * 60 + parts[1]
    return parts[0] * 3600 + parts[1] * 60 + parts[2]


def _truncate_for_prompt(text: str, max_chars: int) -> str:
    return text[:max_chars]


def _slice_timeline(full_text: str, start_seconds: float, end_seconds: float) -> str:
    chunks: list[str] = []
    matches = list(re.finditer(r"\[(\d{1,2}:\d{2}(?::\d{2})?)\]", full_text))
    for index, match in enumerate(matches):
        seconds = _parse_time_to_seconds(match.group(1))
        if start_seconds <= seconds <= end_seconds:
            end = matches[index + 1].start() if index + 1 < len(matches) else len(full_text)
            chunks.append(full_text[match.start():end].strip())

    return " ".join(chunks)
