# Voice MVP 新服务器部署手册

> 最后更新：2026-05-09
>
> 当前部署策略：新服务器使用 PostgreSQL 18 空库初始化；老服务器数据不迁移；部署更新通过上传服务文件、SQL、API 二进制和前端静态文件完成，不再依赖服务器执行 `git pull`。

## 1. 部署原则

- 老服务器数据不保留，禁止在新服务器执行旧库补列、回填或历史迁移 SQL。
- 数据库默认 PostgreSQL 18，`api-server/init-db.sql` 只保证 PostgreSQL 18 空库初始化。
- 数据库账号和数据库由 `scripts/init-postgres.sh` 创建，业务表结构由 `api-server/init-db.sql` 创建。
- 服务更新以文件覆盖为主：`systemd/voice-mvp-api.service`、`api-server/init-db.sql`、`api-server/voice-mvp-api`、`out/`。

## 2. 准备产物

在构建机器执行：

```bash
bun install
(cd api-server && bun install)
bunx prisma generate
(cd api-server && bunx prisma generate)
bun run build
(cd api-server && bun run build)
```

需要上传到新服务器的文件：

- `api-server/voice-mvp-api`
- `api-server/config.example.yaml`
- `api-server/init-db.sql`
- `api-server/prisma/schema.prisma`
- `api-server/prisma.config.ts`
- `api-server/update.sh`
- `scripts/init-postgres.sh`
- `scripts/init-minio.sh`
- `systemd/voice-mvp-api.service`
- `api-server/nginx.conf`
- `out/`

## 3. 初始化 PostgreSQL 18

先创建数据库和业务账号：

```bash
sudo -u postgres env DB_PASS='<强密码>' bash scripts/init-postgres.sh
```

再用业务账号执行空库建表 SQL：

```bash
PGPASSWORD='<强密码>' psql \
  -h 127.0.0.1 \
  -U voice_mvp \
  -d voice_mvp \
  -v ON_ERROR_STOP=1 \
  -f api-server/init-db.sql
```

`api-server/init-db.sql` 是从当前 `api-server/prisma/schema.prisma` 生成的空库结构 SQL，不包含旧数据库结构修改逻辑。

## 4. 初始化 MinIO

```bash
bash scripts/init-minio.sh
```

生产环境需要在执行前把 `scripts/init-minio.sh` 中的 MinIO 账号、密码、Bucket 和 endpoint 改成实际值。

## 5. 首次部署 API 服务

```bash
cd api-server
sudo ./deploy.sh
sudo vi /opt/voice-mvp/config.yaml
sudo systemctl start voice-mvp-api
sudo systemctl status voice-mvp-api --no-pager --lines=20
```

`deploy.sh` 只安装文件、配置目录和 systemd 服务，不再自动修改数据库结构。

## 6. 部署前端和 Nginx

```bash
sudo mkdir -p /var/www/voice-mvp
sudo rm -rf /var/www/voice-mvp/*
sudo cp -a out/. /var/www/voice-mvp/

sudo cp api-server/nginx.conf /etc/nginx/conf.d/voice-mvp.conf
sudo nginx -t
sudo systemctl reload nginx
```

## 7. 后续文件更新

把新的服务文件、SQL、API 二进制和前端文件上传到同一个包目录后执行：

```bash
sudo PACKAGE_DIR=/path/to/uploaded-package bash api-server/update.sh
```

更新脚本会完成：

- 备份 `/opt/voice-mvp` 和 `/var/www/voice-mvp`。
- 覆盖 `voice-mvp-api`、Prisma schema、systemd 服务文件。
- 覆盖前端静态文件 `out/` 到 `/var/www/voice-mvp`。
- 重载 systemd 并重启 `voice-mvp-api`。

如果 `api-server/init-db.sql` 发生变化，只在空库初始化时执行。已有生产库不自动执行该 SQL，避免误删或重建结构。

## 8. 验证

```bash
curl http://127.0.0.1:3001/api/health
curl http://服务器IP/api/health
curl http://服务器IP/
journalctl -u voice-mvp-api -n 100 --no-pager
```

健康检查预期返回：

```json
{"ok":true,"services":{"database":{"ok":true},"minio":{"ok":true},"qwen":{"ok":true}}}
```

## 9. 常用命令

```bash
sudo systemctl start voice-mvp-api
sudo systemctl stop voice-mvp-api
sudo systemctl restart voice-mvp-api
sudo systemctl status voice-mvp-api --no-pager --lines=20
journalctl -u voice-mvp-api -f
```
