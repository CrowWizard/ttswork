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

from services.analyzer import AnalysisResultFormatError, AnalyzerService, PROMPT_VERSION, StructureExtract


class AnalyzerSchemaTest(unittest.TestCase):
    def test_valid_complete_structure_json_is_accepted(self) -> None:
        service = _service_with_payload(_valid_structure_payload())

        result = service._call_json_model("prompt", StructureExtract, 0.2)

        self.assertEqual(result.logic_flow, "问题-解决方案")
        self.assertEqual(PROMPT_VERSION, "video-analysis-v3")

    def test_missing_required_field_raises_stable_format_error(self) -> None:
        payload = _valid_structure_payload()
        payload.pop("logic_flow")
        service = _service_with_payload(payload)

        with self.assertRaises(AnalysisResultFormatError):
            service._call_json_model("prompt", StructureExtract, 0.2)

    def test_extra_field_raises_stable_format_error(self) -> None:
        payload = _valid_structure_payload()
        payload["unexpected"] = True
        service = _service_with_payload(payload)

        with self.assertRaises(AnalysisResultFormatError):
            service._call_json_model("prompt", StructureExtract, 0.2)


def _service_with_payload(payload: dict[str, Any]) -> AnalyzerService:
    cfg = SimpleNamespace(
        video_analysis_llm_model="model",
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
        "structural_blocks": {"hook": "00:00-00:05", "promise": None, "meat": ["00:05-00:30"], "re_hook": None, "cta": None},
        "quotes": [],
        "cta": None,
        "logic_flow": "问题-解决方案",
    }


if __name__ == "__main__":
    unittest.main()
