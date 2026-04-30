#!/bin/bash
set -euo pipefail

APP_NAME="voice-mvp-api"
INSTALL_DIR="/opt/voice-mvp"
SERVICE_USER="voice-mvp"
MODE="${1:-full}"
SOURCE_DIR="${SOURCE_DIR:-$(pwd)}"

echo "=== Voice MVP API 部署脚本 ==="

sync_database() {
  echo "同步数据库表结构"

  if [ ! -f "$INSTALL_DIR/prisma/schema.prisma" ]; then
    echo "  ⚠️  跳过自动迁移（未找到 prisma/schema.prisma）"
    return 0
  fi

  # 从 config.yaml 中 database 节提取连接参数，用 awk 比 sed 更可靠
  # awk 处理 YAML：遇到 database: 行后开始收集，遇到下一个顶层键停止
  read -r DB_HOST DB_PORT DB_NAME DB_USER DB_PASS DB_SCHEMA < <(
    awk '
      /^database:/ { in_db=1; next }
      /^[a-z]/ && in_db { in_db=0 }
      in_db {
        gsub(/"/, "", $2)
        if ($1 == "host:")     host=$2
        if ($1 == "port:")     port=$2
        if ($1 == "name:")     name=$2
        if ($1 == "user:")     user=$2
        if ($1 == "password:") pass=$2
        if ($1 == "schema:")   schema=$2
      }
      END { print (host ? host : "127.0.0.1"), (port+0 ? port+0 : 5432), (name ? name : "voice_mvp"), (user ? user : "voice_mvp"), pass, (schema ? schema : "public") }
    ' "$INSTALL_DIR/config.yaml"
  )

  DB_HOST=${DB_HOST:-127.0.0.1}
  DB_PORT=${DB_PORT:-5432}
  DB_NAME=${DB_NAME:-voice_mvp}
  DB_USER=${DB_USER:-voice_mvp}
  DB_SCHEMA=${DB_SCHEMA:-public}

  # URL 编码密码（逐字符处理，安全处理所有特殊字符）
  encoded_pass=""
  while IFS= read -r -n1 ch; do
    [ -z "$ch" ] && continue
    case "$ch" in
      [a-zA-Z0-9._~-]) encoded_pass+="$ch" ;;
      *) printf -v hex '%%%02X' "'$ch"; encoded_pass+="$hex" ;;
    esac
  done <<< "$DB_PASS"

  # 生成 .env 文件供 Prisma CLI 读取
  DATABASE_URL="postgresql://${DB_USER}:${encoded_pass}@${DB_HOST}:${DB_PORT}/${DB_NAME}?schema=${DB_SCHEMA}"
  echo "DATABASE_URL=$DATABASE_URL" > "$INSTALL_DIR/.env"
  echo "  已生成 $INSTALL_DIR/.env（host=${DB_HOST} port=${DB_PORT} db=${DB_NAME}）"

  if command -v bunx &>/dev/null; then
    echo "  执行建声两步式结构兼容性回填"
    echo "    [1/4] 补齐新枚举、表与缺失列"
    (
      cd "$SOURCE_DIR" &&
      DATABASE_URL="$DATABASE_URL" bunx prisma db execute --stdin <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RecordingStatus') THEN
    CREATE TYPE "RecordingStatus" AS ENUM ('UPLOADED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VoiceProfileKind') THEN
    CREATE TYPE "VoiceProfileKind" AS ENUM ('PURE', 'SCENE');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TtsAccessKind') THEN
    CREATE TYPE "TtsAccessKind" AS ENUM ('FREE_TRIAL', 'GENERAL_USAGE_CODE', 'USAGE_CODE');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'UsageCodeModule') THEN
    CREATE TYPE "UsageCodeModule" AS ENUM ('VOICE_TO_TEXT');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'User'
      AND column_name = 'freeTtsUsedAt'
  ) THEN
    ALTER TABLE "User" ADD COLUMN "freeTtsUsedAt" TIMESTAMP(3);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'AnonymousUser'
      AND column_name = 'freeTtsUsedAt'
  ) THEN
    ALTER TABLE "AnonymousUser" ADD COLUMN "freeTtsUsedAt" TIMESTAMP(3);
  END IF;

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

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'TtsJob'
      AND column_name = 'accessKind'
  ) THEN
    ALTER TABLE "TtsJob" ADD COLUMN "accessKind" "TtsAccessKind" NOT NULL DEFAULT 'FREE_TRIAL';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'TtsJob'
      AND column_name = 'usageCodeId'
  ) THEN
    ALTER TABLE "TtsJob" ADD COLUMN "usageCodeId" TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'TtsJob'
      AND column_name = 'usageCodeModule'
  ) THEN
    ALTER TABLE "TtsJob" ADD COLUMN "usageCodeModule" "UsageCodeModule";
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'TtsJob'
      AND column_name = 'usageCodeValue'
  ) THEN
    ALTER TABLE "TtsJob" ADD COLUMN "usageCodeValue" TEXT;
  END IF;
