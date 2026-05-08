from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import Any

WORKER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER_DIR))

config_stub = ModuleType("config")
config_stub.WorkerConfig = object
config_stub.load_config = lambda: None
sys.modules.setdefault("config", config_stub)

db_stub = ModuleType("db")
db_stub.ClaimedJob = object
db_stub.Database = object
db_stub.VideoSourceRecord = object
sys.modules.setdefault("db", db_stub)

bilibili_stub = ModuleType("services.bilibili")
bilibili_stub.BilibiliService = object
bilibili_stub.SubtitleTrack = object
bilibili_stub.VideoSnapshot = object
sys.modules.setdefault("services.bilibili", bilibili_stub)

from services.analyzer import AnalysisResultFormatError, AnalyzerService, MetadataJSON, ParagraphsWrapper, StructureExtract, Step2Output
from services.subtitle import SubtitleFetchError, SubtitleService, SubtitleUnavailableError
from services.transcript import TranscriptPayload
from worker import process_job, PublicWorkerError, resolve_transcript


class FakeDb:
    def __init__(self) -> None:
        self.updates: list[dict[str, Any]] = []

    def update_video_source(self, source_id: str, **fields: Any) -> None:
        self.updates.append({"source_id": source_id, **fields})


class FakeSubtitleService:
    def __init__(self, result: str | Exception) -> None:
        self._result = result

    def fetch_text(self, tracks: list[Any]) -> str:
        return self.fetch_payload(tracks).text

    def fetch_payload(self, tracks: list[Any]) -> TranscriptPayload:
        if isinstance(self._result, Exception):
            raise self._result

        return TranscriptPayload(text=self._result, timeline_text=f"[00:00] {self._result}", duration_seconds=1)


class FakeBilibiliService:
    def __init__(self) -> None:
        self.audio_called = False

    def fetch_audio_url(self, bvid: str, cid: int) -> str:
        self.audio_called = True
        return f"https://example.invalid/{bvid}/{cid}.m4a"


class FakeAsrService:
    def __init__(self, result: str | Exception = "ASR 文本") -> None:
        self._result = result
        self.called = False

    def transcribe(self, **kwargs: Any) -> str:
        return self.transcribe_payload(**kwargs).text

    def transcribe_payload(self, **kwargs: Any) -> TranscriptPayload:
        self.called = True
        if isinstance(self._result, Exception):
            raise self._result

        return TranscriptPayload(text=self._result, timeline_text=f"[00:00] {self._result}", duration_seconds=kwargs.get("duration_seconds"))


class FakeLogger:
    def log(self, *args: Any, **kwargs: Any) -> None:
        return None


class FakeProcessDb(FakeDb):
    def __init__(self, source: SimpleNamespace | None = None) -> None:
        super().__init__()
        self._source = source or _source(transcript_text="已缓存转写")
        self.ready_payload: dict[str, Any] | None = None
        self.failed_payload: dict[str, Any] | None = None
        self.stage_starts: list[dict[str, Any]] = []
        self.stage_finishes: list[dict[str, Any]] = []

    def get_video_source(self, source_id: str) -> SimpleNamespace | None:
        return self._source

    def mark_job_ready(self, job_id: str, **fields: Any) -> None:
        self.ready_payload = {"job_id": job_id, **fields}

    def mark_job_failed(self, job_id: str, error_message: str) -> None:
        self.failed_payload = {"job_id": job_id, "error_message": error_message}

    def start_job_stage(self, job_id: str, stage: str, *, message: str | None = None, details: dict[str, Any] | None = None) -> SimpleNamespace:
        event_id = f"stage-{len(self.stage_starts) + 1}"
        self.stage_starts.append({"event_id": event_id, "job_id": job_id, "stage": stage, "message": message, "details": details})
        return SimpleNamespace(id=event_id)

    def finish_job_stage(self, event_id: str, *, status: str, message: str | None = None, details: dict[str, Any] | None = None) -> None:
        self.stage_finishes.append({"event_id": event_id, "status": status, "message": message, "details": details})


class FakeSnapshotBilibiliService:
    def fetch_video_snapshot(self, bvid: str) -> SimpleNamespace:
        return _snapshot()


