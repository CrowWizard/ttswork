# Voice MVP

## 项目说明

这是一个基于 Next.js 15、React 19、TypeScript、Tailwind CSS、Prisma、PostgreSQL 与 MinIO 的语音 MVP。

- 用户通过手机号注册登录，支持短信验证码与手机号密码两种登录方式。
- 录音建声要求不少于 5 秒，前端会基于最终 Blob 读取真实时长，服务端再以 0.2 秒容差兜底校验。
- 原始录音与 TTS 结果统一保存到 MinIO。
- 数据库只保存稳定的 MinIO 元数据：`bucket`、`objectKey`、`minioUri`。
- 每个登录用户只保留一个当前 `active voice`，并支持回放与作废。
- `QWEN_MOCK_MODE=true` 时，无需外网即可本地完成建声与 TTS 演示。
- `SMS_MOCK_MODE=true` 时，验证码由服务端本地模拟生成，便于本机联调。

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
- `POST /api/auth/sms/send`
- `POST /api/auth/register`
- `POST /api/auth/login/password`
- `POST /api/auth/login/sms`
- `GET /api/auth/me`
- `POST /api/auth/password/set`
- `POST /api/auth/password/change`
- `POST /api/auth/logout`
- `POST /api/analytics/collect`
- `GET /api/voice/profile`
- `GET /api/voice/recordings`
- `POST /api/voice/recordings`
- `DELETE /api/voice/recordings/[recordingId]`
- `POST /api/voice/enrollments`
- `GET /api/voice/enrollments/recordings/[recordingId]/audio`
- `GET /api/voice/enrollments/[enrollmentId]/audio`
- `POST /api/voice/enrollments/[enrollmentId]/invalidate`
- `GET /api/tts`
- `GET /api/tts/scenes`
- `GET /api/tts/usage`
- `POST /api/tts`
- `GET /api/tts/[jobId]/download`
- `POST /api/video-analysis/jobs`
- `GET /api/video-analysis/jobs/[jobId]`
- `GET /api/video-analysis/jobs`
- `GET /api/video-analysis/workspace`
- `GET /api/admin/analytics/overview`
- `GET /api/admin/analytics/trend`
- `GET /api/admin/analytics/channels`
- `GET /api/admin/users`
- `GET /api/admin/users/[id]`
- `GET /api/admin/invite-codes`
- `POST /api/admin/invite-codes/generate`
- `GET /api/admin/voice-generations`
- `GET /api/admin/voice-generations/[id]`

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

### 3.1 认证与短信配置

- 默认 `SMS_MOCK_MODE=true`，发送验证码接口会返回 `debugCode`，方便本地直接验证注册/登录链路。
- 需要接入真实阿里云短信时，至少补齐以下配置：
  - `SMS_ACCESS_KEY_ID`
  - `SMS_ACCESS_KEY_SECRET`
  - `SMS_SIGN_NAME`
  - `SMS_TEMPLATE_CODE`
  - `SMS_REGISTER_SCHEME_NAME`
  - `SMS_LOGIN_SCHEME_NAME`
- `SMS_TEMPLATE_PARAM` 默认按 `{"code":"##code##","min":"5"}` 组织，若你的模板变量名不同，需要同步调整该配置。

### 3.2 TTS 积分与使用码配置

- 文本转语音要求登录后使用积分生成，新注册或短信登录自动创建用户赠送 100 积分。
- 每次文本转语音消耗 20 积分；外部 TTS 合成失败时会返还本次扣减积分并记录流水。
- 一次性使用码通过顶部 header 兑换积分，每个使用码兑换 200 积分。
- 使用码按模块管理。当前只有 `VOICE_TO_TEXT` 模块，后续新增模块时继续复用 `UsageCode.module` 区分。
- 匿名用户不能生成 TTS，也不能兑换使用码；前台只展示积分余额与兑换入口，不展示使用码库存或后台查询结果。
- 使用码以明文存储在数据库中，便于后台查询和运营分发；`PointTransaction` 记录注册送分、兑换和 TTS 消费流水。
- `/api/admin/*` 通过 Basic Auth 保护，需配置 `ADMIN_USERNAME`、`ADMIN_PASSWORD`；未配置时后台接口会返回明确错误，避免误暴露。