END
$$;

ALTER TYPE "TtsAccessKind" ADD VALUE IF NOT EXISTS 'GENERAL_USAGE_CODE';

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
SQL
    ) || {
      echo "  ❌ 新建声结构补列失败，已中止后续 prisma db push"
      echo "  请先确认数据库连接、schema 指向与 ALTER TABLE / CREATE TABLE 权限"
      return 1
    }

    echo "    [2/4] 回填录音表与新必填字段"
    (
      cd "$SOURCE_DIR" &&
      DATABASE_URL="$DATABASE_URL" bunx prisma db execute --stdin <<SQL
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

ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_activeVoiceEnrollmentId_key";
ALTER TABLE "AnonymousUser" DROP CONSTRAINT IF EXISTS "AnonymousUser_activeVoiceEnrollmentId_key";

UPDATE "User" u
SET "freeTtsUsedAt" = first_job."createdAt"
FROM (
  SELECT "userId", MIN("createdAt") AS "createdAt"
  FROM "TtsJob"
  WHERE "userId" IS NOT NULL AND "status" = 'READY'
  GROUP BY "userId"
) first_job
WHERE u."id" = first_job."userId" AND u."freeTtsUsedAt" IS NULL;

UPDATE "AnonymousUser" a
SET "freeTtsUsedAt" = first_job."createdAt"
FROM (
  SELECT "anonymousUserId", MIN("createdAt") AS "createdAt"
  FROM "TtsJob"
  WHERE "anonymousUserId" IS NOT NULL AND "status" = 'READY'
  GROUP BY "anonymousUserId"
) first_job
WHERE a."id" = first_job."anonymousUserId" AND a."freeTtsUsedAt" IS NULL;
SQL
    ) || {
      echo "  ❌ 建声历史数据回填失败，已中止后续 prisma db push"
      echo "  请先检查 VoiceEnrollment / TtsJob 历史数据是否存在异常空值"
      return 1
    }

    echo "    [3/4] 创建两步建声所需索引"
    (
      cd "$SOURCE_DIR" &&
      DATABASE_URL="$DATABASE_URL" bunx prisma db execute --stdin <<'SQL'
CREATE UNIQUE INDEX IF NOT EXISTS "User_activePureVoiceEnrollmentId_key"
  ON "User"("activePureVoiceEnrollmentId");

CREATE UNIQUE INDEX IF NOT EXISTS "User_activeSceneVoiceEnrollmentId_key"
  ON "User"("activeSceneVoiceEnrollmentId");

CREATE UNIQUE INDEX IF NOT EXISTS "AnonymousUser_activePureVoiceEnrollmentId_key"
  ON "AnonymousUser"("activePureVoiceEnrollmentId");

CREATE UNIQUE INDEX IF NOT EXISTS "AnonymousUser_activeSceneVoiceEnrollmentId_key"
  ON "AnonymousUser"("activeSceneVoiceEnrollmentId");

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

CREATE UNIQUE INDEX IF NOT EXISTS "TtsJob_usageCodeId_key"
  ON "TtsJob"("usageCodeId");

CREATE INDEX IF NOT EXISTS "TtsJob_accessKind_createdAt_idx"
  ON "TtsJob"("accessKind", "createdAt");

CREATE INDEX IF NOT EXISTS "TtsJob_usageCodeModule_createdAt_idx"
  ON "TtsJob"("usageCodeModule", "createdAt");

CREATE INDEX IF NOT EXISTS "UsageCode_module_consumedAt_idx"
  ON "UsageCode"("module", "consumedAt");

CREATE INDEX IF NOT EXISTS "UsageCode_consumedAt_idx"
  ON "UsageCode"("consumedAt");

CREATE INDEX IF NOT EXISTS "UsageCode_consumedByUserId_consumedAt_idx"
  ON "UsageCode"("consumedByUserId", "consumedAt");
SQL
    ) || {
      echo "  ❌ 两步建声索引创建失败，已中止后续 prisma db push"
      echo "  请先检查历史脏数据是否导致唯一索引冲突"
      return 1
    }

    echo "  执行 AnonymousUser 兼容性回填"
    echo "    [1/3] 补齐 AnonymousUser 缺失列"
    (
      cd "$SOURCE_DIR" &&
      DATABASE_URL="$DATABASE_URL" bunx prisma db execute --stdin <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'AnonymousUser'
      AND column_name = 'tokenHash'
  ) THEN
    ALTER TABLE "AnonymousUser" ADD COLUMN "tokenHash" TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'AnonymousUser'
      AND column_name = 'expiresAt'
  ) THEN
    ALTER TABLE "AnonymousUser" ADD COLUMN "expiresAt" TIMESTAMP(3);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'AnonymousUser'
      AND column_name = 'lastSeenAt'
  ) THEN
    ALTER TABLE "AnonymousUser"
      ADD COLUMN "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
  END IF;
