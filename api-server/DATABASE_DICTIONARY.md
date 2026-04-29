# 数据库数据字典

本文档基于当前 `api-server/prisma/schema.prisma` 生成，用于说明数据库中的枚举、表结构与字段含义。

## 基本说明

- 数据库类型：PostgreSQL
- ORM：Prisma
- `relationMode = "prisma"`，表示当前库不依赖数据库层外键约束，表之间关系主要由应用层保证
- 时间字段默认使用 `DateTime`，对应数据库中的时间戳类型

## 枚举说明

### `EnrollmentStatus`

| 枚举值 | 中文说明 |
| --- | --- |
| `PENDING` | 建声任务已创建，尚未完成 |
| `READY` | 建声成功，已生成可用 `voiceId` |
| `FAILED` | 建声失败 |

### `RecordingStatus`

| 枚举值 | 中文说明 |
| --- | --- |
| `UPLOADED` | 录音文件已上传并入库 |

### `VoiceProfileKind`

| 枚举值 | 中文说明 |
| --- | --- |
| `PURE` | 纯粹版声纹 |
| `SCENE` | 场景版声纹 |

### `TtsJobStatus`

| 枚举值 | 中文说明 |
| --- | --- |
| `PENDING` | 文本转语音任务已创建，等待完成 |
| `READY` | 文本转语音成功，输出音频已生成 |
| `FAILED` | 文本转语音失败 |

### `TtsAccessKind`

| 枚举值 | 中文说明 |
| --- | --- |
| `FREE_TRIAL` | 免费生成机会 |
| `GENERAL_USAGE_CODE` | 通用使用码生成 |
| `USAGE_CODE` | 非通用一次性使用码生成 |

### `UsageCodeModule`

| 枚举值 | 中文说明 |
| --- | --- |
| `VOICE_TO_TEXT` | 文本转语音模块 |

### `SmsScene`

| 枚举值 | 中文说明 |
| --- | --- |
| `REGISTER` | 注册场景 |
| `LOGIN` | 登录场景 |
| `PASSWORD_CHANGE` | 修改密码场景 |

### `SmsVerificationStatus`

| 枚举值 | 中文说明 |
| --- | --- |
| `SENT` | 短信已发送，待验证 |
| `VERIFIED` | 短信验证码已验证通过 |
| `FAILED` | 短信发送或验证失败 |

## 表结构说明

### `User`

用于保存正式注册用户账号信息。

| 字段名 | 类型 | 约束/默认值 | 中文说明 |
| --- | --- | --- | --- |
| `id` | `String` | 主键，默认 `cuid()` | 用户主键 ID |
| `phoneNumber` | `String` | 唯一 | 用户手机号 |
| `passwordHash` | `String?` | 可空 | 用户密码哈希，未设置密码时为空 |
| `phoneVerifiedAt` | `DateTime?` | 可空 | 手机号完成验证的时间 |
| `freeTtsUsedAt` | `DateTime?` | 可空 | 注册用户免费 TTS 机会使用时间 |
| `createdAt` | `DateTime` | 默认 `now()` | 记录创建时间 |
| `updatedAt` | `DateTime` | `@updatedAt` | 记录最后更新时间 |
| `activePureVoiceEnrollmentId` | `String?` | 唯一，可空 | 当前生效的纯粹版声纹记录 ID |
| `activeSceneVoiceEnrollmentId` | `String?` | 唯一，可空 | 当前生效的场景版声纹记录 ID |

### `AnonymousUser`

用于保存匿名用户会话身份，支持未登录用户先录音、建声、试听。

| 字段名 | 类型 | 约束/默认值 | 中文说明 |
| --- | --- | --- | --- |
| `id` | `String` | 主键，默认 `cuid()` | 匿名用户主键 ID |
| `tokenHash` | `String` | 唯一 | 匿名身份 Cookie 的哈希值 |
| `expiresAt` | `DateTime` | 必填 | 匿名身份过期时间 |
| `lastSeenAt` | `DateTime` | 默认 `now()` | 匿名用户最近活跃时间 |
| `freeTtsUsedAt` | `DateTime?` | 可空 | 匿名用户免费 TTS 机会使用时间 |
| `createdAt` | `DateTime` | 默认 `now()` | 记录创建时间 |
| `updatedAt` | `DateTime` | `@updatedAt` | 记录最后更新时间 |
| `activePureVoiceEnrollmentId` | `String?` | 唯一，可空 | 当前生效的纯粹版声纹记录 ID |
| `activeSceneVoiceEnrollmentId` | `String?` | 唯一，可空 | 当前生效的场景版声纹记录 ID |

索引：`expiresAt`

### `Session`

用于保存登录用户会话。

| 字段名 | 类型 | 约束/默认值 | 中文说明 |
| --- | --- | --- | --- |
| `id` | `String` | 主键，默认 `cuid()` | 会话主键 ID |
| `userId` | `String` | 必填 | 会话所属用户 ID |
| `tokenHash` | `String` | 唯一 | 登录 Cookie 对应的令牌哈希 |
| `expiresAt` | `DateTime` | 必填 | 会话过期时间 |
| `lastSeenAt` | `DateTime` | 默认 `now()` | 最近一次活跃时间 |
| `createdAt` | `DateTime` | 默认 `now()` | 会话创建时间 |
| `updatedAt` | `DateTime` | `@updatedAt` | 会话最后更新时间 |

