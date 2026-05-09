from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from config import load_config
from db import ClaimedJob, Database, VideoSourceRecord
from logging_utils import init_logger, log_event
from services.analyzer import AnalysisResultFormatError, AnalyzerService
from services.asr import AsrService
from services.audio_storage import AudioStorageService
from services.bilibili import BilibiliService, VideoSnapshot
from services.subtitle import SubtitleFetchError, SubtitleService, SubtitleUnavailableError
from services.transcript import TranscriptPayload


class PublicWorkerError(RuntimeError):
    def __init__(self, public_message: str, *, cause: Exception | None = None):
        super().__init__(public_message)
        self.public_message = public_message
        self.cause = cause


STAGE_DISPLAY_NAMES = {
    "SOURCE_LOAD": "加载视频源",
    "SNAPSHOT_FETCH": "抓取视频信息",
    "METADATA_SYNC": "同步视频元信息",
    "TRANSCRIPT_RESOLVE": "获取字幕或转写",
    "ANALYSIS_PARAGRAPH_SUMMARY": "长字幕压缩分段",
    "ANALYSIS_STRUCTURE": "提取脚本结构",
    "ANALYSIS_SEMANTIC_PACKAGING": "分析包装与语义",
    "ANALYSIS_FINAL_REPORT": "生成最终报告",
    "RESULT_WRITEBACK": "写回分析结果",
    "FAILED_WRITEBACK": "写回失败状态",
}


def main() -> None:
    config = load_config()
    logger = init_logger(config.log_file_path, config.log_level)
    db = Database(config.database_dsn)
    bilibili = BilibiliService(config)
    subtitle_service = SubtitleService(config)
    asr_service = AsrService(config)
    audio_storage_service = AudioStorageService(config)
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

        process_job(logger, db, bilibili, subtitle_service, asr_service, analyzer, job, audio_storage_service)


