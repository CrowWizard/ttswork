-- VoiceProfile 数据迁移脚本
-- 适用数据库：PostgreSQL 9.x
-- 执行顺序：先创建 VoiceProfile 并搬迁旧字段数据，确认校验查询无异常后，再删除旧列。

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'VoiceProfile'
  ) THEN
    CREATE TABLE "VoiceProfile" (
      "id" TEXT NOT NULL,
      "userId" TEXT,
      "anonymousUserId" TEXT,
      "activePureVoiceEnrollmentId" TEXT,
      "activeSceneVoiceEnrollmentId" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

      CONSTRAINT "VoiceProfile_pkey" PRIMARY KEY ("id")
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'i'
      AND c.relname = 'VoiceProfile_userId_key'
      AND n.nspname = current_schema()
  ) THEN
    CREATE UNIQUE INDEX "VoiceProfile_userId_key" ON "VoiceProfile"("userId");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'i'
      AND c.relname = 'VoiceProfile_anonymousUserId_key'
      AND n.nspname = current_schema()
  ) THEN
    CREATE UNIQUE INDEX "VoiceProfile_anonymousUserId_key" ON "VoiceProfile"("anonymousUserId");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'i'
      AND c.relname = 'VoiceProfile_userId_idx'
      AND n.nspname = current_schema()
  ) THEN
    CREATE INDEX "VoiceProfile_userId_idx" ON "VoiceProfile"("userId");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'i'
      AND c.relname = 'VoiceProfile_anonymousUserId_idx'
      AND n.nspname = current_schema()
  ) THEN
    CREATE INDEX "VoiceProfile_anonymousUserId_idx" ON "VoiceProfile"("anonymousUserId");
  END IF;
END $$;

UPDATE "VoiceProfile"
SET
  "activePureVoiceEnrollmentId" = COALESCE(
    "VoiceProfile"."activePureVoiceEnrollmentId",
    "User"."activePureVoiceEnrollmentId"
  ),
  "activeSceneVoiceEnrollmentId" = COALESCE(
    "VoiceProfile"."activeSceneVoiceEnrollmentId",
    "User"."activeSceneVoiceEnrollmentId"
  ),
  "updatedAt" = CURRENT_TIMESTAMP
FROM "User"
WHERE "VoiceProfile"."userId" = "User"."id"
  AND (
    "User"."activePureVoiceEnrollmentId" IS NOT NULL
    OR "User"."activeSceneVoiceEnrollmentId" IS NOT NULL
  );

INSERT INTO "VoiceProfile" (
  "id",
  "userId",
  "activePureVoiceEnrollmentId",
  "activeSceneVoiceEnrollmentId",
  "createdAt",
  "updatedAt"
)
SELECT
  'vp_user_' || "id" AS "id",
  "id" AS "userId",
  "activePureVoiceEnrollmentId",
  "activeSceneVoiceEnrollmentId",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User"
WHERE (
    "activePureVoiceEnrollmentId" IS NOT NULL
    OR "activeSceneVoiceEnrollmentId" IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "VoiceProfile"
    WHERE "VoiceProfile"."userId" = "User"."id"
  );

UPDATE "VoiceProfile"
SET
  "activePureVoiceEnrollmentId" = COALESCE(
    "VoiceProfile"."activePureVoiceEnrollmentId",
    "AnonymousUser"."activePureVoiceEnrollmentId"
  ),
  "activeSceneVoiceEnrollmentId" = COALESCE(
    "VoiceProfile"."activeSceneVoiceEnrollmentId",
    "AnonymousUser"."activeSceneVoiceEnrollmentId"
  ),
  "updatedAt" = CURRENT_TIMESTAMP
FROM "AnonymousUser"
WHERE "VoiceProfile"."anonymousUserId" = "AnonymousUser"."id"
  AND (
    "AnonymousUser"."activePureVoiceEnrollmentId" IS NOT NULL
    OR "AnonymousUser"."activeSceneVoiceEnrollmentId" IS NOT NULL
  );

INSERT INTO "VoiceProfile" (
  "id",
  "anonymousUserId",
  "activePureVoiceEnrollmentId",
  "activeSceneVoiceEnrollmentId",
  "createdAt",
  "updatedAt"
)
SELECT
  'vp_anon_' || "id" AS "id",
  "id" AS "anonymousUserId",
  "activePureVoiceEnrollmentId",
  "activeSceneVoiceEnrollmentId",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "AnonymousUser"
WHERE (
    "activePureVoiceEnrollmentId" IS NOT NULL
    OR "activeSceneVoiceEnrollmentId" IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "VoiceProfile"
    WHERE "VoiceProfile"."anonymousUserId" = "AnonymousUser"."id"
  );

COMMIT;

-- 校验 1：旧 User active voice 行数应等于 VoiceProfile user 行数。
SELECT
  (
    SELECT COUNT(*)
    FROM "User"
    WHERE "activePureVoiceEnrollmentId" IS NOT NULL
       OR "activeSceneVoiceEnrollmentId" IS NOT NULL
  ) AS "userRowsWithActiveVoice",
  (
    SELECT COUNT(*)
    FROM "VoiceProfile"
    WHERE "userId" IS NOT NULL
  ) AS "migratedUserVoiceProfiles";

-- 校验 2：旧 AnonymousUser active voice 行数应等于 VoiceProfile anonymousUser 行数。
SELECT
  (
    SELECT COUNT(*)
    FROM "AnonymousUser"
    WHERE "activePureVoiceEnrollmentId" IS NOT NULL
       OR "activeSceneVoiceEnrollmentId" IS NOT NULL
  ) AS "anonymousRowsWithActiveVoice",
  (
    SELECT COUNT(*)
    FROM "VoiceProfile"
    WHERE "anonymousUserId" IS NOT NULL
  ) AS "migratedAnonymousVoiceProfiles";

-- 校验 3：检查是否存在未迁移的 User active voice。
SELECT "User"."id"
FROM "User"
LEFT JOIN "VoiceProfile" ON "VoiceProfile"."userId" = "User"."id"
WHERE (
    "User"."activePureVoiceEnrollmentId" IS NOT NULL
    OR "User"."activeSceneVoiceEnrollmentId" IS NOT NULL
  )
  AND "VoiceProfile"."id" IS NULL;

-- 校验 4：检查是否存在未迁移的 AnonymousUser active voice。
SELECT "AnonymousUser"."id"
FROM "AnonymousUser"
LEFT JOIN "VoiceProfile" ON "VoiceProfile"."anonymousUserId" = "AnonymousUser"."id"
WHERE (
    "AnonymousUser"."activePureVoiceEnrollmentId" IS NOT NULL
    OR "AnonymousUser"."activeSceneVoiceEnrollmentId" IS NOT NULL
  )
  AND "VoiceProfile"."id" IS NULL;

-- 确认以上校验无异常后，再执行下面的破坏性变更。
-- 建议先备份数据库，再取消注释执行。
-- ALTER TABLE "User" DROP COLUMN "activePureVoiceEnrollmentId";
-- ALTER TABLE "User" DROP COLUMN "activeSceneVoiceEnrollmentId";
-- ALTER TABLE "AnonymousUser" DROP COLUMN "activePureVoiceEnrollmentId";
-- ALTER TABLE "AnonymousUser" DROP COLUMN "activeSceneVoiceEnrollmentId";
