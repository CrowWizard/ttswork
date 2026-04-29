from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Json


UNSET = object()


@dataclass(slots=True)
class ClaimedJob:
    id: str
    user_id: str
    video_source_id: str
    status: str
    created_at: datetime


@dataclass(slots=True)
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
        WITH candidate AS (
            SELECT id
            FROM "VideoAnalysisJob"
            WHERE status = 'PENDING'
            ORDER BY "createdAt" ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        UPDATE "VideoAnalysisJob" AS job
        SET status = 'PROCESSING',
            "workerId" = %(worker_id)s,
            "lockedAt" = NOW(),
            "updatedAt" = NOW()
        FROM candidate
        WHERE job.id = candidate.id
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
        model_name: str,
        prompt_version: str,
    ) -> None:
        query = """
        UPDATE "VideoAnalysisJob"
        SET status = 'READY',
            summary = %(summary)s,
            "structureSections" = %(structure_sections)s,
            highlights = %(highlights)s,
            "copySuggestions" = %(copy_suggestions)s,
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
            "structure_sections": Json(structure_sections),
            "highlights": Json(highlights),
            "copy_suggestions": Json(copy_suggestions),
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
            "completedAt" = NOW(),
            "updatedAt" = NOW()
        WHERE id = %(job_id)s
        """

        with self._connect() as conn:
            conn.execute(query, {"job_id": job_id, "error_message": error_message})
            conn.commit()

    def _connect(self) -> psycopg.Connection[Any]:
        return psycopg.connect(self._dsn, row_factory=dict_row)


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
