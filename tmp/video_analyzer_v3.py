# -*- coding: utf-8 -*-
# Video Analyzer V3
# 修复: Internalization结构化 / 消除重复计算 / 全量格式示例(json.dumps生成)

import asyncio
import json
import logging
import re
from pathlib import Path
from typing import List, Dict, Optional, TypeVar, Type, Tuple, Literal

import srt
from pydantic import BaseModel, Field, field_validator
from openai import AsyncOpenAI, APIError

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


# ==================== 全局配置 ====================
class Config:
    LLM_API_KEY = "YOUR_API_KEY"
    LLM_BASE_URL = "https://api.deepseek.com/v1"
    LLM_MODEL = "deepseek-chat"
    REQUEST_TIMEOUT = 60.0
    RETRY_ATTEMPTS = 2
    MAX_SUBTITLE_CHARS = 6000
    TEMP_STRUCTURE = 0.2
    TEMP_SEMANTIC = 0.5
    TEMP_REPORT = 0.6


def get_config() -> Config:
    return Config()


# ==================== 数据模型层 ====================
TimeStr = str


class TimestampRange(BaseModel):
    start: TimeStr
    end: TimeStr

    @field_validator("start", "end")
    @classmethod
    def validate_time_format(cls, v: str) -> str:
        parts = v.split(":")
        if len(parts) not in [2, 3]:
            raise ValueError(f"Invalid: {v}")
        for p in parts:
            if not p.isdigit():
                raise ValueError(f"Invalid: {v}")
        return v


class Paragraph(BaseModel):
    time_range: TimestampRange
    summary: str = Field(..., max_length=200)
    key_sentences: List[str] = Field(default_factory=list, max_length=3)
    hook_candidate: bool = False


class ParagraphsWrapper(BaseModel):
    paragraphs: List[Paragraph]


class VideoHealthCard(BaseModel):
    one_line_summary: str = Field(..., max_length=50)
    core_keywords: List[str] = Field(..., max_length=3)
    has_hook: bool
    has_cta: bool
    hook_and_cta_quotes: List[str] = Field(default_factory=list)


class PackagingAnalysis(BaseModel):
    title_formulas: List[Literal["悬念式", "数字式", "对比式", "情绪呐喊式", "反常识式", "指令式"]]
    title_hook_words: List[str] = Field(default_factory=list)
    primary_psychology: Literal["好奇", "焦虑", "认同", "愤怒", "贪婪", "恐惧", "优越感"]
    secondary_psychology: Optional[Literal["好奇", "焦虑", "认同", "愤怒", "贪婪", "恐惧", "优越感"]] = None
    keywords: List[str] = Field(default_factory=list)
    keyword_density: Literal["高", "中", "低"]
    seo_friendly: bool
    cover_text: Optional[str] = None
    cover_relation: Literal["互补", "重复", "冲突", "无关"]
    visual_emotion: Literal["活泼", "严肃", "焦虑", "治愈", "压迫", "专业"]
    color_scheme: Optional[List[str]] = None
    typography_emotion: Optional[Literal["冲击", "精致", "随意", "权威"]] = None


class HookDetail(BaseModel):
    text: str
    time: TimeStr
    type: Literal["直给结论", "痛点提问", "反常理", "展示后果", "展示高光片段", "昂贵设备", "数据冲击", "身份认同"]
    mechanism: str
    hook_score: int = Field(..., ge=1, le=10)


class SegmentHook(BaseModel):
    time: TimeStr
    text: str
    function: Literal["悬念预告", "认知冲突", "利益强化", "情绪转折", "互动引导"]
    next_segment_hint: Optional[str] = None
    hook_score: int = Field(..., ge=1, le=10)


class ViralQuote(BaseModel):
    text: str = Field(..., max_length=20)
    time: TimeStr
    viral_reason: Literal["结论颠覆", "情绪共鸣", "金句格式", "圈层黑话", "实用干货", "反常识"]
    screenshot_friendly: bool
    share_scenario: Literal["评论区引用", "朋友圈截图", "弹幕刷屏", "收藏备用"]