def process_job(
    logger: Any,
    db: Database,
    bilibili: BilibiliService,
    subtitle_service: SubtitleService,
    asr_service: AsrService,
    analyzer: AnalyzerService,
    job: ClaimedJob,
    audio_storage_service: AudioStorageService | None = None,
) -> None:
    log_event(logger, "info", "job.claimed", jobId=job.id, sourceId=job.video_source_id)
    job_started_at = time.monotonic()
    source = _run_stage(
        logger,
        db,
        "SOURCE_LOAD",
        job_id=job.id,
        source_id=job.video_source_id,
        message="加载视频源",
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
            db,
            "SNAPSHOT_FETCH",
            job_id=job.id,
            source_id=source.id,
            message="抓取视频信息",
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
            db,
            "METADATA_SYNC",
            job_id=job.id,
            source_id=source.id,
            message="同步视频元信息",
            action=lambda: sync_source_metadata(db, source, snapshot),
            title=snapshot.title,
            durationSeconds=snapshot.duration_seconds,
        )
        transcript_payload = _run_stage(
            logger,
            db,
            "TRANSCRIPT_RESOLVE",
            job_id=job.id,
            source_id=source.id,
            message="获取字幕或转写",
            action=lambda: resolve_transcript(
                db,
                source,
                snapshot,
                bilibili,
                subtitle_service,
                asr_service,
                audio_storage_service,
                logger=logger,
            ),
            subtitleTrackCount=len(snapshot.subtitle_tracks),
            hasCachedTranscript=bool((source.transcript_text or "").strip()),
        )
        log_event(
            logger,
            "debug",
            "job.transcript.ready",
            jobId=job.id,
            sourceId=source.id,
            transcriptLength=len(transcript_payload.text),
            timelineLength=len(transcript_payload.timeline_text),
        )
        analysis = analyzer.analyze(
            title=snapshot.title,
            transcript_text=transcript_payload.text,
            timeline_text=transcript_payload.timeline_text,
            duration_seconds=snapshot.duration_seconds,
            cover_url=snapshot.cover_url,
            run_step=lambda stage, message, action, **context: _run_stage(
                logger,
                db,
                stage,
                job_id=job.id,
                source_id=source.id,
                message=message,
                action=action,
                **context,
            ),
        )
        normalization_warnings = analyzer.last_normalization_warnings
        metadata_json = analysis.metadata_json or {}
        health_card = analysis.health_card or {}
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
            keywordCount=len(health_card.get("core_keywords") or []),
            segmentHookCount=len((analysis.script_analysis or {}).get("segment_hooks") or []),
            goldenQuoteCount=metadata_json.get("golden_quote_count"),
            interactionCount=metadata_json.get("interaction_count"),
            riskPointCount=len(metadata_json.get("retention_risk_points") or []),
            normalizationWarningCount=len(normalization_warnings),
            normalizationWarnings=normalization_warnings,
        )
        _run_stage(
            logger,
            db,
            "RESULT_WRITEBACK",
            job_id=job.id,
            source_id=source.id,
            message="写回分析结果",
            action=lambda: db.mark_job_ready(
                job.id,
                summary=analysis.summary,
                structure_sections=analysis.structure_sections,
                highlights=analysis.highlights,
                copy_suggestions=analysis.copy_suggestions,
                health_card=analysis.health_card,
                packaging_analysis=analysis.packaging_analysis,
                script_analysis=analysis.script_analysis,
                semantic_analysis=analysis.semantic_analysis,
                internalization_summary=analysis.internalization_summary,
                metadata_json=analysis.metadata_json,
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
            analysisStep=exc.step,
            schemaName=exc.schema_name,
            responseLength=exc.response_length,
            rawPreview=exc.raw_preview,
            validationErrors=exc.validation_errors,
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


def _run_stage(
    logger: Any,
    db: Database,
    stage: str,
    *,
    job_id: str,
    source_id: str,
    message: str,
    action: Any,
    **context: Any,
) -> Any:
    started_at = time.monotonic()
    stage_event = db.start_job_stage(job_id, stage, message=message, details=_sanitize_stage_details(context))
    log_event(
        logger,
        "debug",
        "job.stage.start",
        jobId=job_id,
        sourceId=source_id,
        stage=stage,
        stageLabel=STAGE_DISPLAY_NAMES.get(stage, stage),
        stageEventId=stage_event.id,
        message=message,
        **context,
    )

    try:
        result = action()
    except Exception as exc:
        failure_details = _build_failure_details(exc, context)
        db.finish_job_stage(
            stage_event.id,
            status="FAILED",
            message=_build_failure_message(message, exc),
            details=failure_details,
        )
        log_event(
            logger,
            "error",
            "job.stage.failed",
            jobId=job_id,
            sourceId=source_id,
            stage=stage,
            stageLabel=STAGE_DISPLAY_NAMES.get(stage, stage),
            stageEventId=stage_event.id,
            durationMs=_elapsed_ms(started_at),
            cause=exc,
            failureDetails=failure_details,
            **context,
        )
        raise

    success_details = _sanitize_stage_details(context)
    db.finish_job_stage(stage_event.id, status="SUCCEEDED", message=f"{message}完成", details=success_details)
    log_event(
        logger,
        "debug",
        "job.stage.success",
        jobId=job_id,
        sourceId=source_id,
        stage=stage,
        stageLabel=STAGE_DISPLAY_NAMES.get(stage, stage),
        stageEventId=stage_event.id,
        durationMs=_elapsed_ms(started_at),
        **context,
    )
    return result


def _mark_job_failed_safely(logger: Any, db: Database, job_id: str, source_id: str, error_message: str) -> None:
    try:
        _run_stage(
            logger,
            db,
            "FAILED_WRITEBACK",
            job_id=job_id,
            source_id=source_id,
            message="写回失败状态",
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


def _sanitize_stage_details(details: dict[str, Any]) -> dict[str, Any]:
    sanitized: dict[str, Any] = {}
    for key, value in details.items():
        if isinstance(value, (str, int, float, bool)) or value is None:
            sanitized[key] = value
            continue

        if isinstance(value, (list, tuple, dict)):
            try:
                json.dumps(value, ensure_ascii=False)
                sanitized[key] = value
                continue
            except TypeError:
                pass

        sanitized[key] = str(value)

    return sanitized


def _build_failure_message(message: str, exc: Exception) -> str:
    if isinstance(exc, AnalysisResultFormatError):
        return f"{message}失败：{exc.step} 返回格式不合法"

    detail = str(exc).strip()
    return f"{message}失败：{detail}" if detail else f"{message}失败"


def _build_failure_details(exc: Exception, context: dict[str, Any]) -> dict[str, Any]:
    details = _sanitize_stage_details(context)
    details["errorName"] = exc.__class__.__name__
    details["errorMessage"] = str(exc)

    if isinstance(exc, AnalysisResultFormatError):
        details["analysisStep"] = exc.step
        details["schemaName"] = exc.schema_name
        details["responseLength"] = exc.response_length
        details["rawPreview"] = exc.raw_preview
        details["validationErrors"] = exc.validation_errors

    return details


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
    audio_storage_service: AudioStorageService | None = None,
    logger: Any | None = None,
) -> TranscriptPayload:
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
        return TranscriptPayload(text=cached_transcript, timeline_text=cached_transcript, duration_seconds=source.duration_seconds)

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
        subtitle_payload = subtitle_service.fetch_payload(snapshot.subtitle_tracks)
        subtitle_text = subtitle_payload.text
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
        return TranscriptPayload(
            text=subtitle_text,
            timeline_text=subtitle_payload.timeline_text,
            duration_seconds=subtitle_payload.duration_seconds or snapshot.duration_seconds,
        )
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
        transcribe_audio_url = audio_url
        if audio_storage_service:
            if logger:
                log_event(logger, "debug", "asr.audio.store.start", sourceId=source.id, bvid=snapshot.bvid, cid=snapshot.cid)
            stored_audio = audio_storage_service.download_and_store(bvid=snapshot.bvid, cid=snapshot.cid, audio_url=audio_url)
            transcribe_audio_url = stored_audio.public_url
            if logger:
                log_event(
                    logger,
                    "debug",
                    "asr.audio.store.ready",
                    sourceId=source.id,
                    bvid=snapshot.bvid,
                    bucket=stored_audio.bucket,
                    objectKey=stored_audio.object_key,
                    sizeBytes=stored_audio.size_bytes,
                    publicUrl=stored_audio.public_url,
                )
        if logger:
            log_event(logger, "debug", "asr.transcribe.start", sourceId=source.id, bvid=snapshot.bvid, audioUrlAvailable=bool(audio_url))
        asr_payload = asr_service.transcribe_payload(
            bvid=snapshot.bvid,
            title=snapshot.title,
            audio_url=transcribe_audio_url,
            duration_seconds=snapshot.duration_seconds,
        )
        transcript_text = asr_payload.text
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
        return TranscriptPayload(
            text=transcript_text,
            timeline_text=asr_payload.timeline_text,
            duration_seconds=asr_payload.duration_seconds or snapshot.duration_seconds,
        )
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
