-- Voice MVP 数据库初始化脚本（无外键版本）
-- 用法: sudo -u postgres psql -f init-db.sql
-- 或者: psql -h 127.0.0.1 -U postgres -f init-db.sql

-- 1. 创建数据库（如果不存在）
SELECT 'CREATE DATABASE voice_mvp'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'voice_mvp')\gexec

-- 2. 创建用户（如果不存在）并设置密码
--    ⚠️ 请将 YOUR_PASSWORD 替换为实际密码
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'voice_mvp') THEN
    CREATE ROLE voice_mvp WITH LOGIN PASSWORD 'YOUR_PASSWORD';
  ELSE
    ALTER ROLE voice_mvp WITH LOGIN PASSWORD 'YOUR_PASSWORD';
  END IF;
END
$$;

-- 3. 授权
GRANT ALL PRIVILEGES ON DATABASE voice_mvp TO voice_mvp;

-- 连接到 voice_mvp 数据库，创建表结构
\c voice_mvp

-- 确保 voice_mvp 用户对 public schema 有权限
GRANT ALL ON SCHEMA public TO voice_mvp;

-- 4. 创建枚举类型
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EnrollmentStatus') THEN
    CREATE TYPE "EnrollmentStatus" AS ENUM ('PENDING', 'READY', 'FAILED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RecordingStatus') THEN
    CREATE TYPE "RecordingStatus" AS ENUM ('UPLOADED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VoiceProfileKind') THEN
    CREATE TYPE "VoiceProfileKind" AS ENUM ('PURE', 'SCENE');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TtsJobStatus') THEN
    CREATE TYPE "TtsJobStatus" AS ENUM ('PENDING', 'READY', 'FAILED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TtsAccessKind') THEN
    CREATE TYPE "TtsAccessKind" AS ENUM ('FREE_TRIAL', 'GENERAL_USAGE_CODE', 'USAGE_CODE');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'UsageCodeModule') THEN
    CREATE TYPE "UsageCodeModule" AS ENUM ('VOICE_TO_TEXT');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SmsScene') THEN
    CREATE TYPE "SmsScene" AS ENUM ('REGISTER', 'LOGIN', 'PASSWORD_CHANGE');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SmsVerificationStatus') THEN
    CREATE TYPE "SmsVerificationStatus" AS ENUM ('SENT', 'VERIFIED', 'FAILED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AnalyticsEventName') THEN
    CREATE TYPE "AnalyticsEventName" AS ENUM (
      'PAGE_VIEW',
      'REGISTER_SUCCESS',
      'VOICEPRINT_CREATED',
      'VOICE_GENERATED',
      'INVITE_CODE_USED'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AnalyticsChannel') THEN
    CREATE TYPE "AnalyticsChannel" AS ENUM (
      'DIRECT',
      'REFERRAL',
      'ORGANIC',
      'SOCIAL',
      'PAID',
      'EMAIL',
      'UNKNOWN'
    );
  END IF;
END
$$;

ALTER TYPE "TtsAccessKind" ADD VALUE IF NOT EXISTS 'GENERAL_USAGE_CODE';

-- 5. 创建表（无外键约束，关联关系由应用层保证）
CREATE TABLE IF NOT EXISTS "User" (
  "id" TEXT NOT NULL,
  "phoneNumber" TEXT NOT NULL,
  "passwordHash" TEXT,
  "phoneVerifiedAt" TIMESTAMP(3),
  "freeTtsUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activePureVoiceEnrollmentId" TEXT,
  "activeSceneVoiceEnrollmentId" TEXT,

  CONSTRAINT "User_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "User_phoneNumber_key" UNIQUE ("phoneNumber"),
  CONSTRAINT "User_activePureVoiceEnrollmentId_key" UNIQUE ("activePureVoiceEnrollmentId"),
  CONSTRAINT "User_activeSceneVoiceEnrollmentId_key" UNIQUE ("activeSceneVoiceEnrollmentId")
);

CREATE TABLE IF NOT EXISTS "AnonymousUser" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "freeTtsUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activePureVoiceEnrollmentId" TEXT,
  "activeSceneVoiceEnrollmentId" TEXT,

  CONSTRAINT "AnonymousUser_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AnonymousUser_tokenHash_key" UNIQUE ("tokenHash"),
  CONSTRAINT "AnonymousUser_activePureVoiceEnrollmentId_key" UNIQUE ("activePureVoiceEnrollmentId"),
  CONSTRAINT "AnonymousUser_activeSceneVoiceEnrollmentId_key" UNIQUE ("activeSceneVoiceEnrollmentId")
);

