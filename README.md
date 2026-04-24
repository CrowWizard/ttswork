# Voice MVP

## 项目说明

这是一个基于 Next.js 15、React 19、TypeScript、Tailwind CSS、Prisma、PostgreSQL 与 MinIO 的单页语音 MVP。

- 匿名用户通过 `httpOnly` Cookie 识别，无需登录。
- 录音建声要求不少于 5 秒，前端会基于最终 Blob 读取真实时长，服务端再以 0.2 秒容差兜底校验。
- 原始录音与 TTS 结果统一保存到 MinIO。
- 数据库只保存稳定的 MinIO 元数据：`bucket`、`objectKey`、`minioUri`。
- 每个匿名用户只保留一个当前 `active voice`，并支持回放与作废。
- `QWEN_MOCK_MODE=true` 时，无需外网即可本地完成建声与 TTS 演示。

## 技术栈

- Next.js 15
- React 19
- TypeScript
- Tailwind CSS
- Prisma
- PostgreSQL
- minio-js
- music-metadata

## 接口清单

- `GET /api/health`
- `GET /api/voice/profile`
- `POST /api/voice/enroll`
- `GET /api/voice/enrollments/[enrollmentId]/audio`
- `POST /api/voice/enrollments/[enrollmentId]/invalidate`
- `POST /api/tts`
- `GET /api/tts/[jobId]/download`

## 本地启动

### 1. 安装依赖

```bash
npm install
```

### 2. 准备环境变量

```bash
cp .env.example .env
```

### 3. 准备本机 PostgreSQL 与 MinIO

默认按以下地址读取本机服务：

- PostgreSQL: `127.0.0.1:5432`
- MinIO API: `127.0.0.1:9000`
- MinIO Console: `http://127.0.0.1:9001`

请先确保：

- PostgreSQL 中存在 `voice_mvp` 数据库
- 应用连接用户对 `voice_mvp` 具有建表权限
- MinIO 可通过 `.env` 中的 AK/SK 访问

如果你本机尚未准备这些服务，也可以使用仓库里的 `docker-compose.yml` 作为备用方案。

### 4. 生成 Prisma Client 并同步数据库

```bash
npx prisma generate
npx prisma db push
```

### 5. 启动开发环境

```bash
npm run dev
```

打开 `http://127.0.0.1:3000` 即可。

## Qwen 集成说明

项目中所有第三方建声与 TTS 请求都统一封装在 `lib/qwen.ts`。

### 默认 Mock 模式

当 `QWEN_MOCK_MODE=true` 时：

- 建声会基于录音内容生成稳定的 `mock voiceId`
- TTS 会返回一段本地合成的 WAV 音频
- 适合离线开发与 CI 之外的本地自测

### 接入真实服务

将以下环境变量配置为真实值，并把 `QWEN_MOCK_MODE` 设为 `false`：

- `QWEN_API_KEY`
- `QWEN_ENROLL_URL`
- `QWEN_TTS_URL`

> 当前实现采用通用 JSON / 二进制请求方式，若正式接口字段与返回结构不同，只需调整 `lib/qwen.ts`，无需改动 route handler。

## 关键目录

```text
app/
  api/
  page.tsx
components/
  voice-studio.tsx
lib/
  audio.ts
  minio.ts
  prisma.ts
  qwen.ts
  session.ts
prisma/
  schema.prisma
```

## 验证命令

建议依次执行：

```bash
npm install
npx prisma generate
npm run lint
npm run typecheck
npm run build
```

如需使用容器方式快速补齐本地依赖，再补充：

```bash
docker compose up -d
npx prisma db push
npm run dev
```

## 数据模型摘要

- `AnonymousUser`：匿名用户与当前 `activeVoiceEnrollmentId`
- `VoiceEnrollment`：录音建声记录、原始音频 MinIO 元数据、生成的 `voiceId`、`isInvalidated`
- `TtsJob`：文本转语音任务、`voiceIdSnapshot`、输出音频 MinIO 元数据

## 已知边界

- 真实 Qwen 接口字段若与假设不一致，需要在 `lib/qwen.ts` 微调。
- 浏览器录音依赖 `MediaRecorder` 与麦克风权限。
- 首次运行前必须先让 PostgreSQL 与 MinIO 可用，否则 API 会返回依赖不可达错误。
