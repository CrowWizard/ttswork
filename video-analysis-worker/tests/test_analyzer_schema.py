from __future__ import annotations

import json
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

from services.analyzer import (
    AnalysisResultFormatError,
    AnalyzerService,
    PROMPT_VERSION,
    StructureBlockDetail,
    StructureBlockSuggestion,
    StructuralBlocksOutput,
    StructureExtract,
    _convert_string_range_to_block_detail,
    _derive_structure_sections,
    _ensure_block_detail,
)


class AnalyzerSchemaTest(unittest.TestCase):
    def test_valid_complete_structure_json_is_accepted(self) -> None:
        service = _service_with_payload(_valid_structure_payload())

        result = service._call_json_model("prompt", StructureExtract, 0.2, step="test")

        self.assertEqual(result.logic_flow, "问题-解决方案")
        self.assertEqual(PROMPT_VERSION, "video-analysis-v3")

    def test_new_structural_blocks_format_is_accepted(self) -> None:
        payload = _valid_structure_payload()
        payload["structural_blocks"] = {
            "hook": {
                "name": "开头抓注意力",
                "summary": "用痛点问题快速建立观看动机。",
                "strengths": ["开场问题明确"],
                "weaknesses": ["利益承诺偏晚"],
                "suggestions": [{"type": "script", "target_time": "00:05", "content": "补一句看完收益。"}],
            },
            "promise": None,
            "meat": [
                {
                    "name": "主体内容 1",
                    "summary": "解释主要观点。",
                    "strengths": ["步骤完整"],
                    "weaknesses": ["概念较多"],
                    "suggestions": [{"type": "pacing", "target_time": "00:48", "content": "插入例子。"}],
                },
            ],
            "re_hook": None,
            "cta": None,
        }
        service = _service_with_payload(payload)

        result = service._call_json_model("prompt", StructureExtract, 0.2, step="test")
        self.assertEqual(result.structural_blocks.hook.name, "开头抓注意力")
        self.assertEqual(result.structural_blocks.hook.summary, "用痛点问题快速建立观看动机。")
        self.assertEqual(len(result.structural_blocks.meat), 1)
        self.assertEqual(result.structural_blocks.meat[0].suggestions[0].type, "pacing")

    def test_structure_accepts_free_text_labels(self) -> None:
        payload = _valid_structure_payload()
        payload["visual_hook"]["type"] = "宏观冲突"
        payload["segment_hooks"] = [
            {"time": "02:10", "text": "真正的问题在后面", "function": "历史铺垫", "hook_score": 8},
        ]
        payload["quotes"] = [
            {
                "text": "化债不是终点",
                "time": "08:40",
                "viral_reason": "数据冲击",
                "screenshot_friendly": True,
                "share_scenario": "财经群讨论",
            }
        ]
        service = _service_with_payload(payload)

        result = service._call_json_model("prompt", StructureExtract, 0.2, step="test")

        self.assertEqual(result.visual_hook.type, "宏观冲突")
        self.assertEqual(result.segment_hooks[0].function, "历史铺垫")
        self.assertEqual(result.quotes[0].viral_reason, "数据冲击")
        self.assertEqual(result.quotes[0].share_scenario, "财经群讨论")

    def test_missing_required_field_raises_stable_format_error(self) -> None:
        payload = _valid_structure_payload()
        payload.pop("logic_flow")
        service = _service_with_payload(payload)

        with self.assertRaises(AnalysisResultFormatError):
            service._call_json_model("prompt", StructureExtract, 0.2, step="test")

    def test_extra_field_raises_stable_format_error(self) -> None:
        payload = _valid_structure_payload()
        payload["unexpected"] = True
        service = _service_with_payload(payload)

        with self.assertRaises(AnalysisResultFormatError):
            service._call_json_model("prompt", StructureExtract, 0.2, step="test")

    def test_stage_specific_model_overrides_default_model(self) -> None:
        payload = _valid_structure_payload()
        service = _service_with_payload(payload)
        service._config.video_analysis_structure_model = "structure-model"
        captured: dict[str, Any] = {}

        def post(*_args: Any, **kwargs: Any) -> SimpleNamespace:
            captured.update(kwargs)
            return _json_response(payload)

        service._session = SimpleNamespace(post=post)

        service._call_json_model("prompt", StructureExtract, 0.2, step="ANALYSIS_STRUCTURE")

        self.assertEqual(captured["json"]["model"], "structure-model")
        self.assertEqual(service.last_used_models["ANALYSIS_STRUCTURE"], "structure-model")


