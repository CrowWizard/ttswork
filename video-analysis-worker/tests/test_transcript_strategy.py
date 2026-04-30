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

analyzer_stub = ModuleType("services.analyzer")
class AnalysisResultFormatError(RuntimeError):
    pass


analyzer_stub.AnalysisResultFormatError = AnalysisResultFormatError
analyzer_stub.AnalyzerService = object
sys.modules.setdefault("services.analyzer", analyzer_stub)

asr_stub = ModuleType("services.asr")
asr_stub.AsrService = object
sys.modules.setdefault("services.asr", asr_stub)

bilibili_stub = ModuleType("services.bilibili")
bilibili_stub.BilibiliService = object
bilibili_stub.SubtitleTrack = object
bilibili_stub.VideoSnapshot = object
sys.modules.setdefault("services.bilibili", bilibili_stub)

from services.subtitle import SubtitleFetchError, SubtitleUnavailableError
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
        if isinstance(self._result, Exception):
            raise self._result

        return self._result


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
        self.called = True
        if isinstance(self._result, Exception):
            raise self._result

        return self._result


class FakeLogger:
    def log(self, *args: Any, **kwargs: Any) -> None:
        return None


class FakeProcessDb(FakeDb):
    def __init__(self, source: SimpleNamespace | None = None) -> None:
        super().__init__()
        self._source = source or _source(transcript_text="已缓存转写")
        self.ready_payload: dict[str, Any] | None = None
        self.failed_payload: dict[str, Any] | None = None

    def get_video_source(self, source_id: str) -> SimpleNamespace | None:
        return self._source

    def mark_job_ready(self, job_id: str, **fields: Any) -> None:
        self.ready_payload = {"job_id": job_id, **fields}

    def mark_job_failed(self, job_id: str, error_message: str) -> None:
        self.failed_payload = {"job_id": job_id, "error_message": error_message}


class FakeSnapshotBilibiliService:
    def fetch_video_snapshot(self, bvid: str) -> SimpleNamespace:
        return _snapshot()


class FakeAnalyzer:
    def __init__(self, result: SimpleNamespace | Exception) -> None:
        self._result = result

    def analyze(self, **kwargs: Any) -> SimpleNamespace:
        if isinstance(self._result, Exception):
            raise self._result

        return self._result


class TranscriptStrategyTest(unittest.TestCase):
    def test_uses_subtitle_without_asr_when_subtitle_is_ready(self) -> None:
        db = FakeDb()
        bilibili = FakeBilibiliService()
        asr = FakeAsrService()

        text = resolve_transcript(
            db,
            _source(),
            _snapshot(),
            bilibili,
            FakeSubtitleService("字幕文本"),
            asr,
        )

        self.assertEqual(text, "字幕文本")
        self.assertFalse(bilibili.audio_called)
        self.assertFalse(asr.called)
        self.assertEqual(db.updates[-1]["subtitleStatus"], "READY")
        self.assertEqual(db.updates[-1]["transcriptSource"], "SUBTITLE")

    def test_uses_asr_only_when_subtitle_is_unavailable(self) -> None:
        db = FakeDb()
        bilibili = FakeBilibiliService()
        asr = FakeAsrService("ASR 转写文本")

        text = resolve_transcript(
            db,
            _source(),
            _snapshot(),
            bilibili,
            FakeSubtitleService(SubtitleUnavailableError("无字幕")),
            asr,
        )

        self.assertEqual(text, "ASR 转写文本")
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
            model_name="mock-model",
            prompt_version="video-analysis-v1",
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
        self.assertEqual(db.ready_payload["model_name"], "mock-model")
        self.assertEqual(db.ready_payload["prompt_version"], "video-analysis-v1")

    def test_process_job_writes_stable_error_for_invalid_analysis_result(self) -> None:
        db = FakeProcessDb()

        process_job(
            FakeLogger(),
            db,
            FakeSnapshotBilibiliService(),
            FakeSubtitleService("不会使用字幕，因为已有缓存转写"),
            FakeAsrService(),
            FakeAnalyzer(AnalysisResultFormatError("分析结果格式不合法")),
            _job(),
        )

        self.assertIsNone(db.ready_payload)
        self.assertEqual(db.failed_payload, {"job_id": "job-1", "error_message": "分析结果格式不合法"})


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


if __name__ == "__main__":
    unittest.main()
