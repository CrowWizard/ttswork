import { Hono } from "hono";
import { cors } from "hono/cors";
import { loadConfig, buildDatabaseUrl, ensureLogDir } from "./lib/config";
import { prisma } from "./lib/prisma";
import { createHealthRoutes } from "./routes/health";
import { createVoiceProfileRoutes } from "./routes/voice-profile";
import { createVoiceEnrollRoutes } from "./routes/voice-enroll";
import { createEnrollmentAudioRoutes } from "./routes/enrollment-audio";
import { createEnrollmentInvalidateRoutes } from "./routes/enrollment-invalidate";
import { createTtsRoutes } from "./routes/tts";
import { createTtsDownloadRoutes } from "./routes/tts-download";

const cfg = loadConfig();

console.info(`[config] server.port=${cfg.server.port}`);
console.info(`[config] database=${cfg.database.host}:${cfg.database.port}/${cfg.database.name}`);
console.info(`[config] minio=${cfg.minio.endpoint}:${cfg.minio.port}/${cfg.minio.bucket}`);
console.info(`[config] qwen.mockMode=${cfg.qwen.mockMode}`);
console.info(`[config] log.dir=${cfg.server.logDir}`);

process.env.DATABASE_URL = buildDatabaseUrl(cfg.database);

ensureLogDir(cfg.server.logDir);

const app = new Hono();

app.use("*", cors({
  origin: (origin) => origin || "*",
  credentials: true,
}));

app.route("/api/health", createHealthRoutes(cfg));
app.route("/api/voice/profile", createVoiceProfileRoutes(cfg));
app.route("/api/voice/enroll", createVoiceEnrollRoutes(cfg));
app.route("/api/voice/enrollments", createEnrollmentAudioRoutes(cfg));
app.route("/api/voice/enrollments", createEnrollmentInvalidateRoutes(cfg));
app.route("/api/tts", createTtsRoutes(cfg));
app.route("/api/tts", createTtsDownloadRoutes(cfg));

console.info(`[voice-mvp-api] listening on port ${cfg.server.port}`);

export default {
  port: cfg.server.port,
  fetch: app.fetch,
};
