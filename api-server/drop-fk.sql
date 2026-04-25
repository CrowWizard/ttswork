-- Voice MVP 清理外键脚本
-- 因业务要求数据库层不保留外键，统一删除现有约束

\c voice_mvp

-- 删除 User 上的外键
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_activeVoiceEnrollmentId_fkey";

-- 删除 Session 上的外键
ALTER TABLE "Session" DROP CONSTRAINT IF EXISTS "Session_userId_fkey";

-- 删除 VoiceEnrollment 上的外键
ALTER TABLE "VoiceEnrollment" DROP CONSTRAINT IF EXISTS "VoiceEnrollment_userId_fkey";

-- 删除 TtsJob 上的外键
ALTER TABLE "TtsJob" DROP CONSTRAINT IF EXISTS "TtsJob_userId_fkey";
ALTER TABLE "TtsJob" DROP CONSTRAINT IF EXISTS "TtsJob_voiceEnrollmentId_fkey";

SELECT '✅ 外键约束已清理，后续请执行 bunx prisma db push --accept-data-loss 同步 schema' AS result;
