# Video Analysis Worker

这是阶段 2 的独立 Python worker，负责从 `VideoAnalysisJob` 表领取任务、补齐 `VideoSource` 文本来源，并把结构化分析结果回写数据库。

## 目录说明

```text
video-analysis-worker/
  config.py
  db.py
  logging_utils.py
  worker.py
  services/
  prompts/
```

## 本地启动

1. 创建虚拟环境并安装依赖

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r video-analysis-worker/requirements.txt
patchright install chromium
```

2. 准备配置

- 默认会读取仓库根目录 `.env`
- 可选覆盖 `video-analysis-worker/.env`
- 也支持 `CONFIG_PATH`、根目录 `config.yaml`、`api-server/config.yaml`

3. 启动 worker

```bash
python3 video-analysis-worker/worker.py
```

## 配置约定

基础配置沿用 API 侧命名，并兼容根目录已有的 `DATABASE_URL`：

- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `DB_SCHEMA`
- `LOG_LEVEL`
- `LOG_DIR`
- `QWEN_MOCK_MODE`
- `QWEN_API_KEY`

Worker 新增配置：

- `VIDEO_ANALYSIS_WORKER_ID`
- `VIDEO_ANALYSIS_POLL_INTERVAL_SECONDS`
- `VIDEO_ANALYSIS_HTTP_TIMEOUT_SECONDS`
- `VIDEO_ANALYSIS_ASR_URL`
- `VIDEO_ANALYSIS_ASR_MODEL`
- `VIDEO_ANALYSIS_LLM_URL`
- `VIDEO_ANALYSIS_LLM_MODEL`
- `BILIBILI_COOKIE`
- `BILIBILI_USER_AGENT`

## Bilibili 抓取实现

Worker 内置 `lib/biliapi`，基于 Patchright 启动 Chromium 持久化上下文访问 B 站接口，不再直接使用普通 `requests` 抓取视频元信息与 DASH 音频地址。

- 视频信息：调用 `https://api.bilibili.com/x/web-interface/view` 获取标题、UP 主、封面、时长与分 P `cid`
- 字幕列表：调用 `https://api.bilibili.com/x/player/v2` 读取 `subtitle.subtitles`，字幕正文仍由 `SubtitleService` 下载 `subtitle_url` JSON 后解析 `body[].content`
- 音频地址：调用 `https://api.bilibili.com/x/player/playurl`，使用 `fnval=4048` 获取 DASH 结构，并选择 `dash.audio` 中带宽最高的音频流
- 登录：保留 `QrCodeLogin`，二维码登录成功后 Cookie 写入 Patchright 持久化 profile，后续请求自动携带；也兼容 `BILIBILI_COOKIE` 作为部署兜底
- 不包含弹幕与 WebSocket 功能

Patchright profile 默认存放在 `video-analysis-worker/.biliapi-profile`，可通过 `BILIAPI_PROFILE_DIR` 覆盖。

## 有头登录字幕下载测试

可用以下脚本先打开有头 Chromium，扫码或网页登录 B 站后下载指定视频字幕：

```bash
python3 video-analysis-worker/scripts/test_biliapi_subtitle_download.py \
  --bvid BVxxxxxxxxxx \
  --output-dir video-analysis-worker/tmp
```

脚本会：

1. 打开 `https://passport.bilibili.com/login`
2. 等待检测到 `SESSDATA` Cookie
3. 调用 `x/web-interface/view` 获取 `cid`
4. 调用 `x/player/v2` 获取字幕轨道
5. 下载第一条匹配语言的字幕 JSON，并额外导出纯文本

登录态会保存在 Patchright profile 中，后续重复测试通常无需再次扫码。

## 处理顺序

1. 事务领取最早的 `PENDING` 任务并更新为 `PROCESSING`
2. 根据 `normalizedBvid` 拉取 B 站视频基础信息
3. 优先抓字幕
4. 无字幕时走 ASR
5. 将 `transcriptText` 送入结构化分析器
6. 成功回写 `READY`，失败回写 `FAILED`

## Mock 说明

- `QWEN_MOCK_MODE=true` 时：
  - 无字幕视频会走模拟 ASR 文本
  - 结构化分析会返回稳定的本地 mock JSON
- 该模式主要用于本地联调数据库状态流转与接口回写，不依赖外部模型服务
- 该模式仍需要访问 B 站公开接口获取视频元信息、字幕列表和音频地址
