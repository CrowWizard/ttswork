-- 两步建声结构上线前的历史数据回填 SQL
-- 用途：先执行本脚本，再执行 `bunx prisma db push --accept-data-loss`
-- 说明：
-- 1. 旧 VoiceEnrollment 既是录音素材又是声纹记录，这里会一对一补出 VoiceRecording
-- 2. 历史数据统一按 PURE 回填；SCENE 只对新流程产生
-- 3. 外网访问前缀不入库，运行时从配置项 MINIO_PUBLIC_BASE_URL 拼接

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RecordingStatus') THEN
    CREATE TYPE "RecordingStatus" AS ENUM ('UPLOADED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VoiceProfileKind') THEN
    CREATE TYPE "VoiceProfileKind" AS ENUM ('PURE', 'SCENE');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'User'
      AND column_name = 'activePureVoiceEnrollmentId'
  ) THEN
    ALTER TABLE "User" ADD COLUMN "activePureVoiceEnrollmentId" TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'User'
      AND column_name = 'activeSceneVoiceEnrollmentId'
  ) THEN
    ALTER TABLE "User" ADD COLUMN "activeSceneVoiceEnrollmentId" TEXT;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'AnonymousUser'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'AnonymousUser'
        AND column_name = 'activePureVoiceEnrollmentId'
    ) THEN
      ALTER TABLE "AnonymousUser" ADD COLUMN "activePureVoiceEnrollmentId" TEXT;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'AnonymousUser'
        AND column_name = 'activeSceneVoiceEnrollmentId'
    ) THEN
      ALTER TABLE "AnonymousUser" ADD COLUMN "activeSceneVoiceEnrollmentId" TEXT;
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'VoiceEnrollment'
      AND column_name = 'anonymousUserId'
  ) THEN
    ALTER TABLE "VoiceEnrollment" ADD COLUMN "anonymousUserId" TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'VoiceEnrollment'
      AND column_name = 'recordingId'
  ) THEN
    ALTER TABLE "VoiceEnrollment" ADD COLUMN "recordingId" TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'VoiceEnrollment'
      AND column_name = 'profileKind'
  ) THEN
    ALTER TABLE "VoiceEnrollment" ADD COLUMN "profileKind" "VoiceProfileKind";
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'TtsJob'
      AND column_name = 'anonymousUserId'
  ) THEN
    ALTER TABLE "TtsJob" ADD COLUMN "anonymousUserId" TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'TtsJob'
      AND column_name = 'profileKind'
  ) THEN
    ALTER TABLE "TtsJob" ADD COLUMN "profileKind" "VoiceProfileKind";
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'TtsJob'
      AND column_name = 'sceneKey'
  ) THEN
    ALTER TABLE "TtsJob" ADD COLUMN "sceneKey" TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'TtsJob'
      AND column_name = 'instruction'
  ) THEN
    ALTER TABLE "TtsJob" ADD COLUMN "instruction" TEXT;
  END IF;
END
$$;

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

-- 这里把旧建声记录一对一补成录音记录。
-- 库里只保留 bucket/objectKey/minioUri，不保留外网 baseUrl。
INSERT INTO "VoiceRecording" (
  "id",
  "userId",
  "anonymousUserId",
  "status",
  "durationSeconds",
  "originalFilename",
  "inputContentType",
  "bucket",
  "objectKey",
  "minioUri",
  "createdAt",
  "updatedAt"
)
SELECT
  ve."id",
  ve."userId",
  ve."anonymousUserId",
  'UPLOADED'::"RecordingStatus",
  ve."durationSeconds",
  ve."originalFilename",
  ve."inputContentType",
  ve."bucket",
  ve."objectKey",
  ve."minioUri",
  ve."createdAt",
  ve."updatedAt"
FROM "VoiceEnrollment" ve
WHERE NOT EXISTS (
  SELECT 1 FROM "VoiceRecording" vr WHERE vr."id" = ve."id"
);

UPDATE "VoiceEnrollment"
SET
  "recordingId" = COALESCE("recordingId", "id"),
  "profileKind" = COALESCE("profileKind", 'PURE'::"VoiceProfileKind")
WHERE "recordingId" IS NULL OR "profileKind" IS NULL;

UPDATE "TtsJob" tj
SET "profileKind" = COALESCE(tj."profileKind", ve."profileKind", 'PURE'::"VoiceProfileKind")
FROM "VoiceEnrollment" ve
WHERE tj."voiceEnrollmentId" = ve."id"
  AND tj."profileKind" IS NULL;

UPDATE "TtsJob"
SET "profileKind" = 'PURE'::"VoiceProfileKind"
WHERE "profileKind" IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'User'
      AND column_name = 'activeVoiceEnrollmentId'
  ) THEN
    UPDATE "User"
    SET "activePureVoiceEnrollmentId" = COALESCE("activePureVoiceEnrollmentId", "activeVoiceEnrollmentId")
    WHERE "activeVoiceEnrollmentId" IS NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'AnonymousUser'
      AND column_name = 'activeVoiceEnrollmentId'
  ) THEN
    UPDATE "AnonymousUser"
    SET "activePureVoiceEnrollmentId" = COALESCE("activePureVoiceEnrollmentId", "activeVoiceEnrollmentId")
    WHERE "activeVoiceEnrollmentId" IS NOT NULL;
  END IF;
