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
CREATE TYPE "EnrollmentStatus" AS ENUM ('PENDING', 'READY', 'FAILED');
CREATE TYPE "TtsJobStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- 5. 创建表（无外键约束，关联关系由应用层保证）
CREATE TABLE IF NOT EXISTS "AnonymousUser" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activeVoiceEnrollmentId" TEXT,

    CONSTRAINT "AnonymousUser_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AnonymousUser_tokenHash_key" UNIQUE ("tokenHash"),
    CONSTRAINT "AnonymousUser_activeVoiceEnrollmentId_key" UNIQUE ("activeVoiceEnrollmentId")
);

CREATE TABLE IF NOT EXISTS "VoiceEnrollment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS "TtsJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "voiceEnrollmentId" TEXT NOT NULL,
    "voiceIdSnapshot" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" "TtsJobStatus" NOT NULL DEFAULT 'PENDING',
    "outputContentType" TEXT,
    "errorMessage" TEXT,
    "bucket" TEXT,
    "objectKey" TEXT,
    "minioUri" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TtsJob_pkey" PRIMARY KEY ("id")
);

-- 6. 创建索引
CREATE INDEX IF NOT EXISTS "AnonymousUser_expiresAt_idx"
    ON "AnonymousUser"("expiresAt");

CREATE INDEX IF NOT EXISTS "VoiceEnrollment_userId_createdAt_idx"
    ON "VoiceEnrollment"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "TtsJob_userId_createdAt_idx"
    ON "TtsJob"("userId", "createdAt");

-- 7. 表所有权授予 voice_mvp 用户
ALTER TABLE "AnonymousUser" OWNER TO voice_mvp;
ALTER TABLE "VoiceEnrollment" OWNER TO voice_mvp;
ALTER TABLE "TtsJob" OWNER TO voice_mvp;
ALTER TYPE "EnrollmentStatus" OWNER TO voice_mvp;
ALTER TYPE "TtsJobStatus" OWNER TO voice_mvp;

-- 完成
SELECT '✅ 数据库初始化完成' AS result;