生成一批使用码：

```bash
cd api-server
bun run usage-codes:generate -- --module VOICE_TO_TEXT --count 100 > usage-codes.txt
```

`usage-codes.txt` 只用于运营发放，不要提交到 Git。一次性使用码库存表保存明文使用码、模块与消费状态，便于后台查询与再次分发。
每条新 TTS 任务会通过 `TtsJob.accessKind = POINTS` 标记积分生成，并通过 `PointTransaction.ttsJobId` 追踪扣减或失败返还流水。

### 3.3 analytics 与后台接口说明

- `POST /api/analytics/collect` 用于采集 `anonymous_id`、`session_id`、`event_name`、`url`、`referrer` 与 UTM 信息，并写入 `AnalyticsVisitor`、`AnalyticsSession`、`AnalyticsEvent` 三张轻量表。
- 若请求同时带有登录 Cookie，服务端会以当前登录用户 ID 回填 analytics 记录；不会信任客户端自行上报的 `user_id`。
- 服务端会基于 `utm_medium`、`utm_source`、`referrer` 自动判定 `DIRECT`、`REFERRAL`、`ORGANIC`、`SOCIAL`、`PAID`、`EMAIL`、`UNKNOWN` 渠道，并按“30 分钟无活动或归因变化”切分 analytics session。
- `/api/admin/analytics/*` 提供概览、按天趋势与按渠道统计。
- `/api/admin/users/*` 提供注册用户分页查询、按 `anonymousId` 反查用户，以及建声 / 使用码 / 语音生成聚合详情。
- `/api/admin/invite-codes/*` 直接复用 `UsageCode`，支持分页查询与单次/批量生成，返回明文 code 便于运营分发。
- `/api/admin/voice-generations/*` 直接复用 `TtsJob`，支持时间范围、用户 ID、是否使用使用码筛选，以及单条记录详情。

后台接口请求头示例：

```http
Authorization: Basic base64(ADMIN_USERNAME:ADMIN_PASSWORD)
```

`POST /api/analytics/collect` 响应示例：

```json
{
  "success": true,
  "visitorId": "cm9analyticsvisitor",
  "sessionId": "cm9analyticssession",
  "eventId": "cm9analyticsevent",
  "channel": "DIRECT"
}
```

`GET /api/admin/analytics/overview` 响应示例：

```json
{
  "range": {
    "startAt": "2026-04-01T00:00:00.000Z",
    "endAt": "2026-04-30T23:59:59.999Z"
  },
  "metrics": {
    "pv": 1280,
    "uv": 315,
    "sessions": 402,
    "newUsers": 58,
    "voiceprintUsers": 41,
    "voiceGenerations": 226,
    "voiceGenerationUsers": 73,
    "inviteCodeUsers": 17
  }
}
```

`POST /api/admin/invite-codes/generate` 响应示例：

```json
{
  "count": 2,
  "items": [
    {
      "id": "cm9usagecode1",
      "code": "A1b2C3",
      "createdAt": "2026-04-29T12:00:00.000Z"
    },
    {
      "id": "cm9usagecode2",
      "code": "D4e5F6",
      "createdAt": "2026-04-29T12:00:00.000Z"
    }
  ]
}
```

`GET /api/admin/voice-generations/:id` 响应示例：

```json
{
  "id": "cm9ttsjob",
  "status": "READY",
  "profileKind": "SCENE",
  "accessKind": "USAGE_CODE",
  "usageCodeValue": "A1b2C3",
  "sceneKey": "customer_service",
  "instruction": "客服接待"
}
```

### 4. 生成 Prisma Client 并同步数据库

```bash
bunx prisma generate
bunx prisma db push
```

### 5. 启动开发环境

```bash
npm run dev
```

打开 `http://127.0.0.1:3000` 即可。

