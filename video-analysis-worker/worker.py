from __future__ import annotations

import time
from pathlib import Path
from typing import Any

from config import load_config
from db import ClaimedJob, Database, VideoSourceRecord
from logging_utils import init_logger, log_event
from services.analyzer import AnalyzerService
from services.asr import AsrService
from services.bilibili import BilibiliService, VideoSnapshot
from services.subtitle import SubtitleFetchError, SubtitleService, SubtitleUnavailableError


class PublicWorkerError(RuntimeError):
    def __init__(self, public_message: str, *, cause: Exception | None = None):
        super().__init__(public_message)
        self.public_message = public_message
        self.cause = cause


def main() -> None:
    config = load_config()
    logger = init_logger(config.log_file_path, config.log_level)
    db = Database(config.database_dsn)
    bilibili = BilibiliService(config)
    subtitle_service = SubtitleService(config)
    asr_service = AsrService(config)
    analyzer = AnalyzerService(
        config,
        Path(__file__).resolve().parent / "prompts" / "video_analysis_prompt.txt",
    )

    log_event(
        logger,
        "info",
        "worker.started",
        workerId=config.worker_id,
        envFiles=config.loaded_env_paths,
        configFile=config.config_file_path,
        qwenMockMode=config.qwen_mock_mode,
    )

    while True:
        job = db.claim_pending_job(config.worker_id)
        if not job:
            time.sleep(config.poll_interval_seconds)
            continue

        process_job(logger, db, bilibili, subtitle_service, asr_service, analyzer, job)


def process_job(
    logger: Any,
    db: Database,
    bilibili: BilibiliService,
    subtitle_service: SubtitleService,
    asr_service: AsrService,
    analyzer: AnalyzerService,
    job: ClaimedJob,
) -> None:
    log_event(logger, "info", "job.claimed", jobId=job.id, sourceId=job.video_source_id)
    source = db.get_video_source(job.video_source_id)
    if not source:
        db.mark_job_failed(job.id, "视频源不存在")
        log_event(logger, "error", "job.failed.missing_source", jobId=job.id, sourceId=job.video_source_id)
        return

    try:
        snapshot = load_snapshot(db, source, bilibili)
        sync_source_metadata(db, source, snapshot)
        transcript_text = resolve_transcript(db, source, snapshot, bilibili, subtitle_service, asr_service)
        analysis = analyzer.analyze(
            title=snapshot.title,
            transcript_text=transcript_text,
            duration_seconds=snapshot.duration_seconds,
        )
        db.mark_job_ready(
            job.id,
            summary=analysis.summary,
            structure_sections=analysis.structure_sections,
            highlights=analysis.highlights,
            copy_suggestions=analysis.copy_suggestions,
            model_name=analysis.model_name,
            prompt_version=analysis.prompt_version,
        )
        log_event(logger, "info", "job.completed", jobId=job.id, sourceId=source.id, modelName=analysis.model_name)
    except PublicWorkerError as exc:
        db.mark_job_failed(job.id, exc.public_message)
        log_event(
            logger,
            "error",
            "job.failed.public",
            jobId=job.id,
            sourceId=source.id,
            errorMessage=exc.public_message,
            cause=exc.cause,
        )
    except Exception as exc:
        db.mark_job_failed(job.id, "视频分析任务执行失败")
        log_event(
            logger,
            "error",
            "job.failed.unexpected",
            jobId=job.id,
            sourceId=source.id,
            errorMessage="视频分析任务执行失败",
            cause=exc,
        )


def load_snapshot(db: Database, source: VideoSourceRecord, bilibili: BilibiliService) -> VideoSnapshot:
    try:
        return bilibili.fetch_video_snapshot(source.normalized_bvid)
    except Exception as exc:
        db.update_video_source(source.id, fetchErrorMessage=str(exc))
        raise PublicWorkerError("视频元信息抓取失败", cause=exc) from exc


def sync_source_metadata(db: Database, source: VideoSourceRecord, snapshot: VideoSnapshot) -> None:
    db.update_video_source(
        source.id,
        normalizedUrl=source.normalized_url or f"https://www.bilibili.com/video/{snapshot.bvid}",
        title=snapshot.title,
        authorName=snapshot.author_name,
        authorMid=snapshot.author_mid,
        coverUrl=snapshot.cover_url,
        durationSeconds=snapshot.duration_seconds,
        publishTime=snapshot.publish_time,
        fetchErrorMessage=None,
    )


def resolve_transcript(
    db: Database,
    source: VideoSourceRecord,
    snapshot: VideoSnapshot,
    bilibili: BilibiliService,
    subtitle_service: SubtitleService,
    asr_service: AsrService,
) -> str:
    cached_transcript = (source.transcript_text or "").strip()
    if cached_transcript:
        return cached_transcript

    try:
        subtitle_text = subtitle_service.fetch_text(snapshot.subtitle_tracks)
        db.update_video_source(
            source.id,
            subtitleStatus="READY",
            transcriptStatus="READY",
            transcriptSource="SUBTITLE",
            subtitleText=subtitle_text,
            transcriptText=subtitle_text,
            fetchErrorMessage=None,
        )
        return subtitle_text
    except SubtitleUnavailableError:
        db.update_video_source(source.id, subtitleStatus="UNAVAILABLE", subtitleText=None)
    except SubtitleFetchError as exc:
        db.update_video_source(
            source.id,
            subtitleStatus="FAILED",
            transcriptStatus="FAILED",
            transcriptSource=None,
            transcriptText=None,
            fetchErrorMessage=str(exc),
        )
        raise PublicWorkerError("字幕抓取失败", cause=exc) from exc
    except Exception as exc:
        db.update_video_source(
            source.id,
            subtitleStatus="FAILED",
            transcriptStatus="FAILED",
            transcriptSource=None,
            transcriptText=None,
            fetchErrorMessage="字幕抓取异常",
        )
        raise PublicWorkerError("字幕抓取失败", cause=exc) from exc

    try:
        audio_url = bilibili.fetch_audio_url(snapshot.bvid, snapshot.cid)
        transcript_text = asr_service.transcribe(
            bvid=snapshot.bvid,
            title=snapshot.title,
            audio_url=audio_url,
            duration_seconds=snapshot.duration_seconds,
        )
        db.update_video_source(
            source.id,
            transcriptStatus="READY",
            transcriptSource="ASR",
            transcriptText=transcript_text,
            fetchErrorMessage=None,
        )
        return transcript_text
    except Exception as exc:
        db.update_video_source(
            source.id,
            transcriptStatus="FAILED",
            transcriptSource=None,
            transcriptText=None,
            fetchErrorMessage=str(exc),
        )
        raise PublicWorkerError("音频转写失败", cause=exc) from exc


if __name__ == "__main__":
    main()
