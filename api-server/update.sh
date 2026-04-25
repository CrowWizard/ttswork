#!/bin/bash
set -euo pipefail

APP_NAME="voice-mvp-api"
REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
API_DIR="$REPO_DIR/api-server"
INSTALL_DIR="${INSTALL_DIR:-/opt/voice-mvp}"
BACKUP_DIR="${BACKUP_DIR:-/opt/voice-mvp-backups}"
FRONTEND_OUTPUT_DIR="${FRONTEND_OUTPUT_DIR:-/var/www/voice-mvp}"

echo "=== Voice MVP 自动更新脚本 ==="

if ! command -v git &>/dev/null; then
  echo "错误：未找到 git"
  exit 1
fi

if ! command -v bun &>/dev/null || ! command -v bunx &>/dev/null; then
  echo "错误：未找到 bun/bunx，请先安装 Bun"
  exit 1
fi

cd "$REPO_DIR"

echo "[1/7] 拉取最新代码"
git pull --ff-only

echo "[2/7] 安装前端依赖"
bun install --frozen-lockfile

echo "[3/7] 安装 API 依赖"
(cd "$API_DIR" && bun install --frozen-lockfile)

echo "[4/7] 生成 Prisma Client"
bunx prisma generate
(cd "$API_DIR" && bunx prisma generate)

echo "[5/7] 构建并发布前端静态文件"
bun run build
echo "  发布前端文件到: $FRONTEND_OUTPUT_DIR"
mkdir -p "$FRONTEND_OUTPUT_DIR"
rm -rf "$FRONTEND_OUTPUT_DIR"/*
cp -a "$REPO_DIR/out"/. "$FRONTEND_OUTPUT_DIR"/

echo "[6/7] 构建并更新 API 文件"
(cd "$API_DIR" && bun run build)
timestamp=$(date +%Y%m%d%H%M%S)
mkdir -p "$BACKUP_DIR" "$INSTALL_DIR/prisma"

if [ -d "$INSTALL_DIR" ] && [ "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
  backup_path="$BACKUP_DIR/voice-mvp-$timestamp"
  mkdir -p "$backup_path"
  cp -a "$INSTALL_DIR"/. "$backup_path"/
  echo "  已备份旧文件到: $backup_path"
fi

cp -f "$API_DIR/voice-mvp-api" "$INSTALL_DIR/voice-mvp-api"
chmod +x "$INSTALL_DIR/voice-mvp-api"
cp -f "$API_DIR/prisma/schema.prisma" "$INSTALL_DIR/prisma/schema.prisma"
cp -f "$API_DIR/prisma.config.ts" "$INSTALL_DIR/prisma.config.ts"

if [ ! -f "$INSTALL_DIR/config.yaml" ]; then
  cp -f "$API_DIR/config.example.yaml" "$INSTALL_DIR/config.yaml"
  echo "  已生成默认配置文件: $INSTALL_DIR/config.yaml"
fi

if id -u voice-mvp &>/dev/null; then
  chown -R voice-mvp:voice-mvp "$INSTALL_DIR"
fi

echo "  同步数据库表结构"
(cd "$API_DIR" && SOURCE_DIR="$API_DIR" ./deploy.sh --db-only)

echo "[7/7] 重启服务"
if command -v systemctl &>/dev/null; then
  systemctl restart "$APP_NAME"
  systemctl status "$APP_NAME" --no-pager --lines=20
else
  echo "  当前环境无 systemctl，已跳过服务重启"
fi

echo "=== 自动更新完成 ==="
