import {
  ContentGenerationJobStatus,
  ContentGenerationStage,
  Prisma,
  VideoAnalysisStageEventStatus,
} from "@prisma/client";
import { prisma } from "../../lib/prisma";

export const contentGenerationWorkerJobSelect = {
  id: true,
  userId: true,
  status: true,
  errorMessage: true,
  topicInput: true,
  type: true,
  platform: true,
  language: true,
  tone: true,
  verbosity: true,
  duration: true,
  generateShots: true,
  heroOpening: true,
  outroClosing: true,
  retryCount: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ContentGenerationJobSelect;

export type ContentGenerationWorkerJob = Prisma.ContentGenerationJobGetPayload<{ select: typeof contentGenerationWorkerJobSelect }>;

export async function claimNextContentGenerationJob(workerId: string) {
  const now = new Date();
  const job = await prisma.contentGenerationJob.findFirst({
    where: {
      status: ContentGenerationJobStatus.PENDING,
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (!job) return null;

  const updated = await prisma.contentGenerationJob.updateMany({
    where: { id: job.id, status: ContentGenerationJobStatus.PENDING },
    data: {
      status: ContentGenerationJobStatus.PROCESSING,
      workerId,
      lockedAt: now,
      currentStage: null,
      currentStageStatus: null,
      currentStageMessage: null,
      currentStageStartedAt: null,
    },
  });

  if (updated.count !== 1) return null;

  return prisma.contentGenerationJob.findUnique({
    where: { id: job.id },
    select: contentGenerationWorkerJobSelect,
  });
}

export async function startContentGenerationStage(params: {
  jobId: string;
  stage: ContentGenerationStage;
  label: string;
  message: string;
  details?: unknown;
}) {
  const startedAt = new Date();
  const event = await prisma.contentGenerationStageEvent.create({
    data: {
      jobId: params.jobId,
      stage: params.stage,
      status: VideoAnalysisStageEventStatus.RUNNING,
      label: params.label,
      message: params.message,
      detailsJson: params.details === undefined ? null : JSON.stringify(params.details),
      startedAt,
    },
    select: { id: true, startedAt: true },
  });

  await prisma.contentGenerationJob.update({
    where: { id: params.jobId },
    data: {
      currentStage: params.stage,
      currentStageStatus: VideoAnalysisStageEventStatus.RUNNING,
      currentStageMessage: params.message,
      currentStageStartedAt: startedAt,
    },
  });

  return event;
}

export async function finishContentGenerationStage(params: {
  jobId: string;
  eventId: string;
  stage: ContentGenerationStage;
  status: VideoAnalysisStageEventStatus;
  message: string;
  details?: unknown;
}) {
  const completedAt = new Date();
  const event = await prisma.contentGenerationStageEvent.findUnique({
    where: { id: params.eventId },
    select: { startedAt: true },
  });
  const durationMs = event ? completedAt.getTime() - event.startedAt.getTime() : null;

  await prisma.contentGenerationStageEvent.update({
    where: { id: params.eventId },
    data: {
      status: params.status,
      message: params.message,
      detailsJson: params.details === undefined ? undefined : JSON.stringify(params.details),
      completedAt,
      durationMs,
    },
  });

  await prisma.contentGenerationJob.update({
    where: { id: params.jobId },
    data: {
      currentStage: params.stage,
      currentStageStatus: params.status,
      currentStageMessage: params.message,
    },
  });
}

export async function writeContentGenerationPartial(jobId: string, data: Prisma.ContentGenerationJobUpdateInput) {
  return prisma.contentGenerationJob.update({ where: { id: jobId }, data });
}

export async function markContentGenerationReady(jobId: string, data: Prisma.ContentGenerationJobUpdateInput) {
  return prisma.contentGenerationJob.update({
    where: { id: jobId },
    data: {
      ...data,
      status: ContentGenerationJobStatus.READY,
      completedAt: new Date(),
      lockedAt: null,
    },
  });
}

export async function markContentGenerationFailed(jobId: string, message: string) {
  return prisma.contentGenerationJob.update({
    where: { id: jobId },
    data: {
      status: ContentGenerationJobStatus.FAILED,
      errorMessage: message,
      currentStage: ContentGenerationStage.FAILED_WRITEBACK,
      currentStageStatus: VideoAnalysisStageEventStatus.FAILED,
      currentStageMessage: message,
      completedAt: new Date(),
      lockedAt: null,
    },
  });
}

export async function loadContentGenerationProgressLog(jobId: string) {
  const events = await prisma.contentGenerationStageEvent.findMany({
    where: { jobId, status: VideoAnalysisStageEventStatus.SUCCEEDED },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { stage: true, message: true, completedAt: true, createdAt: true },
  });

  return events.map((event) => ({
    step: event.stage.toLowerCase(),
    ts: (event.completedAt ?? event.createdAt).getTime(),
    message: event.message ?? event.stage,
  }));
}