索引：`userId + expiresAt`

### `SmsVerification`

用于记录短信验证码发送与校验过程。

| 字段名 | 类型 | 约束/默认值 | 中文说明 |
| --- | --- | --- | --- |
| `id` | `String` | 主键，默认 `cuid()` | 短信验证记录主键 ID |
| `phoneNumber` | `String` | 必填 | 接收验证码的手机号 |
| `scene` | `SmsScene` | 必填 | 验证码使用场景 |
| `provider` | `String` | 必填 | 短信服务提供商标识 |
| `providerBizId` | `String?` | 可空 | 运营商或服务商返回的业务 ID |
| `providerRequestId` | `String?` | 可空 | 服务商请求流水号 |
| `providerOutId` | `String` | 必填 | 业务侧生成并传给服务商的外部请求标识 |
| `codeHash` | `String?` | 可空 | 验证码哈希值，避免明文入库 |
| `status` | `SmsVerificationStatus` | 默认 `SENT` | 当前短信验证状态 |
| `verifyAttempts` | `Int` | 默认 `0` | 已尝试验证次数 |
| `expiresAt` | `DateTime` | 必填 | 验证码过期时间 |
| `verifiedAt` | `DateTime?` | 可空 | 验证成功时间 |
| `createdAt` | `DateTime` | 默认 `now()` | 记录创建时间 |
| `updatedAt` | `DateTime` | `@updatedAt` | 记录最后更新时间 |

索引：`phoneNumber + scene + createdAt`、`status + expiresAt`

### `VoiceRecording`

用于保存用户上传的原始录音素材。该表只保存对象定位信息，不保存 MinIO 外网访问域名。

| 字段名 | 类型 | 约束/默认值 | 中文说明 |
| --- | --- | --- | --- |
| `id` | `String` | 主键，默认 `cuid()` | 录音记录主键 ID |
| `userId` | `String?` | 可空 | 录音所属正式用户 ID，匿名录音时为空 |
| `anonymousUserId` | `String?` | 可空 | 录音所属匿名用户 ID，登录用户录音时为空 |
| `status` | `RecordingStatus` | 默认 `UPLOADED` | 录音当前状态 |
| `durationSeconds` | `Float` | 必填 | 录音时长，单位为秒 |
| `originalFilename` | `String?` | 可空 | 原始上传文件名 |
| `inputContentType` | `String` | 必填 | 录音 MIME 类型，例如 `audio/wav` |
| `bucket` | `String` | 必填 | 录音所在 MinIO Bucket 名称 |
| `objectKey` | `String` | 必填 | 录音在 MinIO 中的对象路径 |
| `minioUri` | `String` | 必填 | 录音的内部对象定位地址，格式通常为 `minio://bucket/objectKey` |
| `createdAt` | `DateTime` | 默认 `now()` | 记录创建时间 |
| `updatedAt` | `DateTime` | `@updatedAt` | 记录最后更新时间 |

索引：`userId + createdAt`、`anonymousUserId + createdAt`

### `VoiceEnrollment`

用于保存基于录音素材建立出的声纹记录。

| 字段名 | 类型 | 约束/默认值 | 中文说明 |
| --- | --- | --- | --- |
| `id` | `String` | 主键，默认 `cuid()` | 声纹记录主键 ID |
| `recordingId` | `String` | 必填 | 声纹所基于的录音记录 ID |
| `userId` | `String?` | 可空 | 声纹所属正式用户 ID |
| `anonymousUserId` | `String?` | 可空 | 声纹所属匿名用户 ID |
| `profileKind` | `VoiceProfileKind` | 必填 | 声纹类型，区分纯粹版和场景版 |
| `status` | `EnrollmentStatus` | 默认 `PENDING` | 建声任务状态 |
| `durationSeconds` | `Float` | 必填 | 建声所使用录音的时长，单位为秒 |
| `originalFilename` | `String?` | 可空 | 建声所使用原始录音文件名 |
| `inputContentType` | `String` | 必填 | 建声所使用录音的 MIME 类型 |
| `voiceId` | `String?` | 唯一，可空 | 第三方语音服务返回的声纹 ID，成功建声后产生 |
| `errorMessage` | `String?` | 可空 | 建声失败时记录的错误信息 |
| `isInvalidated` | `Boolean` | 默认 `false` | 当前声纹是否已作废 |
| `bucket` | `String` | 必填 | 建声输入录音所在 MinIO Bucket |
| `objectKey` | `String` | 必填 | 建声输入录音在 MinIO 中的对象路径 |
| `minioUri` | `String` | 必填 | 建声输入录音的内部对象定位地址 |
| `createdAt` | `DateTime` | 默认 `now()` | 记录创建时间 |
| `updatedAt` | `DateTime` | `@updatedAt` | 记录最后更新时间 |