class CTADetail(BaseModel):
    text: str
    time: TimeStr
    cta_type: Literal["点赞", "评论", "关注", "转发", "跳转", "组合"]
    target_audience: Optional[str] = None
    optimization_hint: Optional[str] = None


class StructuralBlocksOutput(BaseModel):
    hook: Optional[str] = None
    promise: Optional[str] = None
    meat: List[str] = Field(default_factory=list)
    re_hook: Optional[str] = None
    cta: Optional[str] = None


class StructureExtract(BaseModel):
    visual_hook: Optional[HookDetail] = None
    promise_hook: Optional[HookDetail] = None
    segment_hooks: List[SegmentHook] = Field(default_factory=list)
    narrative_arc: List[Dict[str, str]] = Field(default_factory=list)
    narrative_curve_text: Optional[str] = None
    structural_blocks: StructuralBlocksOutput = Field(default_factory=StructuralBlocksOutput)
    quotes: List[ViralQuote] = Field(default_factory=list)
    cta: Optional[CTADetail] = None
    logic_flow: Literal[
        "问题-解决方案", "反直觉-重构", "故事驱动", "流程教学", "测评对比",
        "并列式", "递进式", "黄金圈法则"
    ]


class RhetoricalDevice(BaseModel):
    type: Literal["恐惧诉求", "稀缺性", "社交认同", "权威背书", "损失厌恶", "即时满足", "从众心理"]
    text_snippet: str
    time_range: TimestampRange
    mechanism: str


class KnowledgePoint(BaseModel):
    time_range: TimestampRange
    density: int = Field(..., ge=1, le=5)
    topic: str
    term_count: int = 0


class InteractionDesign(BaseModel):
    type: Literal["弹幕提问", "故意槽点", "评论争议", "转发金句", "站队设计", "打卡挑战"]
    trigger_text: str
    time: TimeStr
    expected_response: str
    placement_strategy: Literal["开头引流", "中部留存", "结尾转化", "全程渗透"]


class SemanticAnalysis(BaseModel):
    psychological_triggers: List[str]
    rhetorical_devices: List[RhetoricalDevice] = Field(default_factory=list)
    tone_tags: List[Literal["网感", "专业", "搞笑", "治愈", "犀利", "亲切", "权威"]]
    net_slang: List[str] = Field(default_factory=list)
    persona_catchphrases: List[str] = Field(default_factory=list)
    interaction_designs: List[InteractionDesign] = Field(default_factory=list)
    knowledge_density_curve: List[KnowledgePoint] = Field(default_factory=list)
    cognitive_load: Literal["低", "中", "高"]
    overload_warnings: List[str] = Field(default_factory=list)
    emotion_curve: List[Dict[str, str]] = Field(default_factory=list)


class MetadataJSON(BaseModel):
    video_duration: Optional[str] = None
    narrative_arc: List[Dict[str, str]]
    narrative_curve_text: Optional[str] = None
    structural_blocks: StructuralBlocksOutput
    hook_score: int = Field(..., ge=0, le=10)
    retention_risk_points: List[str] = Field(default_factory=list)
    golden_quote_count: int
    interaction_count: int
    cognitive_load_distribution: Dict[str, int]


class Step2Output(BaseModel):
    packaging: PackagingAnalysis
    semantic: SemanticAnalysis


class Internalization(BaseModel):
    core_message: str = Field(..., max_length=15, description="<=15 chars")
    clever_design: str = Field(..., description="must include timestamp")
    optimization: str = Field(..., description="original->new + reason")


class FinalReport(BaseModel):
    health_card: VideoHealthCard
    packaging: PackagingAnalysis
    script_layer: StructureExtract
    semantic_layer: SemanticAnalysis
    summary: Internalization
    metadata_json: MetadataJSON


# ==================== 工具函数层 ====================
def format_seconds_to_time(seconds: float) -> str:
    minutes, secs = divmod(int(seconds), 60)
    return f"{minutes:02d}:{secs:02d}"


def truncate_for_prompt(text: str, max_chars: int = 8000) -> str:
    return text[:max_chars]


