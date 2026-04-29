# Voice MVP

## 项目说明

这是一个基于 Next.js 15、React 19、TypeScript、Tailwind CSS、Prisma、PostgreSQL 与 MinIO 的单页语音 MVP。

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
- `POST /api/auth/logout`
- `GET /api/voice/profile`
- `POST /api/voice/enroll`
- `GET /api/voice/enrollments/[enrollmentId]/audio`
- `POST /api/voice/enrollments/[enrollmentId]/invalidate`
- `GET /api/tts`
- `GET /api/tts/usage`
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

### 3.2 TTS 使用码配置

- 文本转语音免费生成单次最多 30 字。
- 匿名用户和登录用户各只有一次免费生成机会；匿名免费机会用完后必须先登录。
- 同一匿名 Cookie 会话登录后，已使用的匿名免费机会会迁移到注册账号，避免重复领取免费机会。
- 注册用户免费机会用完后，后续生成必须输入 6 位使用码。
- 默认通用使用码为 `123456`，可通过 `USAGE_CODE_GENERAL_CODE` 或 `config.yaml` 的 `usageCode.generalCode` 修改；注册用户可输入该码继续生成。
- 使用码按模块管理。当前只有 `VOICE_TO_TEXT` 模块，后续新增模块时继续复用 `UsageCode.module` 区分。
- 匿名用户不能使用使用码；前台只展示必要输入框，不展示使用码库存、消费记录或后台查询结果。
- 使用码以明文存储在数据库中，便于后台查询和多次分发。

生成一批使用码：

```bash
cd api-server
bun run usage-codes:generate -- --module VOICE_TO_TEXT --count 100 > usage-codes.txt
```

`usage-codes.txt` 只用于运营发放，不要提交到 Git。一次性使用码库存表只保存使用码哈希、模块与消费状态。
每条 TTS 任务会通过 `TtsJob.accessKind` 标记免费生成、通用使用码生成或非通用一次性使用码生成，并在 `TtsJob.usageCodeValue` 保存本次输入的使用码快照；免费生成时该字段为空。

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
prisma/
  schema.prisma
```

## 验证命令

建议依次执行：

```bash
bun install
bunx prisma generate
bun run lint
bun run typecheck
bun run build
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
- `UsageCode`：模块化一次性使用码库存，保存哈希、预览与消费归属，不保存明文码
- `TtsJob`：文本转语音任务、权益来源、使用码关联、`voiceIdSnapshot`、声纹类型/场景信息与输出音频 MinIO 元数据

## 已知边界

- 真实 Qwen 接口字段若与假设不一致，需要在 `api-server/src/lib/qwen.ts` 微调。
- 浏览器录音依赖 `MediaRecorder` 与麦克风权限。
- 首次运行前必须先让 PostgreSQL 与 MinIO 可用，否则 API 会返回依赖不可达错误。