### 6. 启动视频分析 worker

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r video-analysis-worker/requirements.txt
python3 video-analysis-worker/worker.py
```

视频分析 worker 会：

- 从 `VideoAnalysisJob` 表轮询领取 `PENDING` 任务
- 优先抓取 B 站字幕；无字幕时再走 ASR
- 将结构化分析结果回写到现有 `summary`、`structureSections`、`highlights`、`copySuggestions`

默认可通过 `QWEN_MOCK_MODE=true` 跑通不依赖外部模型服务的本地验证：

- 有字幕视频仍会访问 B 站接口并走真实字幕链路
- 无字幕视频会先访问 B 站接口获取音频地址，再走 mock ASR 文本
- 结构化分析走 mock JSON 输出，不依赖外部 LLM

## Qwen 集成说明

项目中所有第三方建声与 TTS 请求都统一封装在 `api-server/src/lib/qwen.ts`。

### 默认 Mock 模式

当 `QWEN_MOCK_MODE=true` 时：

- 建声会基于录音内容生成稳定的 `mock voiceId`
- TTS 会返回一段本地合成的 WAV 音频
- 适合离线开发与 CI 之外的本地自测

### 接入真实服务

将以下环境变量配置为真实值，并把 `QWEN_MOCK_MODE` 设为 `false`：

- `QWEN_API_KEY`
- `QWEN_PURE_ENROLL_URL`
- `QWEN_SCENE_ENROLL_URL`
- `QWEN_PURE_TTS_URL`
- `QWEN_SCENE_TTS_URL`

> 当前实现采用通用 JSON / 二进制请求方式，若正式接口字段与返回结构不同，只需调整 `api-server/src/lib/qwen.ts`，无需改动 route handler。

## 关键目录

```text
app/
  api/
  page.tsx
components/
  voice-studio.tsx
lib/
  audio.ts
  audio-browser.ts
  audio-format.ts
  constants.ts
api-server/
  src/lib/
    minio.ts
    prisma.ts
    qwen.ts
    validation.ts
  src/routes/
    video-analysis.ts
prisma/
  schema.prisma
video-analysis-worker/
  worker.py
  services/
```

## 验证命令

建议依次执行：

```bash
bun install
bunx prisma generate
bun run lint
bun run typecheck
bun run build
python3 -m compileall video-analysis-worker
```

如需使用容器方式快速补齐本地依赖，再补充：

```bash
docker compose up -d
bunx prisma db push
bun run dev
```

## 数据模型摘要

- `User`：手机号账号、可选密码与当前纯粹版/场景版 `active voice`
- `Session`：数据库会话与 HttpOnly 登录 Cookie
- `SmsVerification`：短信发送与校验状态追踪
- `VoiceRecording`：上传录音记录与 MinIO 元数据（公网地址由运行时配置拼接）
- `VoiceEnrollment`：基于录音建立的纯粹版/场景版声纹、生成的 `voiceId`、`isInvalidated`
- `TtsJob`：文本转语音任务、`voiceIdSnapshot`、声纹类型/场景信息与输出音频 MinIO 元数据
- `VideoSource`：按 `normalizedBvid` 复用的视频基础信息、字幕状态与转写缓存
- `VideoAnalysisJob`：单次视频分析任务状态、结构化结果、worker 锁信息与完成时间
- `UsageCode`：模块化一次性使用码库存，保存明文 code 与消费归属
- `PointTransaction`：用户积分赠送、使用码兑换、TTS 消费与失败返还流水
- `TtsJob`：文本转语音任务、权益来源、`voiceIdSnapshot`、声纹类型/场景信息与输出音频 MinIO 元数据
- `AnalyticsVisitor` / `AnalyticsSession` / `AnalyticsEvent`：运营后台使用的轻量 analytics 访客、会话与事件表

## 已知边界

- 真实 Qwen 接口字段若与假设不一致，需要在 `api-server/src/lib/qwen.ts` 微调。
- 浏览器录音依赖 `MediaRecorder` 与麦克风权限。
- 首次运行前必须先让 PostgreSQL 与 MinIO 可用，否则 API 会返回依赖不可达错误。
