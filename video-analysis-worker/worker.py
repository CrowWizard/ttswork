from __future__ import annotations

import time
from pathlib import Path
from typing import Any

from config import load_config
from db import ClaimedJob, Database, VideoSourceRecord
from logging_utils import init_logger, log_event
from services.analyzer import AnalysisResultFormatError, AnalyzerService
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
        log_event(logger, "debug", "poll.tick", workerId=config.worker_id)
        job = db.claim_pending_job(config.worker_id)
        if not job:
            log_event(
                logger,
                "debug",
                "poll.no_pending_job",
                workerId=config.worker_id,
                sleepSeconds=config.poll_interval_seconds,
            )
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
    job_started_at = time.monotonic()
    source = _run_stage(
        logger,
        "source.load",
        job_id=job.id,
        source_id=job.video_source_id,
        action=lambda: db.get_video_source(job.video_source_id),
    )
    if not source:
        db.mark_job_failed(job.id, "视频源不存在")
        log_event(
            logger,
            "error",
            "job.failed.missing_source",
            jobId=job.id,
            sourceId=job.video_source_id,
            durationMs=_elapsed_ms(job_started_at),
        )
        return

    log_event(
        logger,
        "debug",
        "job.source.loaded",
        jobId=job.id,
        sourceId=source.id,
        normalizedBvid=source.normalized_bvid,
        subtitleStatus=source.subtitle_status,
        transcriptStatus=source.transcript_status,
        transcriptSource=source.transcript_source,
        hasCachedTranscript=bool((source.transcript_text or "").strip()),
    )

    try:
        snapshot = _run_stage(
            logger,
            "bilibili.snapshot",
            job_id=job.id,
            source_id=source.id,
            action=lambda: load_snapshot(db, source, bilibili),
            normalizedBvid=source.normalized_bvid,
        )
        log_event(
            logger,
            "debug",
            "job.snapshot.loaded",
            jobId=job.id,
            sourceId=source.id,
            bvid=snapshot.bvid,
            cid=snapshot.cid,
            title=snapshot.title,
            durationSeconds=snapshot.duration_seconds,
            subtitleTrackCount=len(snapshot.subtitle_tracks),
        )
        _run_stage(
            logger,
            "source.metadata_sync",
            job_id=job.id,
            source_id=source.id,
            action=lambda: sync_source_metadata(db, source, snapshot),
            title=snapshot.title,
            durationSeconds=snapshot.duration_seconds,
        )
        transcript_text = _run_stage(
            logger,
            "transcript.resolve",
            job_id=job.id,
            source_id=source.id,
            action=lambda: resolve_transcript(db, source, snapshot, bilibili, subtitle_service, asr_service, logger=logger),
            subtitleTrackCount=len(snapshot.subtitle_tracks),
            hasCachedTranscript=bool((source.transcript_text or "").strip()),
        )
        log_event(
            logger,
            "debug",
            "job.transcript.ready",
            jobId=job.id,
            sourceId=source.id,
            transcriptLength=len(transcript_text),
        )
        analysis = _run_stage(
            logger,
            "llm.analysis",
            job_id=job.id,
            source_id=source.id,
            action=lambda: analyzer.analyze(
                title=snapshot.title,
                transcript_text=transcript_text,
                duration_seconds=snapshot.duration_seconds,
            ),
            transcriptLength=len(transcript_text),
            title=snapshot.title,
        )
        log_event(
            logger,
            "debug",
            "job.analysis.ready",
            jobId=job.id,
            sourceId=source.id,
            modelName=analysis.model_name,
            promptVersion=analysis.prompt_version,
            structureSectionCount=len(analysis.structure_sections),
            highlightCount=len(analysis.highlights),
            copySuggestionCount=len(analysis.copy_suggestions),
        )
        _run_stage(
            logger,
            "job.ready_writeback",
            job_id=job.id,
            source_id=source.id,
            action=lambda: db.mark_job_ready(
                job.id,
                summary=analysis.summary,
                structure_sections=analysis.structure_sections,
                highlights=analysis.highlights,
                copy_suggestions=analysis.copy_suggestions,
                model_name=analysis.model_name,
                prompt_version=analysis.prompt_version,
            ),
            modelName=analysis.model_name,
            promptVersion=analysis.prompt_version,
        )
        log_event(
            logger,
            "info",
            "job.completed",
            jobId=job.id,
            sourceId=source.id,
            modelName=analysis.model_name,
            durationMs=_elapsed_ms(job_started_at),
        )
    except AnalysisResultFormatError as exc:
        _mark_job_failed_safely(logger, db, job.id, source.id, "分析结果格式不合法")
        log_event(
            logger,
            "error",
            "job.failed.analysis_format",
            jobId=job.id,
            sourceId=source.id,
            errorMessage="分析结果格式不合法",
            durationMs=_elapsed_ms(job_started_at),
            cause=exc,
        )
    except PublicWorkerError as exc:
        _mark_job_failed_safely(logger, db, job.id, source.id, exc.public_message)
        log_event(
            logger,
            "error",
            "job.failed.public",
            jobId=job.id,
            sourceId=source.id,
            errorMessage=exc.public_message,
            durationMs=_elapsed_ms(job_started_at),
            cause=exc.cause,
        )
    except Exception as exc:
        _mark_job_failed_safely(logger, db, job.id, source.id, "视频分析任务执行失败")
        log_event(
            logger,
            "error",
            "job.failed.unexpected",
            jobId=job.id,
            sourceId=source.id,
            errorMessage="视频分析任务执行失败",
            durationMs=_elapsed_ms(job_started_at),
            cause=exc,
        )


