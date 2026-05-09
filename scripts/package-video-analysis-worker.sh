#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKER_DIR="$ROOT_DIR/video-analysis-worker"
OUTPUT_DIR="${OUTPUT_DIR:-$ROOT_DIR/dist}"
PACKAGE_NAME="${PACKAGE_NAME:-video-analysis-worker-$(date +%Y%m%d%H%M%S).tar.gz}"
PACKAGE_PATH="$OUTPUT_DIR/$PACKAGE_NAME"

echo "=== 打包 video-analysis-worker ==="

if [ ! -d "$WORKER_DIR" ]; then
  echo "错误：未找到目录 $WORKER_DIR"
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

tar \
  --create \
  --gzip \
  --file "$PACKAGE_PATH" \
  --directory "$ROOT_DIR" \
  --exclude='video-analysis-worker/.env' \
  --exclude='video-analysis-worker/.env.*' \
  --exclude='video-analysis-worker/.venv' \
  --exclude='video-analysis-worker/venv' \
  --exclude='video-analysis-worker/.biliapi-profile' \
  --exclude='video-analysis-worker/tmp' \
  --exclude='video-analysis-worker/logs' \
  --exclude='video-analysis-worker/tests' \
  --exclude='video-analysis-worker/scripts' \
  --exclude='video-analysis-worker/__pycache__' \
  --exclude='video-analysis-worker/**/__pycache__' \
  --exclude='video-analysis-worker/.pytest_cache' \
  --exclude='video-analysis-worker/**/*.pyc' \
  --exclude='video-analysis-worker/**/*.pyo' \
  --exclude='video-analysis-worker/**/*.log' \
  --exclude='video-analysis-worker/.DS_Store' \
  video-analysis-worker

echo "[ok] 已生成: $PACKAGE_PATH"
echo "[ok] 查看内容: tar -tzf '$PACKAGE_PATH'"