class StructuralBlocksNormalizationTest(unittest.TestCase):
    def test_legacy_string_block_is_converted(self) -> None:
        detail = _convert_string_range_to_block_detail("00:00-00:05", "hook")

        self.assertEqual(detail["name"], "hook")
        self.assertIn("summary", detail)

    def test_legacy_meat_string_array_is_converted(self) -> None:
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
                "visual_hook": None,
                "promise_hook": None,
                "segment_hooks": [],
                "narrative_arc": [],
                "narrative_curve_text": "",
                "structural_blocks": {"hook": "00:00-00:05", "meat": ["00:05-00:30"], "cta": None},
                "quotes": [],
                "cta": None,
                "logic_flow": "递进式",
            },
        )

        blocks = normalized["structural_blocks"]
        self.assertIsInstance(blocks["hook"], dict)
        self.assertEqual(blocks["hook"]["name"], "hook")
        self.assertEqual(len(blocks["meat"]), 1)
        self.assertEqual(blocks["meat"][0]["name"], "主体内容 1")

    def test_re_hook_array_is_merged_to_single_block(self) -> None:
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
                "visual_hook": None,
                "promise_hook": None,
                "segment_hooks": [],
                "narrative_arc": [],
                "narrative_curve_text": "",
                "structural_blocks": {
                    "hook": None,
                    "promise": None,
                    "meat": {"name": "主体", "summary": "主体内容", "strengths": [], "weaknesses": [], "suggestions": []},
                    "re_hook": [
                        {
                            "name": "二次留存 1",
                            "summary": "历史根源段落后用悬念预告留住观众。",
                            "strengths": ["悬念设计有效", "节奏清晰", "冲突明确", "表达直接"],
                            "weaknesses": ["没有阶段性小结"],
                            "suggestions": [{"type": "脚本", "content": "补一句这一轮有什么不同。"}],
                        },
                        {
                            "name": "二次留存 2",
                            "summary": "核心逻辑段落后用认知冲突留住观众。",
                            "strengths": ["冲突感强"],
                            "weaknesses": ["转折稍显突兀"],
                            "suggestions": [{"type": "script", "target_time": "10:40", "content": "补一句这不只是经济问题。"}],
                        },
                    ],
                    "cta": None,
                },
                "quotes": [],
                "cta": None,
                "logic_flow": "递进式",
            },
        )

        blocks = normalized["structural_blocks"]
        self.assertIsInstance(blocks["re_hook"], dict)
        self.assertIn("历史根源段落", blocks["re_hook"]["summary"])
        self.assertEqual(len(blocks["re_hook"]["suggestions"]), 2)
        self.assertEqual(blocks["re_hook"]["suggestions"][0]["type"], "script")
        self.assertEqual(blocks["re_hook"]["suggestions"][0]["target_time"], "00:00")
        self.assertIsInstance(blocks["meat"], list)
        self.assertTrue(any(item["field"] == "structural_blocks.re_hook" for item in service.last_normalization_warnings))

    def test_percentage_calculation_boundary(self) -> None:
        block = StructureBlockDetail(
            name="测试",
            summary="测试",
            suggestions=[StructureBlockSuggestion(type="script", target_time="00:06", content="改法")],
        )

        _ensure_block_detail(block)

        self.assertTrue(block.summary.strip())


