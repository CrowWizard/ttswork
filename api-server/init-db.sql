-- Voice MVP PostgreSQL 18 空库初始化脚本
-- 用法：PGPASSWORD='<密码>' psql -h 127.0.0.1 -U voice_mvp -d voice_mvp -v ON_ERROR_STOP=1 -f api-server/init-db.sql
-- 说明：本脚本只面向新服务器空数据库，不包含旧数据迁移、补列、回填或破坏性结构修改。

BEGIN;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

SET search_path TO "public";

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "RecordingStatus" AS ENUM ('UPLOADED');

-- CreateEnum
CREATE TYPE "VoiceProfileKind" AS ENUM ('PURE', 'SCENE');

-- CreateEnum
CREATE TYPE "TtsJobStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "TtsAccessKind" AS ENUM ('FREE_TRIAL', 'GENERAL_USAGE_CODE', 'USAGE_CODE', 'POINTS');

-- CreateEnum
CREATE TYPE "PointTransactionType" AS ENUM ('REGISTER_BONUS', 'USAGE_CODE_REDEEM', 'TTS_CONSUME');

-- CreateEnum
CREATE TYPE "UsageCodeModule" AS ENUM ('VOICE_TO_TEXT');

-- CreateEnum
CREATE TYPE "VideoPlatform" AS ENUM ('BILIBILI');

-- CreateEnum
CREATE TYPE "VideoInputType" AS ENUM ('URL', 'BV');

-- CreateEnum
CREATE TYPE "VideoSubtitleStatus" AS ENUM ('PENDING', 'READY', 'UNAVAILABLE', 'FAILED');

-- CreateEnum
CREATE TYPE "VideoTranscriptStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "VideoTranscriptSource" AS ENUM ('SUBTITLE', 'ASR');

-- CreateEnum
CREATE TYPE "VideoAnalysisJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "VideoAnalysisStage" AS ENUM ('SOURCE_LOAD', 'SNAPSHOT_FETCH', 'METADATA_SYNC', 'TRANSCRIPT_RESOLVE', 'ANALYSIS_PARAGRAPH_SUMMARY', 'ANALYSIS_STRUCTURE', 'ANALYSIS_SEMANTIC_PACKAGING', 'ANALYSIS_FINAL_REPORT', 'RESULT_WRITEBACK', 'FAILED_WRITEBACK');

-- CreateEnum
CREATE TYPE "VideoAnalysisStageEventStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "SmsScene" AS ENUM ('REGISTER', 'LOGIN', 'PASSWORD_CHANGE');

-- CreateEnum
CREATE TYPE "SmsVerificationStatus" AS ENUM ('SENT', 'VERIFIED', 'FAILED');

-- CreateEnum
CREATE TYPE "AnalyticsEventName" AS ENUM ('PAGE_VIEW', 'REGISTER_SUCCESS', 'VOICEPRINT_CREATED', 'VOICE_GENERATED', 'INVITE_CODE_USED');