def validate_time_in_range(time_str: str, total_duration: float) -> bool:
    try:
        parts = time_str.split(":")
        if len(parts) == 2:
            sec = int(parts[0]) * 60 + int(parts[1])
        elif len(parts) == 3:
            sec = int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
        else:
            return False
        return sec <= total_duration + 5
    except Exception:
        return False


def calculate_hook_score(structure_dict: dict) -> int:
    score = 0
    if structure_dict.get("visual_hook"):
        score += 3
    if structure_dict.get("promise_hook"):
        score += 3
    score += min(len(structure_dict.get("segment_hooks", [])), 2)
    if structure_dict.get("cta"):
        score += 2
    return min(score, 10)


# ==================== LLM 客户端层 ====================
T = TypeVar("T", bound=BaseModel)


class LLMClient:
    def __init__(self):
        cfg = get_config()
        self.client = AsyncOpenAI(
            api_key=cfg.LLM_API_KEY, base_url=cfg.LLM_BASE_URL,
            timeout=cfg.REQUEST_TIMEOUT,
        )
        self.model = cfg.LLM_MODEL

    async def call(self, prompt, schema, temperature=0.2, max_retries=2):
        for attempt in range(max_retries + 1):
            try:
                resp = await self.client.chat.completions.create(
                    model=self.model,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=temperature,
                    response_format={"type": "json_object"},
                    extra_body={"stop": ["```"], "repetition_penalty": 1.1},
                )
                raw = resp.choices[0].message.content
                try:
                    return schema.model_validate(json.loads(raw))
                except json.JSONDecodeError:
                    if "```json" in raw:
                        cleaned = raw.split("```json")[1].split("```")[0].strip()
                        return schema.model_validate(json.loads(cleaned))
                    raise
            except APIError:
                if attempt == max_retries:
                    raise
                await asyncio.sleep(1.5 ** attempt)
            except Exception as e:
                if attempt == max_retries:
                    logger.error(f"Parse failed: {e}")
                    return schema()
                await asyncio.sleep(1.0)
        return schema()


_llm_client = None


async def call_llm(prompt, schema, temperature=0.2, max_retries=None):
    global _llm_client
    if _llm_client is None:
        _llm_client = LLMClient()
    return await _llm_client.call(prompt, schema, temperature, max_retries)


# ==================== 预处理层 ====================
def parse_srt_to_timeline(srt_content):
    subs = list(srt.parse(srt_content))
    parts = []
    for s in subs:
        tag = format_seconds_to_time(s.start.total_seconds())
        text = " ".join(s.content.strip().split())
        parts.append(f"[{tag}] {text}")
    return " ".join(parts)


def load_and_preprocess_srt(srt_path, max_chars=6000):
    content = Path(srt_path).read_text(encoding="utf-8")
    full = parse_srt_to_timeline(content)
    subs = list(srt.parse(content))
    dur = subs[-1].end.total_seconds() if subs else 0
    return full, len(full) > max_chars, dur


async def generate_paragraph_summary(full_text, segment_duration=60):
    if len(full_text) > 8000:
        logger.warning(f"Subtitle len {len(full_text)} > 8000, may lose content.")
    _example = json.dumps({
        "paragraphs": [{
            "time_range": {"start": "00:00", "end": "00:58"},
            "summary": "开头用脱发焦虑吸引注意",
            "key_sentences": ["90%的人洗头都错了", "正确方法是..."],
            "hook_candidate": True
        }, {
            "time_range": {"start": "00:58", "end": "02:00"},
            "summary": "给出三个防脱方法",
            "key_sentences": ["第一水温不能太高"],
            "hook_candidate": False
        }]
    }, ensure_ascii=False, indent=2)
    prompt = (
        "你是视频内容分析师。将带时间轴的字幕按约60秒划分逻辑段落, 保持语义完整。\n"
        f"仅输出合法JSON对象, 严格仿照此结构示例:\n\n{_example}\n\n"
        f"【字幕内容】{truncate_for_prompt(full_text, 8000)}"
    )
    result = await call_llm(prompt, schema=ParagraphsWrapper, temperature=0.1)
    return result.paragraphs


