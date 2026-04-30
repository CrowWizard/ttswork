import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { randomUUID } from "node:crypto";
import { loadConfig, buildDatabaseUrl, ensureLogDir } from "./lib/config";
import { errorResponse } from "./lib/http";
import { buildErrorLogContext, initLogger, isDebugEnabled, loggerDebug, loggerError, loggerInfo, loggerWarn } from "./lib/logger";
import { initPrisma } from "./lib/prisma";
import { createAuthRoutes } from "./routes/auth";
import { createHealthRoutes } from "./routes/health";
import { createVoiceProfileRoutes } from "./routes/voice-profile";
import { createVoiceRecordingRoutes } from "./routes/voice-recordings";
import { createVoiceEnrollmentRoutes } from "./routes/voice-enrollments";
import { createEnrollmentAudioRoutes } from "./routes/enrollment-audio";
import { createEnrollmentInvalidateRoutes } from "./routes/enrollment-invalidate";
import { createTtsRoutes } from "./routes/tts";
import { createTtsDownloadRoutes } from "./routes/tts-download";
import { createAnalyticsRoutes } from "./routes/analytics";
import { createAdminAnalyticsRoutes } from "./routes/admin-analytics";
import { createAdminUsersRoutes } from "./routes/admin-users";
import { createAdminInviteCodesRoutes } from "./routes/admin-invite-codes";
import { createAdminVoiceGenerationsRoutes } from "./routes/admin-voice-generations";

function setRequestId(context: Context, requestId: string) {
  (context as Context & { set: (key: string, value: unknown) => void }).set("requestId", requestId);
}

function getRequestId(context: Context) {
  return (context as Context & { get: (key: string) => unknown }).get("requestId") as string | undefined;
}

const cfg = loadConfig();

// 先设置 DATABASE_URL，再初始化 PrismaClient（延迟初始化避免模块加载时序问题）
initPrisma(buildDatabaseUrl(cfg.database));

ensureLogDir(cfg.server.logDir);
initLogger(cfg.server);

loggerInfo("config.loaded", {
  serverPort: cfg.server.port,
  database: `${cfg.database.host}:${cfg.database.port}/${cfg.database.name}`,
  minio: `${cfg.minio.endpoint}:${cfg.minio.port}/${cfg.minio.bucket}`,
  qwenMockMode: cfg.qwen.mockMode,
  smsMockMode: cfg.sms.mockMode,
  logDir: cfg.server.logDir,
});

const app = new Hono();

async function extractErrorBody(response: Response) {
  try {
    const contentType = response.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      return await response.clone().json();
    }

    if (contentType.startsWith("text/")) {
      return (await response.clone().text()).slice(0, 1000);
    }
  } catch {
    return undefined;
  }

  return undefined;
}

app.use("*", cors({
  origin: (origin) => origin || "*",
  credentials: true,
  allowHeaders: ["Content-Type", "Authorization"],
}));

app.use("*", async (c, next) => {
  const startedAt = Date.now();
  const requestId = randomUUID();

  setRequestId(c, requestId);

  try {
    await next();
  } finally {
    c.header("X-Request-Id", requestId);

    const responseStatus = c.res.status;
    const requestUrl = new URL(c.req.url);
    const logContext = {
      requestId,
      method: c.req.method,
      path: requestUrl.pathname,
      query: requestUrl.search || undefined,
      status: responseStatus,
      durationMs: Date.now() - startedAt,
      userAgent: c.req.header("user-agent") ?? undefined,
      remoteAddress: c.req.header("x-forwarded-for") ?? undefined,
    };

    if (responseStatus >= 400) {
      const responseBody = await extractErrorBody(c.res);
      const logFn = responseStatus >= 500 ? loggerError : loggerWarn;
      logFn("http.response.error", {
        ...logContext,
        responseBody,
      });
      return;
    }

    if (isDebugEnabled()) {
      loggerDebug("http.response", logContext);
    }
  }
});

app.onError((error, c) => {
  loggerError("http.unhandled_exception", {
    requestId: getRequestId(c),
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    ...buildErrorLogContext(error),
  });

  const message = error instanceof Error ? error.message : "服务器内部错误";

  return errorResponse(c, message, 500, {
    details: error instanceof Error
      ? {
          name: error.name,
          stack: error.stack,
        }
      : undefined,
  });
});

app.route("/api/health", createHealthRoutes(cfg));
app.route("/api/auth", createAuthRoutes(cfg));
app.route("/api/analytics", createAnalyticsRoutes(cfg));
app.route("/api/voice/profile", createVoiceProfileRoutes(cfg));
app.route("/api/voice/recordings", createVoiceRecordingRoutes(cfg));
app.route("/api/voice/enrollments", createVoiceEnrollmentRoutes(cfg));
app.route("/api/voice/enrollments", createEnrollmentAudioRoutes(cfg));
app.route("/api/voice/enrollments", createEnrollmentInvalidateRoutes(cfg));
app.route("/api/tts", createTtsRoutes(cfg));
app.route("/api/tts", createTtsDownloadRoutes(cfg));
app.route("/api/admin/analytics", createAdminAnalyticsRoutes(cfg));
app.route("/api/admin/users", createAdminUsersRoutes(cfg));
app.route("/api/admin/invite-codes", createAdminInviteCodesRoutes(cfg));
app.route("/api/admin/voice-generations", createAdminVoiceGenerationsRoutes(cfg));

loggerInfo("server.start", {
  port: cfg.server.port,
});

const server = {
  port: cfg.server.port,
  fetch: app.fetch,
};

export default server;
