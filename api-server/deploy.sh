#!/bin/bash
set -euo pipefail

APP_NAME="voice-mvp-api"
INSTALL_DIR="/opt/voice-mvp"
SERVICE_USER="voice-mvp"

echo "=== Voice MVP API 文件部署脚本 ==="

if [ ! -f "./voice-mvp-api" ]; then
  echo "错误：当前目录下未找到 voice-mvp-api 二进制文件"
  echo "请先在构建环境中执行: bun build --compile ./src/index.ts --outfile ./voice-mvp-api --target bun"
  exit 1
fi

echo "[1/6] 创建系统用户"
id -u "$SERVICE_USER" &>/dev/null || useradd -r -s /sbin/nologin "$SERVICE_USER"

echo "[2/6] 创建安装目录"
mkdir -p "$INSTALL_DIR/prisma"
cp -f ./voice-mvp-api "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/voice-mvp-api"

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

if [ -f "./init-db.sql" ]; then
  cp -f ./init-db.sql "$INSTALL_DIR/init-db.sql"
  echo "  已复制 init-db.sql"
fi

echo "[3/6] 安装配置文件"
if [ ! -f "$INSTALL_DIR/config.yaml" ]; then
  cp -f ./config.example.yaml "$INSTALL_DIR/config.yaml"
  echo "  已生成默认配置文件: $INSTALL_DIR/config.yaml"
  echo "  请编辑数据库、MinIO、Qwen 与后台账号配置后再启动服务"
else
  echo "  配置文件已存在，跳过（如需更新请手动编辑）"
fi

echo "[4/6] 创建日志目录"
LOG_DIR=$(grep 'logDir' "$INSTALL_DIR/config.yaml" 2>/dev/null | awk '{print $2}' | tr -d '"' || true)
LOG_DIR=${LOG_DIR:-/var/log/voice-mvp}
mkdir -p "$LOG_DIR"
chown -R "$SERVICE_USER:$SERVICE_USER" "$LOG_DIR"

echo "[5/6] 安装 systemd 服务"
if [ -f "./${APP_NAME}.service" ]; then
  cp -f "./${APP_NAME}.service" /etc/systemd/system/
elif [ -f "../systemd/${APP_NAME}.service" ]; then
  cp -f "../systemd/${APP_NAME}.service" /etc/systemd/system/
else
  echo "错误：未找到 ${APP_NAME}.service"
  exit 1
fi
systemctl daemon-reload
systemctl enable "$APP_NAME"

echo "[6/6] 设置目录权限"
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

echo ""
echo "=== 文件部署完成 ==="
echo ""
echo "  配置文件: $INSTALL_DIR/config.yaml"
echo "  日志目录: $LOG_DIR"
echo "  数据库初始化: PGPASSWORD='<密码>' psql -h 127.0.0.1 -U voice_mvp -d voice_mvp -v ON_ERROR_STOP=1 -f $INSTALL_DIR/init-db.sql"
echo "  启动服务:  systemctl start $APP_NAME"
echo "  查看状态:  systemctl status $APP_NAME"
echo "  查看日志:  journalctl -u $APP_NAME -f"