def build_compressed_text(full_text, paragraphs, total_duration):
    head_cutoff = 30
    tail_cutoff = max(0, total_duration - 30)
    matches = list(re.finditer(r"\[(\d{2}:\d{2})\]", full_text))
    head, tail = "", ""
    for i, m in enumerate(matches):
        ts = int(m.group(1).split(":")[0]) * 60 + int(m.group(1).split(":")[1])
        end = matches[i + 1].start() if i + 1 < len(matches) else len(full_text)
        chunk = full_text[m.start():end] + " "
        if ts <= head_cutoff:
            head += chunk
        elif ts >= tail_cutoff:
            tail += chunk
    summaries = []
    for p in paragraphs:
        mk = "🪝 " if p.hook_candidate else ""
        summaries.append(
            f"[{p.time_range.start}-{p.time_range.end}] "
            f"{mk}摘要:{p.summary} | 关键句:{'; '.join(p.key_sentences)}"
        )
    return (f"{head.strip()}\n\n...(中间段落摘要)...\n"
            + "\n".join(summaries)
            + f"\n\n...(结尾)...\n{tail.strip()}")


# ==================== Prompt 格式示例 (json.dumps 生成) ====================
STEP1_EXAMPLE = json.dumps({
    "visual_hook": {
        "text": "你是不是一觉得头发油就去疯狂洗头？",
        "time": "00:00",
        "type": "痛点提问",
        "mechanism": "通过提问日常习惯引发好奇",
        "hook_score": 8
    },
    "promise_hook": {
        "text": "今天教你三个防脱秘籍",
        "time": "00:10",
        "type": "直给结论",
        "mechanism": "明确告知看完能得到具体方案",
        "hook_score": 7
    },
    "segment_hooks": [{
        "time": "00:58",
        "text": "但这还不是最严重的",
        "function": "悬念预告",
        "next_segment_hint": "下一段将揭示更严重的后果",
        "hook_score": 9
    }],
    "narrative_arc": [
        {"time": "00:00", "event": "冲突引入"},
        {"time": "00:45", "event": "数据证明"},
        {"time": "01:20", "event": "情绪转折"},
        {"time": "02:00", "event": "解决方案"}
    ],
    "narrative_curve_text": (
        '00:00 [冲突引入] "你是不是一觉得头发油..." '
        '-> 00:45 [数据证明] "90%的人..." '
        '-> 01:20 [情绪转折] "但其实..." '
        '-> 02:00 [解决方案] "只需要三步..."'
    ),
    "structural_blocks": {
        "hook": "00:00-00:05",
        "promise": "00:05-00:15",
        "meat": ["00:15-00:45", "00:45-01:20"],
        "re_hook": "01:20-01:25",
        "cta": "02:00-02:10"
    },
    "quotes": [{
        "text": "别傻了这样只会越洗越掉",
        "time": "00:05",
        "viral_reason": "反常识",
        "screenshot_friendly": True,
        "share_scenario": "弹幕刷屏"
    }],
    "cta": {
        "text": "点赞收藏明天洗头试试看",
        "time": "02:00",
        "cta_type": "组合",
        "target_audience": "有脱发焦虑的年轻人",
        "optimization_hint": "建议加入具体预期效果如三天见效"
    },
    "logic_flow": "问题-解决方案"
}, ensure_ascii=False, indent=2)

STEP1_CONSTRAINTS = "\n".join([
    "字段约束:",
    "- visual_hook: 0-3秒, type可选: 直给结论/痛点提问/反常理/展示后果/展示高光片段/昂贵设备/数据冲击/身份认同",
    "- promise_hook: 3-15秒, type同上",
    "- segment_hooks: 每段结尾的留存设计, function可选: 悬念预告/认知冲突/利益强化/情绪转折/互动引导",
    "- narrative_arc: event可选: 冲突引入/数据证明/情绪转折/解决方案/价值升华",
    '- narrative_curve_text: 强制格式 00:05 [事件] "原句" -> 00:45 [事件] "原句" -> ...',
    "- structural_blocks: 时间格式 MM:SS-MM:SS, meat为字符串数组",
    "- quotes: text<=20字, viral_reason可选: 结论颠覆/情绪共鸣/金句格式/圈层黑话/实用干货/反常识",
    "- cta: cta_type可选: 点赞/评论/关注/转发/跳转/组合",
    "- logic_flow可选: 问题-解决方案/反直觉-重构/故事驱动/流程教学/测评对比/并列式/递进式/黄金圈法则",
    "- 所有时间戳格式 MM:SS, 金句必须引用原句不可改写",
    "仅输出纯JSON, 禁止输出Markdown",
])

