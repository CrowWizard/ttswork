import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

export type AppConfig = {
  server: {
    port: number;
    logLevel: "debug" | "info" | "warn" | "error";
    logDir: string;
  };
  database: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
    schema: string;
  };
  minio: {
    endpoint: string;
    port: number;
    useSSL: boolean;
    accessKey: string;
    secretKey: string;
    bucket: string;
  };
  qwen: {
    mockMode: boolean;
    apiKey: string;
    enrollUrl: string;
    ttsUrl: string;
  };
  cookie: {
    secure: boolean;
    maxAge: number;
  };
};

import { statSync } from "node:fs";

function isRegularFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function buildConfigPaths(): string[] {
  const paths: string[] = [];

  const envPath = process.env.CONFIG_PATH;
  if (envPath) {
    paths.push(resolve(envPath));
  }

  paths.push(resolve(process.cwd(), "config.yaml"));
  paths.push(resolve(process.cwd(), "config.yml"));
  paths.push(resolve("/etc/voice-mvp/config.yaml"));

  return paths;
}

function findConfigFile(): string | null {
  for (const p of buildConfigPaths()) {
    if (isRegularFile(p)) {
      return p;
    }
  }
  return null;
}

function readConfigFile(): Partial<AppConfig> | null {
  const configPath = findConfigFile();

  if (!configPath) {
    return null;
  }

  console.info(`[config] 加载配置文件: ${configPath}`);

  const raw = readFileSync(configPath, "utf-8");

  return parseYaml(raw) as Partial<AppConfig>;
}

function envString(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (!raw) return fallback;
  return raw === "true" || raw === "1";
}

export function loadConfig(): AppConfig {
  const file = readConfigFile();

  const server: Partial<AppConfig["server"]> = file?.server ?? {};
  const database: Partial<AppConfig["database"]> = file?.database ?? {};
  const minio: Partial<AppConfig["minio"]> = file?.minio ?? {};
  const qwen: Partial<AppConfig["qwen"]> = file?.qwen ?? {};
  const cookie: Partial<AppConfig["cookie"]> = file?.cookie ?? {};

  const config: AppConfig = {
    server: {
      port: envInt("PORT", server.port ?? 3001),
      logLevel: envString("LOG_LEVEL", server.logLevel ?? "info") as AppConfig["server"]["logLevel"],
      logDir: envString("LOG_DIR", server.logDir ?? "/var/log/voice-mvp"),
    },
    database: {
      host: envString("DB_HOST", database.host ?? "127.0.0.1"),
      port: envInt("DB_PORT", database.port ?? 5432),
      name: envString("DB_NAME", database.name ?? "voice_mvp"),
      user: envString("DB_USER", database.user ?? "voice_mvp"),
      password: envString("DB_PASSWORD", database.password ?? "your_password"),
      schema: envString("DB_SCHEMA", database.schema ?? "public"),
    },
    minio: {
      endpoint: envString("MINIO_ENDPOINT", minio.endpoint ?? "127.0.0.1"),
      port: envInt("MINIO_PORT", minio.port ?? 9000),
      useSSL: envBool("MINIO_USE_SSL", minio.useSSL ?? false),
      accessKey: envString("MINIO_ACCESS_KEY", minio.accessKey ?? "minioadmin"),
      secretKey: envString("MINIO_SECRET_KEY", minio.secretKey ?? "minioadmin"),
      bucket: envString("MINIO_BUCKET", minio.bucket ?? "voice-mvp"),
    },
    qwen: {
      mockMode: envBool("QWEN_MOCK_MODE", qwen.mockMode ?? true),
      apiKey: envString("QWEN_API_KEY", qwen.apiKey ?? ""),
      enrollUrl: envString("QWEN_ENROLL_URL", qwen.enrollUrl ?? ""),
      ttsUrl: envString("QWEN_TTS_URL", qwen.ttsUrl ?? ""),
    },
    cookie: {
      secure: envBool("COOKIE_SECURE", cookie.secure ?? false),
      maxAge: envInt("COOKIE_MAX_AGE", cookie.maxAge ?? 31536000),
    },
  };

  return config;
}

export function buildDatabaseUrl(cfg: AppConfig["database"]): string {
  // 对用户名和密码做 URL 编码，防止 # $ ! @ : 等特殊字符破坏连接字符串解析
  const user = encodeURIComponent(cfg.user);
  const password = encodeURIComponent(cfg.password);
  return `postgresql://${user}:${password}@${cfg.host}:${cfg.port}/${cfg.name}?schema=${cfg.schema}`;
}

export function ensureLogDir(logDir: string): void {
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
}
