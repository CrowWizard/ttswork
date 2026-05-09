#!/bin/bash
set -euo pipefail

APP_NAME="voice-mvp-api"
PACKAGE_DIR="${PACKAGE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
API_DIR="$PACKAGE_DIR/api-server"
INSTALL_DIR="${INSTALL_DIR:-/opt/voice-mvp}"
BACKUP_DIR="${BACKUP_DIR:-/opt/voice-mvp-backups}"
FRONTEND_OUTPUT_DIR="${FRONTEND_OUTPUT_DIR:-/var/www/voice-mvp}"
SERVICE_FILE="${SERVICE_FILE:-$PACKAGE_DIR/systemd/voice-mvp-api.service}"

echo "=== Voice MVP 文件更新脚本 ==="

if [ ! -f "$API_DIR/voice-mvp-api" ]; then
  echo "错误：未找到 API 二进制文件: $API_DIR/voice-mvp-api"
  exit 1
fi

if [ ! -d "$PACKAGE_DIR/out" ]; then
  echo "错误：未找到前端静态目录: $PACKAGE_DIR/out"
  exit 1
fi

timestamp=$(date +%Y%m%d%H%M%S)
mkdir -p "$BACKUP_DIR" "$INSTALL_DIR/prisma" "$FRONTEND_OUTPUT_DIR"

echo "[1/5] 备份当前服务文件"
if [ -d "$INSTALL_DIR" ] && [ "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
  api_backup_path="$BACKUP_DIR/voice-mvp-api-$timestamp"
  mkdir -p "$api_backup_path"
  cp -a "$INSTALL_DIR"/. "$api_backup_path"/
  echo "  已备份 API 文件到: $api_backup_path"
fi

echo "[2/5] 更新 API 文件"
cp -f "$API_DIR/voice-mvp-api" "$INSTALL_DIR/voice-mvp-api"
chmod +x "$INSTALL_DIR/voice-mvp-api"

if [ -f "$API_DIR/prisma/schema.prisma" ]; then
  cp -f "$API_DIR/prisma/schema.prisma" "$INSTALL_DIR/prisma/schema.prisma"
fi

if [ -f "$API_DIR/prisma.config.ts" ]; then
  cp -f "$API_DIR/prisma.config.ts" "$INSTALL_DIR/prisma.config.ts"
fi

if [ -f "$API_DIR/init-db.sql" ]; then
  cp -f "$API_DIR/init-db.sql" "$INSTALL_DIR/init-db.sql"
fi

if [ ! -f "$INSTALL_DIR/config.yaml" ]; then
  cp -f "$API_DIR/config.example.yaml" "$INSTALL_DIR/config.yaml"
  echo "  已生成默认配置文件: $INSTALL_DIR/config.yaml"
fi

if id -u voice-mvp &>/dev/null; then
  chown -R voice-mvp:voice-mvp "$INSTALL_DIR"
fi

echo "[3/5] 更新 systemd 服务文件"
if [ -f "$SERVICE_FILE" ]; then
  cp -f "$SERVICE_FILE" /etc/systemd/system/voice-mvp-api.service
  systemctl daemon-reload
else
  echo "  未找到服务文件，跳过: $SERVICE_FILE"
fi

echo "[4/5] 更新前端静态文件"
frontend_backup_path="$BACKUP_DIR/voice-mvp-frontend-$timestamp"
if [ -d "$FRONTEND_OUTPUT_DIR" ] && [ "$(ls -A "$FRONTEND_OUTPUT_DIR" 2>/dev/null)" ]; then
  mkdir -p "$frontend_backup_path"
  cp -a "$FRONTEND_OUTPUT_DIR"/. "$frontend_backup_path"/
  echo "  已备份前端文件到: $frontend_backup_path"
fi
rm -rf "$FRONTEND_OUTPUT_DIR"/*
cp -a "$PACKAGE_DIR/out"/. "$FRONTEND_OUTPUT_DIR"/

echo "[5/5] 重启服务"
if command -v systemctl &>/dev/null; then
  systemctl restart "$APP_NAME"
  systemctl status "$APP_NAME" --no-pager --lines=20
else
  echo "  当前环境无 systemctl，已跳过服务重启"
fi

echo "=== 文件更新完成 ==="
