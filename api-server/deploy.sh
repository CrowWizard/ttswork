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
    echo "  执行 prisma db push ..."
    (cd "$SOURCE_DIR" && DATABASE_URL="$DATABASE_URL" bunx prisma db push --skip-generate --accept-data-loss 2>&1) || {
      echo "  ⚠️  数据库同步失败，请手动执行:"
      echo "  cd $SOURCE_DIR && DATABASE_URL='<database-url>' bunx prisma db push --skip-generate"
    }
  else
    echo "  ⚠️  未找到 bunx，请手动安装 Bun 后执行:"
    echo "  cd $SOURCE_DIR && DATABASE_URL='<database-url>' bunx prisma db push --skip-generate"
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