STEP2_EXAMPLE = json.dumps({
    "packaging": {
        "title_formulas": ["悬念式", "反常识式"],
        "title_hook_words": ["千万别", "99%的人"],
        "primary_psychology": "焦虑",
        "secondary_psychology": "好奇",
        "keywords": ["洗头", "防脱", "护发"],
        "keyword_density": "高",
        "seo_friendly": True,
        "cover_text": "发量翻倍",
        "cover_relation": "互补",
        "visual_emotion": "焦虑",
        "color_scheme": ["红", "黄"],
        "typography_emotion": "冲击"
    },
    "semantic": {
        "psychological_triggers": ["恐惧诉求", "从众心理"],
        "rhetorical_devices": [{
            "type": "恐惧诉求",
            "text_snippet": "头发会掉光",
            "time_range": {"start": "00:00", "end": "00:05"},
            "mechanism": "通过展示严重后果引发焦虑促使继续观看"
        }],
        "tone_tags": ["网感", "亲切"],
        "net_slang": ["别傻了", "打工人"],
        "persona_catchphrases": ["99%的人都不知道"],
        "interaction_designs": [{
            "type": "弹幕提问",
            "trigger_text": "你中招了没",
            "time": "00:05",
            "expected_response": "刷中招了/没中招",
            "placement_strategy": "中部留存"
        }],
        "knowledge_density_curve": [{
            "time_range": {"start": "00:15", "end": "00:45"},
            "density": 4,
            "topic": "洗发水温对毛囊的影响",
            "term_count": 2
        }],
        "cognitive_load": "中",
        "overload_warnings": [
            "00:45-01:10 术语密集(毛囊退化周期等), 观众可能产生逃避心理"
        ],
        "emotion_curve": [
            {"time": "00:00", "emotion": "紧张"},
            {"time": "01:00", "emotion": "好奇"},
            {"time": "02:00", "emotion": "释然"}
        ]
    }
}, ensure_ascii=False, indent=2)

STEP2_CONSTRAINTS = "\n".join([
    "字段约束:",
    "- title_formulas可选: 悬念式/数字式/对比式/情绪呐喊式/反常识式/指令式",
    "- primary/secondary_psychology可选: 好奇/焦虑/认同/愤怒/贪婪/恐惧/优越感",
    "- cover_relation可选: 互补/重复/冲突/无关",
    "- visual_emotion可选: 活泼/严肃/焦虑/治愈/压迫/专业",
    "- typography_emotion可选: 冲击/精致/随意/权威",
    "- rhetorical_devices.type可选: 恐惧诉求/稀缺性/社交认同/权威背书/损失厌恶/即时满足/从众心理",
    "- tone_tags可选: 网感/专业/搞笑/治愈/犀利/亲切/权威",
    "- interaction_designs.type可选: 弹幕提问/故意槽点/评论争议/转发金句/站队设计/打卡挑战",
    "- interaction_designs.placement_strategy可选: 开头引流/中部留存/结尾转化/全程渗透",
    "- knowledge_density_curve.density: 1-5整数",
    "- cognitive_load可选: 低/中/高",
    "- 所有结论必须引用字幕原句+时间戳",
    "仅输出纯JSON, 禁止输出Markdown",
])