END
$$;

-- 旧字段 activeVoiceEnrollmentId 在部分线上库中是通过唯一约束创建的，
-- Prisma 会尝试删除其底层索引，但 PostgreSQL 要求先删除约束本身。
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_activeVoiceEnrollmentId_key";
ALTER TABLE "AnonymousUser" DROP CONSTRAINT IF EXISTS "AnonymousUser_activeVoiceEnrollmentId_key";

-- 删除旧列前的安全检查：如果还有未迁移值，直接中止，避免误删仅存的 active voice 绑定。
DO $$
DECLARE
  remaining_user_count INTEGER := 0;
  remaining_anonymous_count INTEGER := 0;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'User'
      AND column_name = 'activeVoiceEnrollmentId'
  ) THEN
    SELECT COUNT(*)
    INTO remaining_user_count
    FROM "User"
    WHERE "activeVoiceEnrollmentId" IS NOT NULL
      AND COALESCE("activePureVoiceEnrollmentId", '') <> "activeVoiceEnrollmentId";

    IF remaining_user_count > 0 THEN
      RAISE EXCEPTION 'User.activeVoiceEnrollmentId 仍有 % 条未迁移记录，禁止删除旧列', remaining_user_count;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'AnonymousUser'
      AND column_name = 'activeVoiceEnrollmentId'
  ) THEN
    SELECT COUNT(*)
    INTO remaining_anonymous_count
    FROM "AnonymousUser"
    WHERE "activeVoiceEnrollmentId" IS NOT NULL
      AND COALESCE("activePureVoiceEnrollmentId", '') <> "activeVoiceEnrollmentId";

    IF remaining_anonymous_count > 0 THEN
      RAISE EXCEPTION 'AnonymousUser.activeVoiceEnrollmentId 仍有 % 条未迁移记录，禁止删除旧列', remaining_anonymous_count;
    END IF;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "User_activePureVoiceEnrollmentId_key"
  ON "User"("activePureVoiceEnrollmentId");

CREATE UNIQUE INDEX IF NOT EXISTS "User_activeSceneVoiceEnrollmentId_key"
  ON "User"("activeSceneVoiceEnrollmentId");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'AnonymousUser'
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "AnonymousUser_activePureVoiceEnrollmentId_key"
      ON "AnonymousUser"("activePureVoiceEnrollmentId");

    CREATE UNIQUE INDEX IF NOT EXISTS "AnonymousUser_activeSceneVoiceEnrollmentId_key"
      ON "AnonymousUser"("activeSceneVoiceEnrollmentId");
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "VoiceRecording_userId_createdAt_idx"
  ON "VoiceRecording"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "VoiceRecording_anonymousUserId_createdAt_idx"
  ON "VoiceRecording"("anonymousUserId", "createdAt");

CREATE INDEX IF NOT EXISTS "VoiceEnrollment_recordingId_idx"
  ON "VoiceEnrollment"("recordingId");

CREATE INDEX IF NOT EXISTS "VoiceEnrollment_profileKind_createdAt_idx"
  ON "VoiceEnrollment"("profileKind", "createdAt");

CREATE INDEX IF NOT EXISTS "TtsJob_voiceEnrollmentId_idx"
  ON "TtsJob"("voiceEnrollmentId");

-- 如果本脚本由 postgres / 超级用户执行，新建对象 owner 可能不是业务账号。
-- 这里统一把相关表和枚举转交给 voice_mvp，避免后续 prisma db push 因无权限失败。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'User') THEN
    ALTER TABLE "User" OWNER TO voice_mvp;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'AnonymousUser') THEN
    ALTER TABLE "AnonymousUser" OWNER TO voice_mvp;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'Session') THEN
    ALTER TABLE "Session" OWNER TO voice_mvp;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'SmsVerification') THEN
    ALTER TABLE "SmsVerification" OWNER TO voice_mvp;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'VoiceRecording') THEN
    ALTER TABLE "VoiceRecording" OWNER TO voice_mvp;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'VoiceEnrollment') THEN
    ALTER TABLE "VoiceEnrollment" OWNER TO voice_mvp;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'TtsJob') THEN
    ALTER TABLE "TtsJob" OWNER TO voice_mvp;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EnrollmentStatus') THEN
    ALTER TYPE "EnrollmentStatus" OWNER TO voice_mvp;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RecordingStatus') THEN
    ALTER TYPE "RecordingStatus" OWNER TO voice_mvp;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VoiceProfileKind') THEN
    ALTER TYPE "VoiceProfileKind" OWNER TO voice_mvp;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TtsJobStatus') THEN
    ALTER TYPE "TtsJobStatus" OWNER TO voice_mvp;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SmsScene') THEN
    ALTER TYPE "SmsScene" OWNER TO voice_mvp;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SmsVerificationStatus') THEN
    ALTER TYPE "SmsVerificationStatus" OWNER TO voice_mvp;
  END IF;
END
$$;

GRANT ALL ON SCHEMA public TO voice_mvp;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO voice_mvp;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO voice_mvp;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO voice_mvp;

COMMIT;
