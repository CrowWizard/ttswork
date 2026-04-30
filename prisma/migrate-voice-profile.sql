-- VoiceProfile 数据迁移脚本
-- 适用数据库：PostgreSQL
-- 执行顺序：先创建 VoiceProfile 并搬迁旧字段数据，确认校验查询无异常后，再删除旧列。

BEGIN;

CREATE TABLE IF NOT EXISTS "VoiceProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "anonymousUserId" TEXT,
  "activePureVoiceEnrollmentId" TEXT,
  "activeSceneVoiceEnrollmentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "VoiceProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "VoiceProfile_userId_key" ON "VoiceProfile"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "VoiceProfile_anonymousUserId_key" ON "VoiceProfile"("anonymousUserId");
CREATE INDEX IF NOT EXISTS "VoiceProfile_userId_idx" ON "VoiceProfile"("userId");
CREATE INDEX IF NOT EXISTS "VoiceProfile_anonymousUserId_idx" ON "VoiceProfile"("anonymousUserId");

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
WHERE "activePureVoiceEnrollmentId" IS NOT NULL
   OR "activeSceneVoiceEnrollmentId" IS NOT NULL
ON CONFLICT ("userId") DO UPDATE SET
  "activePureVoiceEnrollmentId" = COALESCE(
    "VoiceProfile"."activePureVoiceEnrollmentId",
    EXCLUDED."activePureVoiceEnrollmentId"
  ),
  "activeSceneVoiceEnrollmentId" = COALESCE(
    "VoiceProfile"."activeSceneVoiceEnrollmentId",
    EXCLUDED."activeSceneVoiceEnrollmentId"
  ),
  "updatedAt" = CURRENT_TIMESTAMP;

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
WHERE "activePureVoiceEnrollmentId" IS NOT NULL
   OR "activeSceneVoiceEnrollmentId" IS NOT NULL
ON CONFLICT ("anonymousUserId") DO UPDATE SET
  "activePureVoiceEnrollmentId" = COALESCE(
    "VoiceProfile"."activePureVoiceEnrollmentId",
    EXCLUDED."activePureVoiceEnrollmentId"
  ),
  "activeSceneVoiceEnrollmentId" = COALESCE(
    "VoiceProfile"."activeSceneVoiceEnrollmentId",
    EXCLUDED."activeSceneVoiceEnrollmentId"
  ),
  "updatedAt" = CURRENT_TIMESTAMP;

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
-- ALTER TABLE "User" DROP COLUMN IF EXISTS "activePureVoiceEnrollmentId";
-- ALTER TABLE "User" DROP COLUMN IF EXISTS "activeSceneVoiceEnrollmentId";
-- ALTER TABLE "AnonymousUser" DROP COLUMN IF EXISTS "activePureVoiceEnrollmentId";
-- ALTER TABLE "AnonymousUser" DROP COLUMN IF EXISTS "activeSceneVoiceEnrollmentId";