STEP3_EXAMPLE = json.dumps({
    "health_card": {
        "one_line_summary": "洗头误区导致脱发, 三招解决",
        "core_keywords": ["洗头", "防脱", "误区"],
        "has_hook": True,
        "has_cta": True,
        "hook_and_cta_quotes": [
            "你是不是一觉得头发油就去疯狂洗头？",
            "点赞收藏明天洗头试试看"
        ]
    },
    "summary": {
        "core_message": "正确洗头三步法防脱发",
        "clever_design": "00:05用反常识句式否定了常规操作, 配合恐惧诉求建立紧迫感",
        "optimization": (
            "原句: 别傻了这样只会越洗越掉 -> "
            "新句: 你以为在清洁头皮, 其实在亲手杀死毛囊。"
            "理由: 从动作描述升级为器官级后果, 恐惧感更强"
        )
    },
    "metadata_json": {
        "retention_risk_points": [
            "01:00-01:30 连续两个干货段落无钩子, 完播率可能在此断崖下跌"
        ]
    }
}, ensure_ascii=False, indent=2)

STEP3_CONSTRAINTS = "\n".join([
    "填写规则:",
    "- health_card.one_line_summary: <=50字",
    "- health_card.core_keywords: 严格3个",
    "- health_card.hook_and_cta_quotes: 从视频中原句摘录",
    "- summary.core_message: <=15字, 视频唯一核心信息",
    "- summary.clever_design: 必须包含具体时间点, 说明为何巧妙",
    '- summary.optimization: 格式 "原句->新句 + 理由", 给出具体可执行方案',
    "- metadata_json: 只需填写 retention_risk_points, 其余字段填null即可(系统自动计算)",
    "- packaging/script_layer/semantic_layer: 直接复制下方透传数据, 保持原样",
    "仅输出纯JSON, 禁止输出Markdown",
])


# ==================== 核心流水线层 ====================
async def step1_extract_structure(text_for_structure, total_duration):
    prompt = (
        "你是资深视频结构分析师。从字幕提取结构化信息。\n"
        "仅输出合法JSON对象, 必须严格仿照下方结构示例的字段名和格式。\n\n"
        f"=== 结构示例 ===\n{STEP1_EXAMPLE}\n\n"
        f"{STEP1_CONSTRAINTS}\n\n"
        f"【字幕】{text_for_structure}"
    )
    result = await call_llm(
        prompt, schema=StructureExtract,
        temperature=get_config().TEMP_STRUCTURE,
    )
    if result.visual_hook and not validate_time_in_range(
        result.visual_hook.time, total_duration
    ):
        logger.warning(f"Visual hook time {result.visual_hook.time} may drift")
    return result


async def step2_analyze_semantic_packaging(title, thumb_desc, structure, text_for_semantic):
    prompt = (
        "你是传播心理学专家。基于视频信息完成包装层+语义层分析。\n"
        f"标题: \"{title}\" | 封面: {thumb_desc}\n"
        "仅输出合法JSON对象, 必须严格仿照下方结构示例。\n\n"
        f"=== 结构示例 ===\n{STEP2_EXAMPLE}\n\n"
        f"{STEP2_CONSTRAINTS}\n\n"
        f"【字幕素材】{text_for_semantic}"
    )
    return await call_llm(
        prompt, schema=Step2Output,
        temperature=get_config().TEMP_SEMANTIC,
    )


