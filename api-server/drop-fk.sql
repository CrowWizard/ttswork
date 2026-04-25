-- Voice MVP 清理外键脚本
-- 在已有外键的数据库上执行，删除所有外键约束

\c voice_mvp

-- 删除 AnonymousUser 上的外键
ALTER TABLE "AnonymousUser" DROP CONSTRAINT IF EXISTS "AnonymousUser_activeVoiceEnrollmentId_fkey";

-- 删除 VoiceEnrollment 上的外键
ALTER TABLE "VoiceEnrollment" DROP CONSTRAINT IF EXISTS "VoiceEnrollment_userId_fkey";

-- 删除 TtsJob 上的外键
ALTER TABLE "TtsJob" DROP CONSTRAINT IF EXISTS "TtsJob_userId_fkey";
ALTER TABLE "TtsJob" DROP CONSTRAINT IF EXISTS "TtsJob_voiceEnrollmentId_fkey";

SELECT '✅ 外键约束已清理' AS result;