END
$$;
SQL
    ) || {
      echo "  ❌ AnonymousUser 补列失败，已中止后续 prisma db push"
      echo "  请先确认数据库连接、表存在性、schema 指向与 ALTER TABLE 权限"
      return 1
    }

    echo "    [2/3] 回填 AnonymousUser 历史数据"
    (
      cd "$SOURCE_DIR" &&
      DATABASE_URL="$DATABASE_URL" bunx prisma db execute --stdin <<'SQL'
UPDATE "AnonymousUser"
SET
  "tokenHash" = COALESCE("tokenHash", md5("id" || clock_timestamp()::text || random()::text)),
  "expiresAt" = COALESCE("expiresAt", CURRENT_TIMESTAMP),
  "lastSeenAt" = COALESCE("lastSeenAt", CURRENT_TIMESTAMP)
WHERE "tokenHash" IS NULL OR "expiresAt" IS NULL OR "lastSeenAt" IS NULL;
SQL
    ) || {
      echo "  ❌ AnonymousUser 历史数据回填失败，已中止后续 prisma db push"
      echo "  请先检查新列是否已创建，或手动执行回填 SQL 诊断"
      return 1
    }

    echo "    [3/3] 创建 AnonymousUser 索引"
    (
      cd "$SOURCE_DIR" &&
      DATABASE_URL="$DATABASE_URL" bunx prisma db execute --stdin <<'SQL'
CREATE UNIQUE INDEX IF NOT EXISTS "AnonymousUser_tokenHash_key"
  ON "AnonymousUser"("tokenHash");

CREATE INDEX IF NOT EXISTS "AnonymousUser_expiresAt_idx"
  ON "AnonymousUser"("expiresAt");
SQL
    ) || {
      echo "  ❌ AnonymousUser 索引创建失败，已中止后续 prisma db push"
      echo "  请先检查现有脏数据是否导致唯一索引创建失败"
      return 1
    }

    echo "    [4/4] 执行 prisma db push"
    (cd "$SOURCE_DIR" && DATABASE_URL="$DATABASE_URL" bunx prisma db push --accept-data-loss 2>&1) || {
      echo "  ⚠️  数据库同步失败，请手动执行:"
      echo "  cd $SOURCE_DIR && DATABASE_URL='<database-url>' bunx prisma db push --accept-data-loss"
    }
  else
    echo "  ⚠️  未找到 bunx，请手动安装 Bun 后执行:"
    echo "  cd $SOURCE_DIR && DATABASE_URL='<database-url>' bunx prisma db push --accept-data-loss"
  fi
}