-- CreateEnum
CREATE TYPE "AnalyticsChannel" AS ENUM ('DIRECT', 'REFERRAL', 'ORGANIC', 'SOCIAL', 'PAID', 'EMAIL', 'UNKNOWN');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "passwordHash" TEXT,
    "phoneVerifiedAt" TIMESTAMP(3),
    "pointsBalance" INTEGER NOT NULL DEFAULT 0,
    "freeTtsUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "PointTransactionType" NOT NULL,
    "delta" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "usageCodeId" TEXT,
    "ttsJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "anonymousUserId" TEXT,
    "activePureVoiceEnrollmentId" TEXT,
    "activeSceneVoiceEnrollmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoiceProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnonymousUser" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "freeTtsUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnonymousUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsVerification" (
    "id" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "scene" "SmsScene" NOT NULL,
    "provider" TEXT NOT NULL,
    "providerBizId" TEXT,
    "providerRequestId" TEXT,
    "providerOutId" TEXT NOT NULL,
    "codeHash" TEXT,
    "status" "SmsVerificationStatus" NOT NULL DEFAULT 'SENT',
    "verifyAttempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmsVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceRecording" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "anonymousUserId" TEXT,
    "status" "RecordingStatus" NOT NULL DEFAULT 'UPLOADED',
    "durationSeconds" DOUBLE PRECISION NOT NULL,
    "originalFilename" TEXT,
    "inputContentType" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "minioUri" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoiceRecording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceEnrollment" (
    "id" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "userId" TEXT,
    "anonymousUserId" TEXT,
    "profileKind" "VoiceProfileKind" NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'PENDING',
    "durationSeconds" DOUBLE PRECISION NOT NULL,
    "originalFilename" TEXT,
    "inputContentType" TEXT NOT NULL,
    "voiceId" TEXT,
    "errorMessage" TEXT,
    "isInvalidated" BOOLEAN NOT NULL DEFAULT false,
    "bucket" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "minioUri" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoiceEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageCode" (
    "id" TEXT NOT NULL,
    "module" "UsageCodeModule" NOT NULL DEFAULT 'VOICE_TO_TEXT',
    "code" TEXT NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "consumedByUserId" TEXT,
    "consumedTtsJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TtsJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "anonymousUserId" TEXT,
    "voiceEnrollmentId" TEXT,
    "profileKind" "VoiceProfileKind" NOT NULL,
    "accessKind" "TtsAccessKind" NOT NULL DEFAULT 'FREE_TRIAL',
    "usageCodeId" TEXT,
    "usageCodeModule" "UsageCodeModule",
    "usageCodeValue" TEXT,
    "voiceIdSnapshot" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sceneKey" TEXT,
    "instruction" TEXT,
    "status" "TtsJobStatus" NOT NULL DEFAULT 'PENDING',
    "outputContentType" TEXT,
    "errorMessage" TEXT,
    "bucket" TEXT,
    "objectKey" TEXT,
    "minioUri" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TtsJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsVisitor" (
    "id" TEXT NOT NULL,
    "anonymousId" TEXT NOT NULL,
    "userId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstReferrer" TEXT,
    "firstUtmSource" TEXT,
    "firstUtmMedium" TEXT,
    "firstUtmCampaign" TEXT,
    "firstLandingPage" TEXT,

    CONSTRAINT "AnalyticsVisitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsSession" (
    "id" TEXT NOT NULL,
    "anonymousId" TEXT NOT NULL,
    "userId" TEXT,
    "clientSessionId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entryPage" TEXT NOT NULL,
    "entryReferrer" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "channel" "AnalyticsChannel" NOT NULL DEFAULT 'UNKNOWN',

    CONSTRAINT "AnalyticsSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "anonymousId" TEXT NOT NULL,
    "userId" TEXT,
    "analyticsSessionId" TEXT NOT NULL,
    "eventName" "AnalyticsEventName" NOT NULL,
    "url" TEXT NOT NULL,
    "referrer" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "channel" "AnalyticsChannel" NOT NULL DEFAULT 'UNKNOWN',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoSource" (
    "id" TEXT NOT NULL,
    "platform" "VideoPlatform" NOT NULL DEFAULT 'BILIBILI',
    "inputType" "VideoInputType" NOT NULL,
    "inputValue" TEXT NOT NULL,
    "normalizedBvid" TEXT NOT NULL,
    "normalizedUrl" TEXT,
    "title" TEXT,
    "authorName" TEXT,
    "authorMid" TEXT,
    "coverUrl" TEXT,
    "durationSeconds" DOUBLE PRECISION,
    "publishTime" TIMESTAMP(3),
    "subtitleStatus" "VideoSubtitleStatus" NOT NULL DEFAULT 'PENDING',
    "transcriptStatus" "VideoTranscriptStatus" NOT NULL DEFAULT 'PENDING',
    "transcriptSource" "VideoTranscriptSource",
    "subtitleText" TEXT,
    "transcriptText" TEXT,
    "fetchErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoAnalysisJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "videoSourceId" TEXT NOT NULL,
    "status" "VideoAnalysisJobStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "currentStage" "VideoAnalysisStage",
    "currentStageStatus" "VideoAnalysisStageEventStatus",
    "currentStageMessage" TEXT,
    "currentStageStartedAt" TIMESTAMP(3),
    "summary" TEXT,
    "structureSections" TEXT,
    "highlights" TEXT,
    "copySuggestions" TEXT,
    "healthCard" TEXT,
    "packagingAnalysis" TEXT,
    "scriptAnalysis" TEXT,
    "semanticAnalysis" TEXT,
    "internalizationSummary" TEXT,
    "metadataJson" TEXT,
    "modelName" TEXT,
    "promptVersion" TEXT,
    "workerId" TEXT,
    "lockedAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoAnalysisJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoAnalysisJobStageEvent" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "stage" "VideoAnalysisStage" NOT NULL,
    "status" "VideoAnalysisStageEventStatus" NOT NULL DEFAULT 'RUNNING',
    "message" TEXT,
    "detailsJson" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoAnalysisJobStageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phoneNumber_key" ON "User"("phoneNumber");

-- CreateIndex
CREATE INDEX "PointTransaction_userId_createdAt_idx" ON "PointTransaction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PointTransaction_usageCodeId_idx" ON "PointTransaction"("usageCodeId");

-- CreateIndex
CREATE INDEX "PointTransaction_ttsJobId_idx" ON "PointTransaction"("ttsJobId");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceProfile_userId_key" ON "VoiceProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceProfile_anonymousUserId_key" ON "VoiceProfile"("anonymousUserId");

-- CreateIndex
CREATE INDEX "VoiceProfile_userId_idx" ON "VoiceProfile"("userId");

-- CreateIndex
CREATE INDEX "VoiceProfile_anonymousUserId_idx" ON "VoiceProfile"("anonymousUserId");

-- CreateIndex
CREATE UNIQUE INDEX "AnonymousUser_tokenHash_key" ON "AnonymousUser"("tokenHash");

-- CreateIndex
CREATE INDEX "AnonymousUser_expiresAt_idx" ON "AnonymousUser"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "SmsVerification_phoneNumber_scene_createdAt_idx" ON "SmsVerification"("phoneNumber", "scene", "createdAt");

-- CreateIndex
CREATE INDEX "SmsVerification_status_expiresAt_idx" ON "SmsVerification"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "VoiceRecording_userId_createdAt_idx" ON "VoiceRecording"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "VoiceRecording_anonymousUserId_createdAt_idx" ON "VoiceRecording"("anonymousUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceEnrollment_voiceId_key" ON "VoiceEnrollment"("voiceId");

-- CreateIndex
CREATE INDEX "VoiceEnrollment_recordingId_idx" ON "VoiceEnrollment"("recordingId");

-- CreateIndex
CREATE INDEX "VoiceEnrollment_profileKind_createdAt_idx" ON "VoiceEnrollment"("profileKind", "createdAt");

-- CreateIndex
CREATE INDEX "VoiceEnrollment_userId_createdAt_idx" ON "VoiceEnrollment"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "VoiceEnrollment_anonymousUserId_createdAt_idx" ON "VoiceEnrollment"("anonymousUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UsageCode_code_key" ON "UsageCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "UsageCode_consumedTtsJobId_key" ON "UsageCode"("consumedTtsJobId");

-- CreateIndex
CREATE INDEX "UsageCode_module_consumedAt_idx" ON "UsageCode"("module", "consumedAt");

-- CreateIndex
CREATE INDEX "UsageCode_consumedAt_idx" ON "UsageCode"("consumedAt");

-- CreateIndex
CREATE INDEX "UsageCode_consumedByUserId_consumedAt_idx" ON "UsageCode"("consumedByUserId", "consumedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TtsJob_usageCodeId_key" ON "TtsJob"("usageCodeId");

-- CreateIndex
CREATE INDEX "TtsJob_userId_createdAt_idx" ON "TtsJob"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TtsJob_anonymousUserId_createdAt_idx" ON "TtsJob"("anonymousUserId", "createdAt");

-- CreateIndex
CREATE INDEX "TtsJob_voiceEnrollmentId_idx" ON "TtsJob"("voiceEnrollmentId");

-- CreateIndex
CREATE INDEX "TtsJob_accessKind_createdAt_idx" ON "TtsJob"("accessKind", "createdAt");

-- CreateIndex
CREATE INDEX "TtsJob_usageCodeModule_createdAt_idx" ON "TtsJob"("usageCodeModule", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsVisitor_anonymousId_key" ON "AnalyticsVisitor"("anonymousId");

-- CreateIndex
CREATE INDEX "AnalyticsVisitor_userId_idx" ON "AnalyticsVisitor"("userId");

-- CreateIndex
CREATE INDEX "AnalyticsVisitor_firstSeenAt_idx" ON "AnalyticsVisitor"("firstSeenAt");

-- CreateIndex
CREATE INDEX "AnalyticsVisitor_lastSeenAt_idx" ON "AnalyticsVisitor"("lastSeenAt");

-- CreateIndex
CREATE INDEX "AnalyticsSession_anonymousId_startedAt_idx" ON "AnalyticsSession"("anonymousId", "startedAt");

-- CreateIndex
CREATE INDEX "AnalyticsSession_userId_startedAt_idx" ON "AnalyticsSession"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "AnalyticsSession_channel_startedAt_idx" ON "AnalyticsSession"("channel", "startedAt");

-- CreateIndex
CREATE INDEX "AnalyticsSession_clientSessionId_idx" ON "AnalyticsSession"("clientSessionId");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_occurredAt_idx" ON "AnalyticsEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_eventName_occurredAt_idx" ON "AnalyticsEvent"("eventName", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_channel_occurredAt_idx" ON "AnalyticsEvent"("channel", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_userId_occurredAt_idx" ON "AnalyticsEvent"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_anonymousId_occurredAt_idx" ON "AnalyticsEvent"("anonymousId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "VideoSource_normalizedBvid_key" ON "VideoSource"("normalizedBvid");

-- CreateIndex
CREATE INDEX "VideoAnalysisJob_userId_createdAt_idx" ON "VideoAnalysisJob"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "VideoAnalysisJob_videoSourceId_createdAt_idx" ON "VideoAnalysisJob"("videoSourceId", "createdAt");

-- CreateIndex
CREATE INDEX "VideoAnalysisJob_status_createdAt_idx" ON "VideoAnalysisJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "VideoAnalysisJob_currentStage_currentStageStatus_idx" ON "VideoAnalysisJob"("currentStage", "currentStageStatus");

-- CreateIndex
CREATE INDEX "VideoAnalysisJobStageEvent_jobId_createdAt_idx" ON "VideoAnalysisJobStageEvent"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "VideoAnalysisJobStageEvent_jobId_status_createdAt_idx" ON "VideoAnalysisJobStageEvent"("jobId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "VideoAnalysisJobStageEvent_stage_status_createdAt_idx" ON "VideoAnalysisJobStageEvent"("stage", "status", "createdAt");

COMMIT;