class FakeAnalyzer:
    def __init__(self, result: SimpleNamespace | Exception) -> None:
        self._result = result
        self.last_normalization_warnings: list[dict[str, Any]] = []

    def analyze(self, **kwargs: Any) -> SimpleNamespace:
        run_step = kwargs.get("run_step")
        if isinstance(self._result, Exception):
            raise self._result

        if callable(run_step):
            run_step("ANALYSIS_STRUCTURE", "提取脚本结构", lambda: None)
            run_step("ANALYSIS_SEMANTIC_PACKAGING", "分析包装与语义", lambda: None)
            run_step("ANALYSIS_FINAL_REPORT", "生成最终报告", lambda: None)

        return self._result


class TranscriptStrategyTest(unittest.TestCase):
    def test_uses_subtitle_without_asr_when_subtitle_is_ready(self) -> None:
        db = FakeDb()
        bilibili = FakeBilibiliService()
        asr = FakeAsrService()

        payload = resolve_transcript(
            db,
            _source(),
            _snapshot(),
            bilibili,
            FakeSubtitleService("字幕文本"),
            asr,
        )

        self.assertEqual(payload.text, "字幕文本")
        self.assertEqual(payload.timeline_text, "[00:00] 字幕文本")
        self.assertFalse(bilibili.audio_called)
        self.assertFalse(asr.called)
        self.assertEqual(db.updates[-1]["subtitleStatus"], "READY")
        self.assertEqual(db.updates[-1]["transcriptSource"], "SUBTITLE")

    def test_uses_asr_only_when_subtitle_is_unavailable(self) -> None:
        db = FakeDb()
        bilibili = FakeBilibiliService()
        asr = FakeAsrService("ASR 转写文本")

        payload = resolve_transcript(
            db,
            _source(),
            _snapshot(),
            bilibili,
            FakeSubtitleService(SubtitleUnavailableError("无字幕")),
            asr,
        )

        self.assertEqual(payload.text, "ASR 转写文本")
        self.assertEqual(payload.timeline_text, "[00:00] ASR 转写文本")
        self.assertTrue(bilibili.audio_called)
        self.assertTrue(asr.called)
        self.assertEqual(db.updates[0]["subtitleStatus"], "UNAVAILABLE")
        self.assertEqual(db.updates[-1]["transcriptSource"], "ASR")

    def test_subtitle_fetch_error_fails_without_asr_fallback(self) -> None:
        db = FakeDb()
        bilibili = FakeBilibiliService()
        asr = FakeAsrService()

        with self.assertRaises(PublicWorkerError) as context:
            resolve_transcript(
                db,
                _source(),
                _snapshot(),
                bilibili,
                FakeSubtitleService(SubtitleFetchError("接口异常")),
                asr,
            )

        self.assertEqual(context.exception.public_message, "字幕抓取失败")
        self.assertFalse(bilibili.audio_called)
        self.assertFalse(asr.called)
        self.assertEqual(db.updates[-1]["subtitleStatus"], "FAILED")
        self.assertEqual(db.updates[-1]["transcriptStatus"], "FAILED")

    def test_asr_error_marks_transcript_failed_after_subtitle_unavailable(self) -> None:
        db = FakeDb()
        asr = FakeAsrService(RuntimeError("ASR 异常"))

        with self.assertRaises(PublicWorkerError) as context:
            resolve_transcript(
                db,
                _source(),
                _snapshot(),
                FakeBilibiliService(),
                FakeSubtitleService(SubtitleUnavailableError("无字幕")),
                asr,
            )

        self.assertEqual(context.exception.public_message, "音频转写失败")
        self.assertEqual(db.updates[0]["subtitleStatus"], "UNAVAILABLE")
        self.assertEqual(db.updates[-1]["transcriptStatus"], "FAILED")
        self.assertIsNone(db.updates[-1]["transcriptSource"])