CREATE TABLE IF NOT EXISTS "Session" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Session_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Session_tokenHash_key" UNIQUE ("tokenHash")
);

CREATE TABLE IF NOT EXISTS "SmsVerification" (
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
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SmsVerification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "VoiceRecording" (
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
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "VoiceRecording_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "VoiceEnrollment" (
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
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "VoiceEnrollment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VoiceEnrollment_voiceId_key" UNIQUE ("voiceId")
);

CREATE TABLE IF NOT EXISTS "UsageCode" (
  "id" TEXT NOT NULL,
  "module" "UsageCodeModule" NOT NULL DEFAULT 'VOICE_TO_TEXT',
  "code" TEXT NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "consumedByUserId" TEXT,
  "consumedTtsJobId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UsageCode_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsageCode_code_key" UNIQUE ("code"),
  CONSTRAINT "UsageCode_consumedTtsJobId_key" UNIQUE ("consumedTtsJobId")
);

CREATE TABLE IF NOT EXISTS "TtsJob" (
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
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TtsJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TtsJob_usageCodeId_key" UNIQUE ("usageCodeId")
);

CREATE TABLE IF NOT EXISTS "AnalyticsVisitor" (
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

  CONSTRAINT "AnalyticsVisitor_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AnalyticsVisitor_anonymousId_key" UNIQUE ("anonymousId")
);

CREATE TABLE IF NOT EXISTS "AnalyticsSession" (
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

CREATE TABLE IF NOT EXISTS "AnalyticsEvent" (
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

-- 6. 创建索引
CREATE INDEX IF NOT EXISTS "AnonymousUser_expiresAt_idx"
  ON "AnonymousUser"("expiresAt");

CREATE INDEX IF NOT EXISTS "Session_userId_expiresAt_idx"
  ON "Session"("userId", "expiresAt");

CREATE INDEX IF NOT EXISTS "SmsVerification_phoneNumber_scene_createdAt_idx"
  ON "SmsVerification"("phoneNumber", "scene", "createdAt");

CREATE INDEX IF NOT EXISTS "SmsVerification_status_expiresAt_idx"
  ON "SmsVerification"("status", "expiresAt");

CREATE INDEX IF NOT EXISTS "VoiceRecording_userId_createdAt_idx"
  ON "VoiceRecording"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "VoiceRecording_anonymousUserId_createdAt_idx"
  ON "VoiceRecording"("anonymousUserId", "createdAt");

CREATE INDEX IF NOT EXISTS "VoiceEnrollment_recordingId_idx"
  ON "VoiceEnrollment"("recordingId");

CREATE INDEX IF NOT EXISTS "VoiceEnrollment_profileKind_createdAt_idx"
  ON "VoiceEnrollment"("profileKind", "createdAt");

CREATE INDEX IF NOT EXISTS "VoiceEnrollment_userId_createdAt_idx"
  ON "VoiceEnrollment"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "VoiceEnrollment_anonymousUserId_createdAt_idx"
  ON "VoiceEnrollment"("anonymousUserId", "createdAt");

CREATE INDEX IF NOT EXISTS "UsageCode_module_consumedAt_idx"
  ON "UsageCode"("module", "consumedAt");

CREATE INDEX IF NOT EXISTS "UsageCode_consumedAt_idx"
  ON "UsageCode"("consumedAt");

CREATE INDEX IF NOT EXISTS "UsageCode_consumedByUserId_consumedAt_idx"
  ON "UsageCode"("consumedByUserId", "consumedAt");

CREATE INDEX IF NOT EXISTS "TtsJob_userId_createdAt_idx"
  ON "TtsJob"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "TtsJob_anonymousUserId_createdAt_idx"
  ON "TtsJob"("anonymousUserId", "createdAt");

CREATE INDEX IF NOT EXISTS "TtsJob_voiceEnrollmentId_idx"
  ON "TtsJob"("voiceEnrollmentId");

CREATE INDEX IF NOT EXISTS "TtsJob_accessKind_createdAt_idx"
  ON "TtsJob"("accessKind", "createdAt");

CREATE INDEX IF NOT EXISTS "TtsJob_usageCodeModule_createdAt_idx"
  ON "TtsJob"("usageCodeModule", "createdAt");

CREATE INDEX IF NOT EXISTS "AnalyticsVisitor_userId_idx"
  ON "AnalyticsVisitor"("userId");

CREATE INDEX IF NOT EXISTS "AnalyticsVisitor_firstSeenAt_idx"
  ON "AnalyticsVisitor"("firstSeenAt");

CREATE INDEX IF NOT EXISTS "AnalyticsVisitor_lastSeenAt_idx"
  ON "AnalyticsVisitor"("lastSeenAt");

CREATE INDEX IF NOT EXISTS "AnalyticsSession_anonymousId_startedAt_idx"
  ON "AnalyticsSession"("anonymousId", "startedAt");

CREATE INDEX IF NOT EXISTS "AnalyticsSession_userId_startedAt_idx"
  ON "AnalyticsSession"("userId", "startedAt");

CREATE INDEX IF NOT EXISTS "AnalyticsSession_channel_startedAt_idx"
  ON "AnalyticsSession"("channel", "startedAt");

CREATE INDEX IF NOT EXISTS "AnalyticsSession_clientSessionId_idx"
  ON "AnalyticsSession"("clientSessionId");

CREATE INDEX IF NOT EXISTS "AnalyticsEvent_occurredAt_idx"
  ON "AnalyticsEvent"("occurredAt");

CREATE INDEX IF NOT EXISTS "AnalyticsEvent_eventName_occurredAt_idx"
  ON "AnalyticsEvent"("eventName", "occurredAt");

CREATE INDEX IF NOT EXISTS "AnalyticsEvent_channel_occurredAt_idx"
  ON "AnalyticsEvent"("channel", "occurredAt");

CREATE INDEX IF NOT EXISTS "AnalyticsEvent_userId_occurredAt_idx"
  ON "AnalyticsEvent"("userId", "occurredAt");

CREATE INDEX IF NOT EXISTS "AnalyticsEvent_anonymousId_occurredAt_idx"
  ON "AnalyticsEvent"("anonymousId", "occurredAt");

-- 7. 表和类型所有权授予 voice_mvp 用户
ALTER TABLE "User" OWNER TO voice_mvp;
ALTER TABLE "AnonymousUser" OWNER TO voice_mvp;
ALTER TABLE "Session" OWNER TO voice_mvp;
ALTER TABLE "SmsVerification" OWNER TO voice_mvp;
ALTER TABLE "VoiceRecording" OWNER TO voice_mvp;
ALTER TABLE "VoiceEnrollment" OWNER TO voice_mvp;
ALTER TABLE "UsageCode" OWNER TO voice_mvp;
ALTER TABLE "TtsJob" OWNER TO voice_mvp;
ALTER TABLE "AnalyticsVisitor" OWNER TO voice_mvp;
ALTER TABLE "AnalyticsSession" OWNER TO voice_mvp;
ALTER TABLE "AnalyticsEvent" OWNER TO voice_mvp;
ALTER TYPE "EnrollmentStatus" OWNER TO voice_mvp;
ALTER TYPE "RecordingStatus" OWNER TO voice_mvp;
ALTER TYPE "VoiceProfileKind" OWNER TO voice_mvp;
ALTER TYPE "TtsJobStatus" OWNER TO voice_mvp;
ALTER TYPE "TtsAccessKind" OWNER TO voice_mvp;
ALTER TYPE "UsageCodeModule" OWNER TO voice_mvp;
ALTER TYPE "SmsScene" OWNER TO voice_mvp;
ALTER TYPE "SmsVerificationStatus" OWNER TO voice_mvp;
ALTER TYPE "AnalyticsEventName" OWNER TO voice_mvp;
ALTER TYPE "AnalyticsChannel" OWNER TO voice_mvp;

-- 完成
SELECT '✅ 数据库初始化完成' AS result;