async def step3_generate_report(title, thumb_desc, packaging, structure, semantic, total_duration):
    prompt = (
        "你是内容架构师。基于已有分析数据, 完成最终报告。\n"
        f"标题: \"{title}\" | 封面: {thumb_desc}\n"
        "仅输出合法JSON对象, 必须严格仿照下方结构示例。\n\n"
        f"=== 结构示例 ===\n{STEP3_EXAMPLE}\n\n"
        f"{STEP3_CONSTRAINTS}\n\n"
        "=== 透传数据(直接复制到输出中) ===\n"
        f"packaging: {packaging.model_dump_json(exclude_unset=True)}\n"
        f"script_layer: {structure.model_dump_json(exclude_unset=True)}\n"
        f"semantic_layer: {semantic.model_dump_json(exclude_unset=True)}"
    )
    result = await call_llm(
        prompt, schema=FinalReport,
        temperature=get_config().TEMP_REPORT,
    )
    densities = [kp.density for kp in semantic.knowledge_density_curve]
    total_d = len(densities) if densities else 1
    low = densities.count(1) + densities.count(2)
    mid = densities.count(3)
    high = densities.count(4) + densities.count(5)
    result.metadata_json.hook_score = calculate_hook_score(structure.model_dump())
    result.metadata_json.golden_quote_count = len(structure.quotes)
    result.metadata_json.interaction_count = len(semantic.interaction_designs)
    result.metadata_json.video_duration = format_seconds_to_time(total_duration)
    result.metadata_json.narrative_arc = structure.narrative_arc
    result.metadata_json.narrative_curve_text = structure.narrative_curve_text
    result.metadata_json.cognitive_load_distribution = {
        "low": round(low / total_d * 100),
        "medium": round(mid / total_d * 100),
        "high": round(high / total_d * 100),
    }
    sb = structure.structural_blocks
    result.metadata_json.structural_blocks = StructuralBlocksOutput(
        hook=f"{sb.hook.start}-{sb.hook.end}" if sb.hook else None,
        promise=f"{sb.promise.start}-{sb.promise.end}" if sb.promise else None,
        meat=[f"{m.start}-{m.end}" for m in sb.meat],
        re_hook=f"{sb.re_hook.start}-{sb.re_hook.end}" if sb.re_hook else None,
        cta=f"{sb.cta.start}-{sb.cta.end}" if sb.cta else None,
    )
    return result


async def analyze_video_pipeline(title, thumb_desc, srt_path):
    logger.info(f"Start: {title}")
    full_text, needs_summary, total_duration = load_and_preprocess_srt(
        srt_path, get_config().MAX_SUBTITLE_CHARS,
    )
    text_for_analysis = full_text
    if needs_summary:
        logger.info("Subtitle too long, generating summaries...")
        paragraphs = await generate_paragraph_summary(full_text)
        text_for_analysis = build_compressed_text(full_text, paragraphs, total_duration)
    logger.info("Step 1: Extract structure...")
    structure = await step1_extract_structure(text_for_analysis, total_duration)
    logger.info("Step 2: Analyze semantics + packaging...")
    s2 = await step2_analyze_semantic_packaging(title, thumb_desc, structure, text_for_analysis)
    logger.info("Step 3: Generate final report...")
    report = await step3_generate_report(title, thumb_desc, s2.packaging, structure, s2.semantic, total_duration)
    logger.info("Done")
    return report


# ==================== 运行入口 ====================
async def main():
    title = "你千万不要再这样洗头了，不然头发会掉光！"
    thumb_desc = "黄底红字，表情惊恐，文字：发量翻倍"
    srt_path = "video.srt"
    if not Path(srt_path).exists():
        logger.warning("SRT not found, generating mock data...")
        Path(srt_path).write_text(
            "1\n00:00:00,000 --> 00:00:05,000\n你是不是一觉得头发油，就去疯狂洗头？\n"
            "2\n00:00:05,000 --> 00:00:10,000\n别傻了，这样只会越洗越掉！\n"
            "3\n00:00:10,000 --> 00:00:15,000\n今天教你三个防脱秘籍，发量翻倍。\n"
            "4\n00:00:15,000 --> 00:01:00,000\n第一，水温不能太高。很多人喜欢用烫水...\n"
            "5\n00:01:00,000 --> 00:01:30,000\n第二个误区，直接把洗发水抹头上。\n"
            "6\n00:01:30,000 --> 00:02:00,000\n最后一点最狠，99%的人不知道。\n"
            "7\n00:02:00,000 --> 00:02:10,000\n点赞收藏，明天洗头试试看！\n",
            encoding="utf-8",
        )
    report = await analyze_video_pipeline(title, thumb_desc, srt_path)
    output = report.model_dump_json(indent=2, ensure_ascii=False)
    print(output)
    Path("report.json").write_text(output, encoding="utf-8")
    logger.info("Saved to report.json")


if __name__ == "__main__":
    asyncio.run(main())
