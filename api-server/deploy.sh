#!/bin/bash
set -euo pipefail

APP_NAME="voice-mvp-api"
INSTALL_DIR="/opt/voice-mvp"
SERVICE_USER="voice-mvp"

echo "=== Voice MVP API 部署脚本 ==="

if [ ! -f "./voice-mvp-api" ]; then
  echo "错误：当前目录下未找到 voice-mvp-api 二进制文件"
  echo "请先在构建环境中执行: bun build --compile ./src/index.ts --outfile ./voice-mvp-api --target bun"
  exit 1
fi

echo "[1/6] 创建系统用户"
id -u "$SERVICE_USER" &>/dev/null || useradd -r -s /sbin/nologin "$SERVICE_USER"

echo "[2/6] 创建安装目录"
mkdir -p "$INSTALL_DIR"
cp -f ./voice-mvp-api "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/voice-mvp-api"

echo "[3/6] 安装配置文件"
if [ ! -f "$INSTALL_DIR/config.yaml" ]; then
  cp -f ./config.example.yaml "$INSTALL_DIR/config.yaml"
  echo "  已生成默认配置文件: $INSTALL_DIR/config.yaml"
  echo "  请编辑后重新部署"
  echo ""
  echo "  vi $INSTALL_DIR/config.yaml"
else
  echo "  配置文件已存在，跳过（如需更新请手动编辑）"
fi

echo "[4/6] 创建日志目录"
LOG_DIR=$(grep 'logDir' "$INSTALL_DIR/config.yaml" 2>/dev/null | awk '{print $2}' | tr -d '"' || echo "/var/log/voice-mvp")
mkdir -p "${LOG_DIR:-/var/log/voice-mvp}"
chown -R "$SERVICE_USER:$SERVICE_USER" "${LOG_DIR:-/var/log/voice-mvp}"

echo "[5/6] 安装 systemd 服务"
cp -f ./${APP_NAME}.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable "$APP_NAME"

echo "[6/6] 设置目录权限"
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
