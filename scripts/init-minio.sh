#!/bin/bash
set -euo pipefail

MINIO_ALIAS="voice-mvp-local"
MINIO_ENDPOINT="http://127.0.0.1:9000"
MINIO_ACCESS_KEY="minioadmin"
MINIO_SECRET_KEY="minioadmin"
MINIO_BUCKET="voice-mvp"

echo "=== MinIO 初始化 ==="

if ! command -v mc &>/dev/null; then
  echo "[info] 安装 mc (MinIO Client)..."
  curl -fsSL https://dl.min.io/client/mc/release/linux-amd64/mc -o /usr/local/bin/mc
  chmod +x /usr/local/bin/mc
fi

mc alias set "${MINIO_ALIAS}" "${MINIO_ENDPOINT}" "${MINIO_ACCESS_KEY}" "${MINIO_SECRET_KEY}"

echo "[ok] MinIO alias 已配置: ${MINIO_ALIAS} -> ${MINIO_ENDPOINT}"

if mc ls "${MINIO_ALIAS}/${MINIO_BUCKET}" &>/dev/null; then
  echo "[ok] Bucket ${MINIO_BUCKET} 已存在，跳过"
else
  mc mb "${MINIO_ALIAS}/${MINIO_BUCKET}"
  echo "[ok] Bucket ${MINIO_BUCKET} 已创建"
fi

mc ls "${MINIO_ALIAS}/${MINIO_BUCKET}" >/dev/null 2>&1
echo "[ok] Bucket 可访问"
echo ""
echo "MinIO 管理控制台: http://127.0.0.1:9001"
echo "API Endpoint: ${MINIO_ENDPOINT}"
echo "Bucket: ${MINIO_BUCKET}"