class AnalysisAndStatusWritebackTest(unittest.TestCase):
    def test_process_job_writes_ready_result_fields(self) -> None:
        db = FakeProcessDb()
        analysis = SimpleNamespace(
            summary="总结",
            structure_sections=[{"title": "开头", "startSeconds": 0, "endSeconds": 60, "summary": "开头总结"}],
            highlights=[{"quote": "金句", "reason": "有传播价值", "timestampSeconds": 10}],
            copy_suggestions=[{"type": "title", "content": "标题建议"}],
            health_card={"core_keywords": ["测试"]},
            packaging_analysis={"keywords": ["测试"]},
            script_analysis={"segment_hooks": []},
            semantic_analysis={"interaction_designs": []},
            internalization_summary={"core_message": "测试"},
            metadata_json={"golden_quote_count": 1, "interaction_count": 0, "retention_risk_points": []},
            model_name="mock-model",
            prompt_version="video-analysis-v3",
        )

        process_job(
            FakeLogger(),
            db,
            FakeSnapshotBilibiliService(),
            FakeSubtitleService("不会使用字幕，因为已有缓存转写"),
            FakeAsrService(),
            FakeAnalyzer(analysis),
            _job(),
        )

        self.assertIsNone(db.failed_payload)
        self.assertIsNotNone(db.ready_payload)
        self.assertEqual(db.ready_payload["summary"], "总结")
        self.assertEqual(db.ready_payload["structure_sections"], analysis.structure_sections)
        self.assertEqual(db.ready_payload["highlights"], analysis.highlights)
        self.assertEqual(db.ready_payload["copy_suggestions"], analysis.copy_suggestions)
        self.assertEqual(db.ready_payload["health_card"], analysis.health_card)
        self.assertEqual(db.ready_payload["packaging_analysis"], analysis.packaging_analysis)
        self.assertEqual(db.ready_payload["script_analysis"], analysis.script_analysis)
        self.assertEqual(db.ready_payload["semantic_analysis"], analysis.semantic_analysis)
        self.assertEqual(db.ready_payload["internalization_summary"], analysis.internalization_summary)
        self.assertEqual(db.ready_payload["metadata_json"], analysis.metadata_json)
        self.assertNotIn("creator_action_plan", db.ready_payload["metadata_json"])
        self.assertEqual(db.ready_payload["model_name"], "mock-model")
        self.assertEqual(db.ready_payload["prompt_version"], "video-analysis-v3")
        self.assertEqual(
            [item["stage"] for item in db.stage_starts],
            [
                "SOURCE_LOAD",
                "SNAPSHOT_FETCH",
                "METADATA_SYNC",
                "TRANSCRIPT_RESOLVE",
                "ANALYSIS_STRUCTURE",
                "ANALYSIS_SEMANTIC_PACKAGING",
                "ANALYSIS_FINAL_REPORT",
                "RESULT_WRITEBACK",
            ],
        )
        self.assertTrue(all(item["status"] == "SUCCEEDED" for item in db.stage_finishes))


class TimelinePayloadTest(unittest.TestCase):
    def test_subtitle_payload_converts_from_time_to_timeline_text(self) -> None:
        service = SubtitleService(SimpleNamespace(http_timeout_seconds=3, bilibili_user_agent="test-agent"))
        service._session = SimpleNamespace(get=lambda *_args, **_kwargs: _json_response({"body": [{"from": 1.2, "to": 3.4, "content": " 第一行 "}]}))

        payload = service.fetch_payload([SimpleNamespace(url="https://example.invalid/subtitle.json")])

        self.assertEqual(payload.text, "第一行")
        self.assertEqual(payload.timeline_text, "[00:01] 第一行")
        self.assertEqual(payload.duration_seconds, 3.4)

    def test_asr_payload_converts_millisecond_sentence_time_to_timeline_text(self) -> None:
        from services.asr import AsrService

        service = AsrService(SimpleNamespace(qwen_mock_mode=False))
        payload = service._extract_payload(
            {"transcripts": [{"text": "全文", "sentences": [{"begin_time": 1234, "text": "第一句"}]}]},
            "BV1test",
            10,
        )

        self.assertEqual(payload.text, "全文\n第一句")
        self.assertEqual(payload.timeline_text, "[00:01] 第一句")

    def test_process_job_writes_stable_error_for_invalid_analysis_result(self) -> None:
        db = FakeProcessDb()

        process_job(
            FakeLogger(),
            db,
            FakeSnapshotBilibiliService(),
            FakeSubtitleService("不会使用字幕，因为已有缓存转写"),
            FakeAsrService(),
            FakeAnalyzer(AnalysisResultFormatError("分析结果格式不合法", step="ANALYSIS_STRUCTURE", schema_name="StructureExtract", raw_preview="{}", response_length=2)),
            _job(),
        )

        self.assertIsNone(db.ready_payload)
        self.assertEqual(db.failed_payload, {"job_id": "job-1", "error_message": "分析结果格式不合法"})
        self.assertEqual(db.stage_starts[-1]["stage"], "FAILED_WRITEBACK")
        self.assertEqual(db.stage_finishes[-1]["status"], "SUCCEEDED")