索引：`recordingId`、`profileKind + createdAt`、`userId + createdAt`、`anonymousUserId + createdAt`

### `UsageCode`

用于保存一次性使用码库存与消费状态。使用码以明文存储，便于后台查询和多次分发。

| 字段名 | 类型 | 约束/默认值 | 中文说明 |
| --- | --- | --- | --- |
| `id` | `String` | 主键，默认 `cuid()` | 使用码记录主键 ID |
| `module` | `UsageCodeModule` | 默认 `VOICE_TO_TEXT` | 使用码所属模块 |
| `code` | `String` | 唯一 | 6 位明文使用码，可直接查询和分发 |
| `consumedAt` | `DateTime?` | 可空 | 使用码消费时间，空表示未消费 |
| `consumedByUserId` | `String?` | 可空 | 消费使用码的注册用户 ID |
| `consumedTtsJobId` | `String?` | 唯一，可空 | 使用码对应的 TTS 任务 ID |
| `createdAt` | `DateTime` | 默认 `now()` | 记录创建时间 |
| `updatedAt` | `DateTime` | `@updatedAt` | 记录最后更新时间 |

索引：`module + consumedAt`、`consumedAt`、`consumedByUserId + consumedAt`

### `TtsJob`

用于保存文本转语音任务及输出结果。

| 字段名 | 类型 | 约束/默认值 | 中文说明 |
| --- | --- | --- | --- |
| `id` | `String` | 主键，默认 `cuid()` | TTS 任务主键 ID |
| `userId` | `String?` | 可空 | 任务所属正式用户 ID |
| `anonymousUserId` | `String?` | 可空 | 任务所属匿名用户 ID |
| `voiceEnrollmentId` | `String?` | 可空 | 本次合成使用的声纹记录 ID |
| `profileKind` | `VoiceProfileKind` | 必填 | 本次合成所使用的声纹类型 |
| `accessKind` | `TtsAccessKind` | 默认 `FREE_TRIAL` | 本次 TTS 任务的权益来源 |
| `usageCodeId` | `String?` | 唯一，可空 | 使用码生成时关联的使用码 ID |
| `usageCodeModule` | `UsageCodeModule?` | 可空 | 使用码生成时的模块标识 |
| `usageCodeValue` | `String?` | 可空 | 本次生成输入的使用码快照；免费生成时为空 |
| `voiceIdSnapshot` | `String` | 必填 | 提交任务时使用的 `voiceId` 快照，避免后续 active voice 变化影响历史追溯 |
| `text` | `String` | 必填 | 待合成文本 |
| `sceneKey` | `String?` | 可空 | 场景版 TTS 所选场景标识，纯粹版通常为空 |
| `instruction` | `String?` | 可空 | 场景版 TTS 使用的场景提示词 |
| `status` | `TtsJobStatus` | 默认 `PENDING` | TTS 任务状态 |
| `outputContentType` | `String?` | 可空 | 输出音频 MIME 类型，例如 `audio/wav` |
| `errorMessage` | `String?` | 可空 | TTS 失败时记录的错误信息 |
| `bucket` | `String?` | 可空 | 输出音频所在 MinIO Bucket，任务成功后产生 |
| `objectKey` | `String?` | 可空 | 输出音频在 MinIO 中的对象路径 |
| `minioUri` | `String?` | 可空 | 输出音频的内部对象定位地址 |
| `createdAt` | `DateTime` | 默认 `now()` | 记录创建时间 |
| `updatedAt` | `DateTime` | `@updatedAt` | 记录最后更新时间 |

索引：`userId + createdAt`、`anonymousUserId + createdAt`、`voiceEnrollmentId`、`accessKind + createdAt`、`usageCodeModule + createdAt`

## 关系说明

- `User.activePureVoiceEnrollmentId` 指向当前用户正在使用的纯粹版声纹记录 ID
- `User.activeSceneVoiceEnrollmentId` 指向当前用户正在使用的场景版声纹记录 ID
- `AnonymousUser.activePureVoiceEnrollmentId` / `activeSceneVoiceEnrollmentId` 含义与正式用户一致，只是所属主体变为匿名用户
- `VoiceEnrollment.recordingId` 表示某条声纹记录来源于哪条录音素材
- `TtsJob.voiceEnrollmentId` 表示某次语音合成使用了哪条声纹记录
- `TtsJob.accessKind` 标识本次生成是免费生成、通用使用码生成还是非通用一次性使用码生成
- `TtsJob.usageCodeId` 表示某次非通用一次性使用码生成消耗了哪条使用码记录
- `TtsJob.usageCodeValue` 保存本次生成输入的使用码快照，免费生成时为空
- `UsageCode.consumedByUserId` / `consumedTtsJobId` 用于后续后台查询消费归属
- 当前项目未使用数据库层外键，所以以上“指向”关系由应用逻辑保证，不由数据库强约束保证

## 当前已废弃字段说明

- 旧字段 `activeVoiceEnrollmentId` 已被拆分为：
  - `activePureVoiceEnrollmentId`
  - `activeSceneVoiceEnrollmentId`
- 旧结构升级时，需要先完成数据回填，再删除旧字段
