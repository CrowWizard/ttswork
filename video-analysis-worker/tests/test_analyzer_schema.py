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

    def test_percentage_calculation_boundary(self) -> None:
        block = StructureBlockDetail(
            name="测试",
            summary="测试",
            suggestions=[StructureBlockSuggestion(type="script", target_time="00:06", content="改法")],
        )

        _ensure_block_detail(block)

        self.assertTrue(block.summary.strip())


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
