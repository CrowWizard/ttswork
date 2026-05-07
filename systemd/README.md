# Bili Remote - systemd 部署说明

## 文件清单

| 文件 | 用途 |
|:---|:---|
| `bili-xvfb.service` | 虚拟显示器 :99 |
| `bili-openbox.service` | 轻量窗口管理器 |
| `bili-x11vnc.service` | VNC 远程访问 |
| `bili-worker.service` | 视频分析 worker |

## 部署步骤

### 1. 创建用户

```bash
sudo useradd -r -m -s /bin/bash biliworker
```

### 2. 准备目录

```bash
sudo mkdir -p /opt/bili-remote/profile /opt/bili-remote/logs
sudo chown -R biliworker:biliworker /opt/bili-remote
```

### 3. 设置 VNC 密码

```bash
sudo -u biliworker x11vnc -storepasswd
# 密码保存到 /home/biliworker/.vnc/passwd
```

### 4. 安装依赖

```bash
sudo dnf install -y epel-release
sudo dnf install -y xorg-x11-server-Xvfb x11vnc openbox dbus-x11 xorg-x11-xauth google-chrome-stable
```

### 5. 安装 service 文件

```bash
sudo cp systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
```

### 6. 启动服务

```bash
sudo systemctl enable --now bili-xvfb.service
sudo systemctl enable --now bili-openbox.service
sudo systemctl enable --now bili-x11vnc.service
sudo systemctl enable --now bili-worker.service
```

### 7. 防火墙

```bash
sudo firewall-cmd --permanent --add-port=5900/tcp
sudo firewall-cmd --reload
```

## 启停速查

```bash
sudo systemctl status bili-xvfb bili-openbox bili-x11vnc bili-worker
sudo systemctl restart bili-worker
journalctl -u bili-worker -f
journalctl -u bili-x11vnc -f
```

## 首次登录 B站

VNC 连接 `服务器IP:5900`，打开 Chrome 登录一次，登录态保存在 `/opt/bili-remote/profile`。

```bash
sudo -u biliworker DISPLAY=:99 google-chrome \
  --user-data-dir=/opt/bili-remote/profile \
  --no-first-run \
  --no-default-browser-check \
  --disable-gpu \
  --disable-dev-shm-usage \
  --start-maximized \
  https://www.bilibili.com
```

## 安全建议

- 不要把 5900 端口直接暴露公网，优先用 SSH 隧道：`ssh -L 5900:127.0.0.1:5900 user@server`
- 浏览器不要用 root 运行
- 定期备份 `/opt/bili-remote/profile`

## 如果 worker 使用 venv

修改 `bili-worker.service` 的 ExecStart：

```ini
ExecStart=/home/biliworker/venv/bin/python worker.py
```