if [ "$MODE" = "--db-only" ]; then
  sync_database
  exit 0
fi

if [ ! -f "./voice-mvp-api" ]; then
  echo "错误：当前目录下未找到 voice-mvp-api 二进制文件"
  echo "请先在构建环境中执行: bun build --compile ./src/index.ts --outfile ./voice-mvp-api --target bun"
  exit 1
fi

echo "[1/7] 创建系统用户"
id -u "$SERVICE_USER" &>/dev/null || useradd -r -s /sbin/nologin "$SERVICE_USER"

echo "[2/7] 创建安装目录"
mkdir -p "$INSTALL_DIR/prisma"
cp -f ./voice-mvp-api "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/voice-mvp-api"

# 复制 Prisma schema，部署时需要用它执行数据库迁移
if [ -f "./prisma/schema.prisma" ]; then
  cp -f ./prisma/schema.prisma "$INSTALL_DIR/prisma/"
  echo "  已复制 prisma/schema.prisma"
elif [ -f "../prisma/schema.prisma" ]; then
  cp -f ../prisma/schema.prisma "$INSTALL_DIR/prisma/"
  echo "  已复制 prisma/schema.prisma"
fi

if [ -f "./prisma.config.ts" ]; then
  cp -f ./prisma.config.ts "$INSTALL_DIR/prisma.config.ts"
  echo "  已复制 prisma.config.ts"
fi

echo "[3/7] 安装配置文件"
if [ ! -f "$INSTALL_DIR/config.yaml" ]; then
  cp -f ./config.example.yaml "$INSTALL_DIR/config.yaml"
  echo "  已生成默认配置文件: $INSTALL_DIR/config.yaml"
  echo "  请编辑后重新部署"
  echo ""
  echo "  vi $INSTALL_DIR/config.yaml"
else
  echo "  配置文件已存在，跳过（如需更新请手动编辑）"
fi

echo "[4/7] 创建日志目录"
LOG_DIR=$(grep 'logDir' "$INSTALL_DIR/config.yaml" 2>/dev/null | awk '{print $2}' | tr -d '"' || echo "/var/log/voice-mvp")
mkdir -p "${LOG_DIR:-/var/log/voice-mvp}"
chown -R "$SERVICE_USER:$SERVICE_USER" "${LOG_DIR:-/var/log/voice-mvp}"

echo "[5/7] 同步数据库表结构"
sync_database

echo "[6/7] 安装 systemd 服务"
cp -f ./${APP_NAME}.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable "$APP_NAME"

echo "[7/7] 设置目录权限"
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

echo ""
echo "=== 部署完成 ==="
echo ""
echo "  配置文件: $INSTALL_DIR/config.yaml"
echo "  日志目录: ${LOG_DIR:-/var/log/voice-mvp}"
echo ""
echo "  启动服务:  systemctl start $APP_NAME"
echo "  查看状态:  systemctl status $APP_NAME"
echo "  查看日志:  journalctl -u $APP_NAME -f"
echo "  停止服务:  systemctl stop $APP_NAME"
echo "  重启服务:  systemctl restart $APP_NAME"
