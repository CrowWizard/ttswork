SHELL := /bin/bash
.PHONY: all dev dev-api dev-frontend build build-frontend build-api clean install install-frontend install-api prisma-generate prisma-migrate help

all: build

help:
	@echo ""
	@echo "Voice MVP - 前后端分离构建"
	@echo ""
	@echo "  make dev              启动前端 (Next.js :3000) + API (Bun :3001)"
	@echo "  make dev-frontend     仅启动前端开发服务器"
	@echo "  make dev-api          仅启动 API 开发服务器"
	@echo "  make build            构建前端静态文件 + API 单可执行文件"
	@echo "  make build-frontend   仅构建前端静态文件到 out/"
	@echo "  make build-api        仅编译 API 到 api-server/voice-mvp-api"
	@echo "  make install          安装全部依赖"
	@echo "  make install-frontend 安装前端依赖"
	@echo "  make install-api      安装 API 依赖"
	@echo "  make prisma-generate  生成 Prisma Client（前端 + API）"
	@echo "  make prisma-migrate   执行数据库迁移（前端项目）"
	@echo "  make clean            清理构建产物"
	@echo ""

install: install-frontend install-api prisma-generate

install-frontend:
	bun install

install-api:
	cd api-server && bun install && bunx prisma generate

prisma-generate:
	bunx prisma generate
	cd api-server && bunx prisma generate

prisma-migrate:
	bunx prisma migrate dev

build: build-frontend build-api

build-frontend: install-frontend
	bun run build
	@echo ""
	@echo "前端静态文件已输出到 out/ ($$(du -sh out/ | cut -f1))"

build-api: install-api
	cd api-server && bun run build
	@echo ""
	@echo "API 单可执行文件已输出到 api-server/voice-mvp-api ($$(ls -lh api-server/voice-mvp-api | awk '{print $$5}'))"

dev-frontend:
	bun run dev

dev-api:
	cd api-server && bun run --hot src/index.ts

dev:
	@echo "启动前端 :3000 + API :3001 ..."
	@make -j2 dev-frontend dev-api

clean:
	rm -rf out/ .next/
	rm -f api-server/voice-mvp-api
	rm -rf api-server/dist/
	@echo "已清理构建产物"
