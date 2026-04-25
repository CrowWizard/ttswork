# Voice MVP 部署与运维手册

> 最后更新：2026-04-24
>
> 本文档包含：PostgreSQL/MinIO 初始化脚本、Makefile 用法、VSCode 调试配置说明、
> systemd 服务配置、Rocky 9 与 CentOS 7 兼容性分析、配置文件与日志方案。

---

## 目录

1. [基础设施初始化脚本](#1-基础设施初始化脚本)
   - [PostgreSQL](#11-postgresql)
   - [MinIO](#12-minio)
2. [Makefile 用法](#2-makefile-用法)
3. [VSCode 调试配置](#3-vscode-调试配置)
4. [systemd 服务管理](#4-systemd-服务管理)
5. [Rocky 9 与 CentOS 7 兼容性](#5-rocky-9-与-centos-7-兼容性)
6. [配置文件与日志](#6-配置文件与日志)
7. [完整部署流程](#7-完整部署流程)
8. [Nginx 反向代理配置](#8-nginx-反向代理配置)

---

## 1. 基础设施初始化脚本

### 1.1 PostgreSQL

以下脚本创建数据库角色、数据库，并授权。根据实际环境修改 `DB_PASS`。

```bash
#!/bin/bash
# scripts/init-postgres.sh
# 用法: sudo -u postgres bash scripts/init-postgres.sh

set -euo pipefail

DB_NAME="voice_mvp"
DB_USER="voice_mvp"
DB_PASS="your_password"  # 生产环境请替换为强密码
DB_SCHEMA="public"

echo "=== PostgreSQL 初始化 ==="

# 创建角色（如已存在则跳过）
psql -v ON_ERROR_STOP=0 <<-EOSQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
      CREATE ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASS}';
      RAISE NOTICE '角色 ${DB_USER} 已创建';
    ELSE
      RAISE NOTICE '角色 ${DB_USER} 已存在，跳过';
    END IF;
  END
  \$\$;
EOSQL

# 创建数据库（如已存在则跳过）
psql -v ON_ERROR_STOP=0 <<-EOSQL
  SELECT 'CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}')\\gexec
EOSQL

echo "[ok] 数据库 ${DB_NAME} 已就绪"

# 授权
psql -d "${DB_NAME}" -v ON_ERROR_STOP=0 <<-EOSQL
  GRANT ALL ON SCHEMA ${DB_SCHEMA} TO ${DB_USER};
  GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
  ALTER DEFAULT PRIVILEGES IN SCHEMA ${DB_SCHEMA}
    GRANT ALL ON TABLES TO ${DB_USER};
  ALTER DEFAULT PRIVILEGES IN SCHEMA ${DB_SCHEMA}
    GRANT ALL ON SEQUENCES TO ${DB_USER};
EOSQL

echo "[ok] 权限已授予"
echo ""
echo "连接串："
echo "  postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}?schema=${DB_SCHEMA}"
```

**执行方式**（二选一）：

```bash
# 方式一：本机 PostgreSQL
sudo -u postgres bash scripts/init-postgres.sh

# 方式二：Docker
docker compose up -d postgres
# 等待就绪后连接
docker exec -it voice-mvp-postgres psql -U postgres -f /dev/stdin < scripts/init-postgres.sh
```

### 1.2 MinIO

以下脚本初始化 MinIO Bucket。需要安装 `mc`（MinIO Client）。

```bash
#!/bin/bash
# scripts/init-minio.sh
# 用法: bash scripts/init-minio.sh

set -euo pipefail

MINIO_ALIAS="voice-mvp-local"
MINIO_ENDPOINT="http://127.0.0.1:9000"
MINIO_ACCESS_KEY="minioadmin"   # 生产环境请替换
MINIO_SECRET_KEY="minioadmin"   # 生产环境请替换
MINIO_BUCKET="voice-mvp"

echo "=== MinIO 初始化 ==="

# 检查 mc 是否已安装
if ! command -v mc &>/dev/null; then
  echo "[info] 安装 mc (MinIO Client)..."
  curl -fsSL https://dl.min.io/client/mc/release/linux-amd64/mc -o /usr/local/bin/mc
  chmod +x /usr/local/bin/mc
fi

# 配置 alias（如已存在则覆盖）
mc alias set "${MINIO_ALIAS}" "${MINIO_ENDPOINT}" "${MINIO_ACCESS_KEY}" "${MINIO_SECRET_KEY}"

echo "[ok] MinIO alias 已配置: ${MINIO_ALIAS} -> ${MINIO_ENDPOINT}"

# 创建 Bucket（如已存在则跳过）
if mc ls "${MINIO_ALIAS}/${MINIO_BUCKET}" &>/dev/null; then
  echo "[ok] Bucket ${MINIO_BUCKET} 已存在，跳过"
else
  mc mb "${MINIO_ALIAS}/${MINIO_BUCKET}"
  echo "[ok] Bucket ${MINIO_BUCKET} 已创建"
fi

# 验证
mc ls "${MINIO_ALIAS}/${MINIO_BUCKET}" >/dev/null 2>&1
echo "[ok] Bucket 可访问"

echo ""
echo "MinIO 管理控制台: http://127.0.0.1:9001"
echo "API Endpoint: ${MINIO_ENDPOINT}"
echo "Bucket: ${MINIO_BUCKET}"
```

**执行方式**（二选一）：

```bash
# 方式一：本机 MinIO
bash scripts/init-minio.sh

# 方式二：Docker
docker compose up -d minio
bash scripts/init-minio.sh
```

### 1.3 Prisma 数据库迁移

基础设施就绪后，执行数据库表结构迁移：

```bash
# 开发环境（创建迁移文件并应用）
bunx prisma migrate dev --name init

# 生产环境（仅应用已有迁移）
bunx prisma migrate deploy
```

---

## 2. Makefile 用法

项目根目录已提供 `Makefile`，以下是完整命令清单：

```bash
make help              # 显示帮助信息

# 依赖安装
make install           # 安装前端 + API 全部依赖
make install-frontend  # 仅安装前端依赖 (npm install)
make install-api       # 仅安装 API 依赖 (bun install)

# 数据库
make prisma-generate   # 生成 Prisma Client（前端 + API 两处）
make prisma-migrate    # 执行数据库迁移

# 构建
make build             # 构建前端静态文件 + API 二进制（一键出产物）
make build-frontend    # 仅构建前端 → out/ 目录（约 852KB）
make build-api         # 仅编译 API → api-server/voice-mvp-api（约 96MB）

# 开发
make dev               # 同时启动前端 (:3000) + API (:3001)
make dev-frontend      # 仅启动前端 (npm run dev)
make dev-api           # 仅启动 API (bun run --hot)

# 清理
make clean             # 删除 out/、.next/、api-server/voice-mvp-api
```

---

## 3. VSCode 调试配置

`.vscode/launch.json` 已更新为前后端分离架构，提供 4 种调试配置：

| 配置名称 | 说明 | 端口 |
|:---|:---|:---|
| **Next.js: 前端开发** | 启动 Next.js dev server | :3000 |
| **API: Bun 调试** | 用 Bun `--inspect-wait` 调试 API，可设断点 | :3001 / 调试 :6499 |
| **浏览器: 打开前端** | Chrome DevTools 调试前端 | :3000 |
| **全栈: 前端 + API** | 先启动 API（preLaunchTask），再启动前端并自动打开浏览器 | :3000 + :3001 |

`.vscode/tasks.json` 新增了 `api-server` 后台任务，供"全栈"调试配置自动启动 API。

**使用方法**：
1. 按 `F5` 或在调试面板选择对应配置
2. API 调试需先确保 `api-server/.env` 或 `api-server/config.yaml` 已配置
3. 全栈调试会自动并发启动两端服务

---

## 4. systemd 服务管理

### 4.1 服务文件

`api-server/voice-mvp-api.service`：

```ini
[Unit]
Description=Voice MVP API Server (Bun)
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=voice-mvp
Group=voice-mvp
WorkingDirectory=/opt/voice-mvp
ExecStart=/opt/voice-mvp/voice-mvp-api
Environment=CONFIG_PATH=/opt/voice-mvp/config.yaml
Environment=NODE_ENV=production
Restart=on-failure
RestartSec=5
StartLimitBurst=5
StartLimitIntervalSec=60

StandardOutput=journal
StandardError=journal
SyslogIdentifier=voice-mvp-api

LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

### 4.2 一键部署

```bash
cd api-server
sudo ./deploy.sh
```

`deploy.sh` 会自动完成：创建系统用户 → 复制二进制 → 生成配置文件模板 → 创建日志目录 → 安装 service → 设置权限。

### 4.3 常用运维命令

```bash
sudo systemctl start voice-mvp-api      # 启动
sudo systemctl stop voice-mvp-api       # 停止
sudo systemctl restart voice-mvp-api    # 重启
sudo systemctl status voice-mvp-api     # 查看状态

# 实时日志
journalctl -u voice-mvp-api -f

# 最近 100 行日志
journalctl -u voice-mvp-api -n 100

# 按时间过滤
journalctl -u voice-mvp-api --since "2026-04-24 19:00:00"
```

---

## 5. Rocky 9 与 CentOS 7 兼容性

### 结论：Rocky 9 编译的二进制不能在 CentOS 7 上运行

| 系统 | GLIBC 版本 | Bun 编译产物要求 |
|:---|:---|:---|
| Rocky Linux 9 | 2.34 | GLIBC 2.17 ~ 2.25 |
| CentOS 7 | **2.17** | **2.25（不满足）** |

实测 `voice-mvp-api` 依赖的最高符号版本为 `GLIBC_2.25`（来自 `memcpy@GLIBC_2.25` 等），CentOS 7 最高只提供 `GLIBC_2.17`，运行时会报：

```
/lib64/libc.so.6: version `GLIBC_2.25' not found
```

### 解决方案：在 CentOS 7 上本地编译

```bash
# 1. 在 CentOS 7 上安装 Bun
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc

# 2. 将 api-server/ 源码复制到 CentOS 7 机器
scp -r api-server/ centos7:/opt/voice-mvp-src/

# 3. 在 CentOS 7 上编译
cd /opt/voice-mvp-src
bun install
bunx prisma generate
bun build --compile ./src/index.ts --outfile ./voice-mvp-api --target bun

# 4. 编译产物可以直接在当前 CentOS 7 上运行
./voice-mvp-api
```

Bun 在编译时会链接当前系统的 glibc，因此在 CentOS 7 上编译出的产物天然兼容 GLIBC 2.17。

### 不推荐方案（供参考）

- 升级 CentOS 7 的 glibc → 极高风险，可能导致系统不可用
- Docker 容器化 → 可行但增加了部署复杂度，不如直接在目标机器编译

---

## 6. 配置文件与日志

### 6.1 配置文件格式

API 支持外部 YAML 配置文件（`api-server/config.example.yaml`）：

```yaml
server:
  port: 3001              # API 监听端口
  logLevel: "info"        # debug / info / warn / error
  logDir: "/var/log/voice-mvp"  # 日志目录

database:
  host: "127.0.0.1"       # PostgreSQL 地址
  port: 5432              # PostgreSQL 端口
  name: "voice_mvp"       # 数据库名
  user: "voice_mvp"       # 用户名
  password: "your_password"  # 密码
  schema: "public"        # Schema

minio:
  endpoint: "127.0.0.1"   # MinIO 地址
  port: 9000              # MinIO API 端口
  useSSL: false           # 是否启用 HTTPS
  accessKey: "minioadmin"
  secretKey: "minioadmin"
  bucket: "voice-mvp"

qwen:
  mockMode: true           # true=本地Mock / false=调用通义千问
  apiKey: ""               # 通义千问 API Key
  enrollUrl: ""            # 建声接口地址
  ttsUrl: ""               # TTS 接口地址

cookie:
  secure: false            # 生产环境建议 true（需 HTTPS）
  maxAge: 31536000         # Cookie 有效期（秒），默认 1 年
```

### 6.2 配置文件搜索路径

优先级从高到低：

1. `CONFIG_PATH` 环境变量指定的绝对路径
2. `{工作目录}/config.yaml`
3. `{工作目录}/config.yml`
4. `/etc/voice-mvp/config.yaml`

**环境变量可覆盖 YAML 中的任意配置项**。对应关系：

| 环境变量 | YAML 字段 |
|:---|:---|
| `PORT` | server.port |
| `LOG_LEVEL` | server.logLevel |
| `LOG_DIR` | server.logDir |
| `DB_HOST` | database.host |
| `DB_PORT` | database.port |
| `DB_NAME` | database.name |
| `DB_USER` | database.user |
| `DB_PASSWORD` | database.password |
| `MINIO_ENDPOINT` | minio.endpoint |
| `MINIO_PORT` | minio.port |
| `MINIO_USE_SSL` | minio.useSSL |
| `MINIO_ACCESS_KEY` | minio.accessKey |
| `MINIO_SECRET_KEY` | minio.secretKey |
| `MINIO_BUCKET` | minio.bucket |
| `QWEN_MOCK_MODE` | qwen.mockMode |
| `QWEN_API_KEY` | qwen.apiKey |
| `QWEN_ENROLL_URL` | qwen.enrollUrl |
| `QWEN_TTS_URL` | qwen.ttsUrl |
| `COOKIE_SECURE` | cookie.secure |
| `COOKIE_MAX_AGE` | cookie.maxAge |

### 6.3 日志

- **stdout/stderr**：所有日志输出到标准输出，systemd 自动收集到 journal
- **查看日志**：`journalctl -u voice-mvp-api -f`
- **日志目录**：`server.logDir` 配置项，服务启动时自动创建

启动时输出配置摘要，便于排查：

```
[config] 加载配置文件: /opt/voice-mvp/config.yaml
[config] server.port=3001
[config] database=127.0.0.1:5432/voice_mvp
[config] minio=127.0.0.1:9000/voice-mvp
[config] qwen.mockMode=true
[config] log.dir=/var/log/voice-mvp
[voice-mvp-api] listening on port 3001
```

---

## 7. 完整部署流程

### 7.1 构建

```bash
# 在构建机器上（Rocky 9 / CentOS 7 均可，需安装 Bun）
cd /path/to/ttswork

# 一键构建全部产物
make build

# 产物清单：
#   out/                           ← 前端静态文件（~852KB）
#   api-server/voice-mvp-api       ← API 二进制（~96MB）
```

### 7.2 部署到服务器

```bash
# 方式一：使用 deploy.sh（推荐）
cd api-server
# 编辑 config.yaml 配置实际数据库/MinIO/Qwen 参数
cp config.example.yaml config.yaml
vi config.yaml
sudo ./deploy.sh

# 方式二：手动部署
sudo mkdir -p /opt/voice-mvp /var/www/voice-mvp /var/log/voice-mvp
sudo useradd -r -s /sbin/nologin voice-mvp

# 复制 API
sudo cp api-server/voice-mvp-api /opt/voice-mvp/
sudo cp api-server/config.yaml /opt/voice-mvp/

# 复制前端静态文件
sudo cp -r out/* /var/www/voice-mvp/

# 安装 systemd 服务
sudo cp api-server/voice-mvp-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable voice-mvp-api
sudo systemctl start voice-mvp-api

# 安装 Nginx 配置
sudo cp api-server/nginx.conf /etc/nginx/conf.d/voice-mvp.conf
sudo nginx -t && sudo systemctl reload nginx
```

### 7.3 部署后验证

```bash
# 检查 API 健康
curl http://127.0.0.1:3001/api/health

# 预期返回
# {"ok":true,"services":{"database":{"ok":true},"minio":{"ok":true},"qwen":{"ok":true}}}

# 检查 Nginx 联通
curl http://服务器IP/api/health

# 检查前端页面
curl http://服务器IP/
```

---

## 8. Nginx 反向代理配置

`api-server/nginx.conf`：

```nginx
server {
    listen 80;
    server_name _;

    # 前端静态文件
    root /var/www/voice-mvp;
    index index.html;

    # API 反向代理
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        client_max_body_size 50m;
    }

    # SPA 路由 fallback
    location / {
        try_files $uri $uri.html $uri/ /index.html;
    }
}
```

生产环境建议补充 HTTPS（certbot / 自签证书）。
