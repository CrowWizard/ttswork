from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import psycopg
from psycopg.rows import dict_row


UNSET = object()


@dataclass
class ClaimedJob:
    id: str
    user_id: str
    video_source_id: str
    status: str
    created_at: datetime


@dataclass
class StageEventRecord:
    id: str
    job_id: str
    stage: str
    status: str
    message: str | None
    details_json: str | None
    started_at: datetime
    completed_at: datetime | None
    duration_ms: int | None


@dataclass
class VideoSourceRecord:
    id: str
    normalized_bvid: str
    normalized_url: str | None
    title: str | None
    author_name: str | None
    author_mid: str | None
    cover_url: str | None
    duration_seconds: float | None
    publish_time: datetime | None
    subtitle_status: str
    transcript_status: str
    transcript_source: str | None
    subtitle_text: str | None
    transcript_text: str | None
    fetch_error_message: str | None


class Database:
    def __init__(self, dsn: str):
        self._dsn = dsn

    def claim_pending_job(self, worker_id: str) -> ClaimedJob | None:
        query = """
        UPDATE "VideoAnalysisJob" AS job
        SET status = 'PROCESSING',
            "workerId" = %(worker_id)s,
            "lockedAt" = NOW(),
            "updatedAt" = NOW()
        WHERE job.id = (
            SELECT candidate.id
            FROM "VideoAnalysisJob" AS candidate
            WHERE candidate.status = 'PENDING'
            ORDER BY candidate."createdAt" ASC
            LIMIT 1
        )
          AND job.status = 'PENDING'
        RETURNING job.id, job."userId", job."videoSourceId", job.status, job."createdAt"
        """

        with self._connect() as conn:
            with conn.transaction():
                row = conn.execute(query, {"worker_id": worker_id}).fetchone()

        return _row_to_claimed_job(row) if row else None

    def get_video_source(self, source_id: str) -> VideoSourceRecord | None:
        query = """
        SELECT
            id,
            "normalizedBvid",
            "normalizedUrl",
            title,
            "authorName",
            "authorMid",
            "coverUrl",
            "durationSeconds",
            "publishTime",
            "subtitleStatus",
            "transcriptStatus",
            "transcriptSource",
            "subtitleText",
            "transcriptText",
            "fetchErrorMessage"
        FROM "VideoSource"
        WHERE id = %(source_id)s
        """

        with self._connect() as conn:
            row = conn.execute(query, {"source_id": source_id}).fetchone()

        return _row_to_video_source(row) if row else None

    def update_video_source(self, source_id: str, **fields: Any) -> None:
        payload = {key: value for key, value in fields.items() if value is not UNSET}
        if not payload:
            return

        assignments = ", ".join(f'"{column}" = %({column})s' for column in payload)
        query = f'''
        UPDATE "VideoSource"
        SET {assignments}, "updatedAt" = NOW()
        WHERE id = %(source_id)s
        '''

        params = dict(payload)
        params["source_id"] = source_id

        with self._connect() as conn:
            conn.execute(query, params)
            conn.commit()

    def mark_job_ready(
        self,
        job_id: str,
        *,
        summary: str,
        structure_sections: list[dict[str, Any]],
        highlights: list[dict[str, Any]],
        copy_suggestions: list[dict[str, Any]],
        health_card: dict[str, Any],
        packaging_analysis: dict[str, Any],
        script_analysis: dict[str, Any],
        semantic_analysis: dict[str, Any],
        internalization_summary: dict[str, Any],
        metadata_json: dict[str, Any],
        model_name: str,
        prompt_version: str,
    ) -> None:
        query = """
        UPDATE "VideoAnalysisJob"
        SET status = 'READY',
            "currentStageStatus" = 'SUCCEEDED',
            summary = %(summary)s,
            "structureSections" = %(structure_sections)s,
            highlights = %(highlights)s,
            "copySuggestions" = %(copy_suggestions)s,
            "healthCard" = %(health_card)s,
            "packagingAnalysis" = %(packaging_analysis)s,
            "scriptAnalysis" = %(script_analysis)s,
            "semanticAnalysis" = %(semantic_analysis)s,
            "internalizationSummary" = %(internalization_summary)s,
            "metadataJson" = %(metadata_json)s,
            "modelName" = %(model_name)s,
            "promptVersion" = %(prompt_version)s,
            "completedAt" = NOW(),
            "errorMessage" = NULL,
            "updatedAt" = NOW()
        WHERE id = %(job_id)s
        """

        params = {
            "job_id": job_id,
            "summary": summary,
            "structure_sections": json.dumps(structure_sections, ensure_ascii=False),
            "highlights": json.dumps(highlights, ensure_ascii=False),
            "copy_suggestions": json.dumps(copy_suggestions, ensure_ascii=False),
            "health_card": json.dumps(health_card, ensure_ascii=False),
            "packaging_analysis": json.dumps(packaging_analysis, ensure_ascii=False),
            "script_analysis": json.dumps(script_analysis, ensure_ascii=False),
            "semantic_analysis": json.dumps(semantic_analysis, ensure_ascii=False),
            "internalization_summary": json.dumps(internalization_summary, ensure_ascii=False),
            "metadata_json": json.dumps(metadata_json, ensure_ascii=False),
            "model_name": model_name,
            "prompt_version": prompt_version,
        }

        with self._connect() as conn:
            conn.execute(query, params)
            conn.commit()

    def mark_job_failed(self, job_id: str, error_message: str) -> None:
        query = """
        UPDATE "VideoAnalysisJob"
        SET status = 'FAILED',
            "errorMessage" = %(error_message)s,
            "currentStageStatus" = 'FAILED',
            "completedAt" = NOW(),
            "updatedAt" = NOW()
        WHERE id = %(job_id)s
        """

        with self._connect() as conn:
            conn.execute(query, {"job_id": job_id, "error_message": error_message})
            conn.commit()

    def _connect(self) -> psycopg.Connection[Any]:
        return psycopg.connect(self._dsn, row_factory=dict_row)

    def start_job_stage(self, job_id: str, stage: str, *, message: str | None = None, details: dict[str, Any] | None = None) -> StageEventRecord:
        query = """
        WITH inserted AS (
            INSERT INTO "VideoAnalysisJobStageEvent" (
                id,
                "jobId",
                stage,
                status,
                message,
                "detailsJson",
                "startedAt",
                "createdAt",
                "updatedAt"
            )
            VALUES (
                %(event_id)s,
                %(job_id)s,
                %(stage)s,
                'RUNNING',
                %(message)s,
                %(details_json)s,
                NOW(),
                NOW(),
                NOW()
            )
            RETURNING id, "jobId", stage, status, message, "detailsJson", "startedAt", "completedAt", "durationMs"
        )
        UPDATE "VideoAnalysisJob" AS job
        SET "currentStage" = %(stage)s,
            "currentStageStatus" = 'RUNNING',
            "currentStageMessage" = %(message)s,
            "currentStageStartedAt" = NOW(),
            "updatedAt" = NOW()
        FROM inserted
        WHERE job.id = inserted."jobId"
        RETURNING inserted.id, inserted."jobId", inserted.stage, inserted.status, inserted.message, inserted."detailsJson", inserted."startedAt", inserted."completedAt", inserted."durationMs"
        """

        params = {
            "job_id": job_id,
            "event_id": str(uuid.uuid4()),
            "stage": stage,
            "message": message,
            "details_json": _json_dumps_or_none(details),
        }

        with self._connect() as conn:
            row = conn.execute(query, params).fetchone()
            conn.commit()

        if not row:
            raise RuntimeError(f"failed to start stage event for job {job_id}")

        return _row_to_stage_event(row)

    def finish_job_stage(
        self,
        event_id: str,
        *,
        status: str,
        message: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        query = """
        WITH updated AS (
            UPDATE "VideoAnalysisJobStageEvent"
            SET status = %(status)s,
                message = COALESCE(%(message)s, message),
                "detailsJson" = COALESCE(%(details_json)s, "detailsJson"),
                "completedAt" = NOW(),
                "durationMs" = GREATEST(CAST(FLOOR(EXTRACT(EPOCH FROM (NOW() - "startedAt")) * 1000) AS INTEGER), 0),
                "updatedAt" = NOW()
            WHERE id = %(event_id)s
            RETURNING id, "jobId", stage, status, message, "detailsJson", "startedAt", "completedAt", "durationMs"
        )
        UPDATE "VideoAnalysisJob" AS job
        SET "currentStage" = updated.stage,
            "currentStageStatus" = updated.status,
            "currentStageMessage" = COALESCE(updated.message, job."currentStageMessage"),
            "currentStageStartedAt" = updated."startedAt",
            "updatedAt" = NOW()
        FROM updated
        WHERE job.id = updated."jobId"
        """

        params = {
            "event_id": event_id,
            "status": status,
            "message": message,
            "details_json": _json_dumps_or_none(details),
        }

        with self._connect() as conn:
            conn.execute(query, params)
            conn.commit()


def _row_to_claimed_job(row: dict[str, Any]) -> ClaimedJob:
    return ClaimedJob(
        id=row["id"],
        user_id=row["userId"],
        video_source_id=row["videoSourceId"],
        status=row["status"],
        created_at=row["createdAt"],
    )


def _row_to_video_source(row: dict[str, Any]) -> VideoSourceRecord:
    return VideoSourceRecord(
        id=row["id"],
        normalized_bvid=row["normalizedBvid"],
        normalized_url=row["normalizedUrl"],
        title=row["title"],
        author_name=row["authorName"],
        author_mid=row["authorMid"],
        cover_url=row["coverUrl"],
        duration_seconds=row["durationSeconds"],
        publish_time=row["publishTime"],
        subtitle_status=row["subtitleStatus"],
        transcript_status=row["transcriptStatus"],
        transcript_source=row["transcriptSource"],
        subtitle_text=row["subtitleText"],
        transcript_text=row["transcriptText"],
        fetch_error_message=row["fetchErrorMessage"],
    )


def _row_to_stage_event(row: dict[str, Any]) -> StageEventRecord:
    return StageEventRecord(
        id=row["id"],
        job_id=row["jobId"],
        stage=row["stage"],
        status=row["status"],
        message=row["message"],
        details_json=row["detailsJson"],
        started_at=row["startedAt"],
        completed_at=row["completedAt"],
        duration_ms=row["durationMs"],
    )


def _json_dumps_or_none(value: dict[str, Any] | None) -> str | None:
    if value is None:
        return None

    return json.dumps(value, ensure_ascii=False)