def _run_stage(logger: Any, stage: str, *, job_id: str, source_id: str, action: Any, **context: Any) -> Any:
    started_at = time.monotonic()
    log_event(logger, "debug", "job.stage.start", jobId=job_id, sourceId=source_id, stage=stage, **context)

    try:
        result = action()
    except Exception as exc:
        log_event(
            logger,
            "error",
            "job.stage.failed",
            jobId=job_id,
            sourceId=source_id,
            stage=stage,
            durationMs=_elapsed_ms(started_at),
            cause=exc,
            **context,
        )
        raise

    log_event(
        logger,
        "debug",
        "job.stage.success",
        jobId=job_id,
        sourceId=source_id,
        stage=stage,
        durationMs=_elapsed_ms(started_at),
        **context,
    )
    return result


def _mark_job_failed_safely(logger: Any, db: Database, job_id: str, source_id: str, error_message: str) -> None:
    try:
        _run_stage(
            logger,
            "job.failed_writeback",
            job_id=job_id,
            source_id=source_id,
            action=lambda: db.mark_job_failed(job_id, error_message),
            errorMessage=error_message,
        )
    except Exception as exc:
        log_event(
            logger,
            "error",
            "job.failed_writeback.unexpected",
            jobId=job_id,
            sourceId=source_id,
            errorMessage=error_message,
            cause=exc,
        )


def _elapsed_ms(started_at: float) -> int:
    return int((time.monotonic() - started_at) * 1000)


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
    logger: Any | None = None,
) -> str:
    cached_transcript = (source.transcript_text or "").strip()
    if cached_transcript:
        # 复用弱缓存，避免同一视频重复抓字幕或跑 ASR。
        if logger:
            log_event(
                logger,
                "debug",
                "transcript.cache.hit",
                sourceId=source.id,
                bvid=snapshot.bvid,
                transcriptLength=len(cached_transcript),
            )
        return cached_transcript

    try:
        if logger:
            log_event(
                logger,
                "debug",
                "subtitle.fetch.start",
                sourceId=source.id,
                bvid=snapshot.bvid,
                subtitleTrackCount=len(snapshot.subtitle_tracks),
            )
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
        if logger:
            log_event(
                logger,
                "debug",
                "subtitle.fetch.ready",
                sourceId=source.id,
                bvid=snapshot.bvid,
                subtitleLength=len(subtitle_text),
            )
        return subtitle_text
    except SubtitleUnavailableError:
        db.update_video_source(source.id, subtitleStatus="UNAVAILABLE", subtitleText=None)
        if logger:
            log_event(logger, "debug", "subtitle.fetch.unavailable", sourceId=source.id, bvid=snapshot.bvid)
    except SubtitleFetchError as exc:
        db.update_video_source(
            source.id,
            subtitleStatus="FAILED",
            transcriptStatus="FAILED",
            transcriptSource=None,
            transcriptText=None,
            fetchErrorMessage=str(exc),
        )
        if logger:
            log_event(logger, "debug", "subtitle.fetch.failed", sourceId=source.id, bvid=snapshot.bvid, cause=exc)
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
        if logger:
            log_event(logger, "debug", "subtitle.fetch.unexpected", sourceId=source.id, bvid=snapshot.bvid, cause=exc)
        raise PublicWorkerError("字幕抓取失败", cause=exc) from exc

    try:
        if logger:
            log_event(logger, "debug", "asr.audio_url.fetch.start", sourceId=source.id, bvid=snapshot.bvid, cid=snapshot.cid)
        audio_url = bilibili.fetch_audio_url(snapshot.bvid, snapshot.cid)
        if logger:
            log_event(logger, "debug", "asr.transcribe.start", sourceId=source.id, bvid=snapshot.bvid, audioUrlAvailable=bool(audio_url))
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
        if logger:
            log_event(
                logger,
                "debug",
                "asr.transcribe.ready",
                sourceId=source.id,
                bvid=snapshot.bvid,
                transcriptLength=len(transcript_text),
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
        if logger:
            log_event(logger, "debug", "asr.transcribe.failed", sourceId=source.id, bvid=snapshot.bvid, cause=exc)
        raise PublicWorkerError("音频转写失败", cause=exc) from exc


if __name__ == "__main__":
    main()