class SemanticSectionsStabilityTest(unittest.TestCase):
    def test_many_narrative_arc_items_are_merged_to_stable_limit(self) -> None:
        structure = StructureExtract.model_validate({
            "visual_hook": None,
            "promise_hook": None,
            "segment_hooks": [],
            "narrative_arc": [
                {"time": f"{index:02d}:00", "event": f"节点 {index}"}
                for index in range(10)
            ],
            "narrative_curve_text": "",
            "structural_blocks": {"meat": []},
            "quotes": [],
            "cta": None,
            "logic_flow": "递进式",
        })

        sections = _derive_structure_sections([], structure)

        self.assertLessEqual(len(sections), 8)

    def test_sparse_long_narrative_arc_is_split_to_minimum_sections(self) -> None:
        structure = StructureExtract.model_validate({
            "visual_hook": None,
            "promise_hook": None,
            "segment_hooks": [],
            "narrative_arc": [
                {"time": "00:00", "event": "冲突引入"},
                {"time": "10:00", "event": "总结收束"},
            ],
            "narrative_curve_text": "",
            "structural_blocks": {"meat": []},
            "quotes": [],
            "cta": None,
            "logic_flow": "递进式",
        })

        sections = _derive_structure_sections([], structure)

        self.assertGreaterEqual(len(sections), 5)


class ParagraphSummaryPromptTest(unittest.TestCase):
    def test_paragraph_summary_prompt_defines_summary_content(self) -> None:
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
        captured: dict[str, str] = {}

        def call_json_model(prompt: str, *_args: Any, **_kwargs: Any) -> SimpleNamespace:
            captured["prompt"] = prompt
            return SimpleNamespace(paragraphs=[])

        service._call_json_model = call_json_model  # type: ignore[method-assign]

        service._generate_paragraph_summary("[00:00] 测试字幕")

        prompt = captured["prompt"]
        self.assertIn("summary 内容约束", prompt)
        self.assertIn("本段主要讲什么主题或情节", prompt)
        self.assertIn("核心观点、结论或冲突", prompt)
        self.assertNotIn("作用是", prompt)

    def test_step1_prompt_defines_narrative_arc_event_as_summary(self) -> None:
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
        captured: dict[str, str] = {}

        def call_json_model(prompt: str, *_args: Any, **_kwargs: Any) -> StructureExtract:
            captured["prompt"] = prompt
            return StructureExtract.model_validate(_valid_structure_payload())

        service._call_json_model = call_json_model  # type: ignore[method-assign]

        service._step1_extract_structure("[00:00] 测试字幕", 120)

        prompt = captured["prompt"]
        self.assertIn("narrative_arc.event 内容约束", prompt)
        self.assertIn("本段主要讲什么主题或情节", prompt)
        self.assertIn("不要只写‘冲突引入’‘历史根源’这类事件名", prompt)
        self.assertNotIn("作用是", prompt)


def _service_with_payload(payload: dict[str, Any]) -> AnalyzerService:
    cfg = SimpleNamespace(
        video_analysis_llm_model="model",
        video_analysis_paragraph_model="",
        video_analysis_structure_model="",
        video_analysis_semantic_model="",
        video_analysis_report_model="",
        video_analysis_llm_url="https://example.invalid/v1/chat/completions",
        qwen_api_key="key",
        qwen_mock_mode=False,
        http_timeout_seconds=3,
    )
    service = AnalyzerService(cfg, WORKER_DIR / "missing-prompt.txt")
    service._session = SimpleNamespace(post=lambda *_args, **_kwargs: _json_response(payload))
    return service


def _json_response(payload: dict[str, Any]) -> SimpleNamespace:
    body = {"choices": [{"message": {"content": json.dumps(payload, ensure_ascii=False)}}]}
    return SimpleNamespace(raise_for_status=lambda: None, json=lambda: body)


def _valid_structure_payload() -> dict[str, Any]:
    return {
        "visual_hook": {
            "text": "开头问题",
            "time": "00:00",
            "type": "痛点提问",
            "mechanism": "快速建立问题意识",
            "hook_score": 7,
        },
        "promise_hook": None,
        "segment_hooks": [],
        "narrative_arc": [{"time": "00:00", "event": "主题引入"}],
        "narrative_curve_text": "00:00 [主题引入] 开头问题",
"structural_blocks": {
            "hook": {
                "name": "开头抓注意力",
                "summary": "用开头问题吸引观众。",
                "strengths": ["问题明确"],
                "weaknesses": [],
                "suggestions": [],
            },
            "promise": None,
            "meat": [],
            "re_hook": None,
            "cta": None,
        },
        "quotes": [],
        "cta": None,
        "logic_flow": "问题-解决方案",
    }


if __name__ == "__main__":
    unittest.main()