class AnalyzerNormalizationTest(unittest.TestCase):
    def test_mock_analysis_writes_creator_action_plan_to_metadata(self) -> None:
        service = AnalyzerService(SimpleNamespace(qwen_mock_mode=True), Path("/tmp/not-used-prompt.txt"))

        output = service.analyze(title="测试标题", transcript_text="第一句。第二句。", duration_seconds=60)
        plan = output.metadata_json.get("creator_action_plan")

        self.assertIsInstance(plan, dict)
        self.assertGreaterEqual(len(plan["priority_fixes"]), 3)
        self.assertTrue(plan["title_rewrites"])
        self.assertTrue(plan["opening_rewrites"])
        self.assertTrue(plan["cta_rewrites"])
        self.assertTrue(plan["overload_rewrites"])
        self.assertTrue(plan["reuse_template"])

    def test_metadata_model_allows_missing_creator_action_plan_for_old_data(self) -> None:
        metadata = MetadataJSON.model_validate({"retention_risk_points": []})

        self.assertIsNone(metadata.creator_action_plan)

    def test_paragraph_summary_auto_trims_key_sentences_to_three(self) -> None:
        service = AnalyzerService(
            SimpleNamespace(
                qwen_mock_mode=False,
                qwen_api_key="test-key",
                video_analysis_llm_model="test-model",
                video_analysis_llm_url="https://example.invalid",
                http_timeout_seconds=3,
            ),
            Path("/tmp/not-used-prompt.txt"),
        )

        normalized = service._normalize_payload_for_schema(
            ParagraphsWrapper,
            {
                "paragraphs": [
                    {
                        "time_range": {"start": "00:00", "end": "00:10"},
                        "summary": "测试摘要",
                        "key_sentences": ["1", "2", "3", "4"],
                        "hook_candidate": False,
                    }
                ]
            },
        )

        self.assertEqual(normalized["paragraphs"][0]["key_sentences"], ["1", "2", "3"])
        self.assertEqual(
            service.last_normalization_warnings,
            [{
                "step": "ANALYSIS_PARAGRAPH_SUMMARY",
                "field": "paragraphs.key_sentences",
                "paragraphIndex": 0,
                "originalLength": 4,
                "trimmedLength": 3,
                "strategy": "keep_first_3",
            }],
        )

    def test_structure_auto_maps_literals_and_trims_quote_text(self) -> None:
        service = AnalyzerService(
            SimpleNamespace(
                qwen_mock_mode=False,
                qwen_api_key="test-key",
                video_analysis_llm_model="test-model",
                video_analysis_llm_url="https://example.invalid",
                http_timeout_seconds=3,
            ),
            Path("/tmp/not-used-prompt.txt"),
        )

        normalized = service._normalize_payload_for_schema(
            StructureExtract,
            {
                "visual_hook": {"text": "a", "time": "00:00", "type": "数据对比", "mechanism": "m", "hook_score": 8},
                "promise_hook": {"text": "b", "time": "00:01", "type": "内容预告", "mechanism": "m", "hook_score": 7},
                "segment_hooks": [{"time": "00:10", "text": "x", "function": "反常识揭秘", "next_segment_hint": "n", "hook_score": 8}],
                "narrative_arc": [],
                "narrative_curve_text": "",
                "structural_blocks": {"meat": []},
                "quotes": [{"text": "在未来的时代，算力就等同于工业时代的煤炭、石油和自来水", "time": "00:20", "viral_reason": "颠覆认知", "screenshot_friendly": True, "share_scenario": "财经社群讨论"}],
                "cta": None,
                "logic_flow": "递进式",
            },
        )

        self.assertEqual(normalized["visual_hook"]["type"], "数据冲击")
        self.assertEqual(normalized["promise_hook"]["type"], "直给结论")
        self.assertEqual(normalized["segment_hooks"][0]["function"], "认知冲突")
        self.assertEqual(normalized["quotes"][0]["viral_reason"], "结论颠覆")
        self.assertEqual(normalized["quotes"][0]["share_scenario"], "评论区引用")
        self.assertEqual(normalized["quotes"][0]["text"], "在未来的时代，算力就等同于工业时代的煤炭")
        self.assertTrue(any(item["field"] == "visual_hook.type" for item in service.last_normalization_warnings))
        self.assertTrue(any(item["field"] == "quotes[0].text" for item in service.last_normalization_warnings))

    def test_step2_auto_maps_packaging_and_semantic_literals(self) -> None:
        service = AnalyzerService(
            SimpleNamespace(
                qwen_mock_mode=False,
                qwen_api_key="test-key",
                video_analysis_llm_model="test-model",
                video_analysis_llm_url="https://example.invalid",
                http_timeout_seconds=3,
            ),
            Path("/tmp/not-used-prompt.txt"),
        )

        normalized = service._normalize_payload_for_schema(
            Step2Output,
            {
                "packaging": {
                    "title_formulas": ["悬念式", "数字冲击式", "身份代入式"],
                    "title_hook_words": [],
                    "primary_psychology": "焦虑",
                    "secondary_psychology": "好奇",
                    "keywords": [],
                    "keyword_density": "高",
                    "seo_friendly": True,
                    "cover_text": None,
                    "cover_relation": "重复",
                    "visual_emotion": "焦虑",
                    "color_scheme": None,
                    "typography_emotion": "冲击",
                },
                "semantic": {
                    "psychological_triggers": ["恐惧诉求"],
                    "rhetorical_devices": [{"type": "数字对比", "text_snippet": "a", "time_range": {"start": "00:00", "end": "00:10"}, "mechanism": "m"}],
                    "tone_tags": ["硬核", "警示", "理性"],
                    "net_slang": [],
                    "persona_catchphrases": [],
                    "interaction_designs": [
                        {"type": "悬念引导", "trigger_text": "x", "time": "00:05", "expected_response": "y", "placement_strategy": "标题/封面引流"},
                        {"type": "下期预告", "trigger_text": "x", "time": "00:20", "expected_response": "y", "placement_strategy": "中段留人"},
                    ],
                    "knowledge_density_curve": [],
                    "cognitive_load": "中",
                    "overload_warnings": [],
                    "emotion_curve": [],
                },
            },
        )

        self.assertEqual(normalized["packaging"]["title_formulas"], ["悬念式", "数字式", "悬念式"])
        self.assertEqual(normalized["semantic"]["rhetorical_devices"][0]["type"], "权威背书")
        self.assertEqual(normalized["semantic"]["tone_tags"], ["专业", "犀利", "权威"])
        self.assertEqual(normalized["semantic"]["interaction_designs"][0]["type"], "弹幕提问")
        self.assertEqual(normalized["semantic"]["interaction_designs"][0]["placement_strategy"], "开头引流")
        self.assertEqual(normalized["semantic"]["interaction_designs"][1]["type"], "转发金句")
        self.assertEqual(normalized["semantic"]["interaction_designs"][1]["placement_strategy"], "中部留存")
        self.assertTrue(any(item["field"] == "packaging.title_formulas[1]" for item in service.last_normalization_warnings))
        self.assertTrue(any(item["field"] == "semantic.tone_tags[2]" for item in service.last_normalization_warnings))

    def test_structure_and_semantic_models_allow_free_text_on_relaxed_fields(self) -> None:
        structure = StructureExtract.model_validate(
            {
                "visual_hook": None,
                "promise_hook": None,
                "segment_hooks": [],
                "narrative_arc": [],
                "narrative_curve_text": None,
                "structural_blocks": {"meat": []},
                "quotes": [],
                "cta": {"text": "下期见", "time": "00:10", "cta_type": "悬念引导"},
                "logic_flow": "宏观矛盾-背景动因-历史对比-投资拆解-风险推演-个体悬念",
            }
        )
        semantic = Step2Output.model_validate(
            {
                "packaging": {
                    "title_formulas": ["悬念式"],
                    "title_hook_words": [],
                    "primary_psychology": "焦虑",
                    "secondary_psychology": "好奇",
                    "keywords": [],
                    "keyword_density": "高",
                    "seo_friendly": True,
                    "cover_text": None,
                    "cover_relation": "重复",
                    "visual_emotion": "焦虑",
                    "color_scheme": None,
                    "typography_emotion": "冲击",
                },
                "semantic": {
                    "psychological_triggers": ["恐惧诉求"],
                    "rhetorical_devices": [{"type": "数字对比", "text_snippet": "a", "time_range": {"start": "00:00", "end": "00:05"}, "mechanism": "m"}],
                    "tone_tags": ["硬核", "警示", "理性"],
                    "net_slang": [],
                    "persona_catchphrases": [],
                    "interaction_designs": [{"type": "悬念引导", "trigger_text": "x", "time": "00:05", "expected_response": "y", "placement_strategy": "标题/封面引流"}],
                    "knowledge_density_curve": [],
                    "cognitive_load": "中",
                    "overload_warnings": [],
                    "emotion_curve": [],
                },
            }
        )

        self.assertEqual(structure.cta.cta_type, "悬念引导")
        self.assertEqual(structure.logic_flow, "宏观矛盾-背景动因-历史对比-投资拆解-风险推演-个体悬念")
        self.assertEqual(semantic.semantic.rhetorical_devices[0].type, "数字对比")
        self.assertEqual(semantic.semantic.tone_tags, ["硬核", "警示", "理性"])
        self.assertEqual(semantic.semantic.interaction_designs[0].placement_strategy, "标题/封面引流")
        self.assertEqual(semantic.semantic.cognitive_load, "中")

    def test_packaging_and_cognitive_load_allow_free_text(self) -> None:
        semantic = Step2Output.model_validate(
            {
                "packaging": {
                    "title_formulas": ["身份代入式", "数字冲击式"],
                    "title_hook_words": ["大放水"],
                    "primary_psychology": "复杂焦虑",
                    "secondary_psychology": "政策好奇",
                    "keywords": ["7万亿"],
                    "keyword_density": "中高",
                    "seo_friendly": True,
                    "cover_text": "封面文案",
                    "cover_relation": "重复偏互补",
                    "visual_emotion": "宏大压迫感",
                    "color_scheme": ["深蓝"],
                    "typography_emotion": "强冲击",
                },
                "semantic": {
                    "psychological_triggers": ["权威效应"],
                    "rhetorical_devices": [],
                    "tone_tags": ["硬核", "警示"],
                    "net_slang": [],
                    "persona_catchphrases": [],
                    "interaction_designs": [],
                    "knowledge_density_curve": [],
                    "cognitive_load": "中高",
                    "overload_warnings": [],
                    "emotion_curve": [],
                },
            }
        )

        self.assertEqual(semantic.packaging.title_formulas, ["身份代入式", "数字冲击式"])
        self.assertEqual(semantic.packaging.primary_psychology, "复杂焦虑")
        self.assertEqual(semantic.packaging.keyword_density, "中高")
        self.assertEqual(semantic.packaging.cover_relation, "重复偏互补")
        self.assertEqual(semantic.packaging.visual_emotion, "宏大压迫感")
        self.assertEqual(semantic.packaging.typography_emotion, "强冲击")
        self.assertEqual(semantic.semantic.cognitive_load, "中高")


def _source(transcript_text: str | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        id="source-1",
        normalized_bvid="BV1test",
        normalized_url="https://www.bilibili.com/video/BV1test",
        title=None,
        author_name=None,
        author_mid=None,
        cover_url=None,
        duration_seconds=None,
        publish_time=None,
        subtitle_status="PENDING",
        transcript_status="PENDING",
        transcript_source=None,
        subtitle_text=None,
        transcript_text=transcript_text,
        fetch_error_message=None,
    )


def _snapshot() -> SimpleNamespace:
    return SimpleNamespace(
        bvid="BV1test",
        cid=123,
        title="测试视频",
        author_name=None,
        author_mid=None,
        cover_url=None,
        duration_seconds=120,
        publish_time=None,
        subtitle_tracks=[],
    )


def _job() -> SimpleNamespace:
    return SimpleNamespace(id="job-1", video_source_id="source-1")


def _json_response(payload: dict[str, Any]) -> SimpleNamespace:
    return SimpleNamespace(raise_for_status=lambda: None, json=lambda: payload)


if __name__ == "__main__":
    unittest.main()
