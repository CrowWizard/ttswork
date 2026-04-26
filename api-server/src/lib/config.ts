import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseDotenv } from "dotenv";
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
    publicBaseUrl: string;
  };
  qwen: {
    mockMode: boolean;
    apiKey: string;
    pureEnrollUrl: string;
    sceneEnrollUrl: string;
    pureTtsUrl: string;
    sceneTtsUrl: string;
    trialVoiceId: string;
  };
  cookie: {
    secure: boolean;
    maxAge: number;
    sameSite: "Lax" | "Strict" | "None";
  };
  auth: {
    sessionCookieName: string;
    sessionTtlSeconds: number;
    sessionTouchIntervalSeconds: number;
  };
  sms: {
    mockMode: boolean;
    accessKeyId: string;
    accessKeySecret: string;
    endpoint: string;
    signName: string;
    templateCode: string;
    templateParam: string;
    registerSchemeName: string;
    loginSchemeName: string;
    passwordChangeSchemeName: string;
    codeLength: number;
    validTimeSeconds: number;
    intervalSeconds: number;
    codeType: number;
    returnVerifyCode: boolean;
  };
};

import { statSync } from "node:fs";

const API_SERVER_DIR = fileURLToPath(new URL("../../", import.meta.url));

function loadEnvFiles(): string[] {
  const candidates = [resolve(API_SERVER_DIR, "../.env"), resolve(API_SERVER_DIR, ".env")];
  const loadedPaths: string[] = [];
  const mergedEnv: Record<string, string> = {};

  for (const envPath of candidates) {
    if (!isRegularFile(envPath)) {
      continue;
    }

    Object.assign(mergedEnv, parseDotenv(readFileSync(envPath, "utf-8")));
    loadedPaths.push(envPath);
  }

  for (const [key, value] of Object.entries(mergedEnv)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  return loadedPaths;
}

const LOADED_ENV_PATHS = loadEnvFiles();

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

function envSameSite(key: string, fallback: AppConfig["cookie"]["sameSite"]): AppConfig["cookie"]["sameSite"] {
  const raw = process.env[key];

  if (raw === "Strict" || raw === "None" || raw === "Lax") {
    return raw;
  }

  return fallback;
}

export function loadConfig(): AppConfig {
  const file = readConfigFile();

  const server: Partial<AppConfig["server"]> = file?.server ?? {};
  const database: Partial<AppConfig["database"]> = file?.database ?? {};
  const minio: Partial<AppConfig["minio"]> = file?.minio ?? {};
  const qwen = (file?.qwen ?? {}) as Partial<AppConfig["qwen"]> & {
    enrollUrl?: string;
    ttsUrl?: string;
  };
  const cookie: Partial<AppConfig["cookie"]> = file?.cookie ?? {};
  const auth: Partial<AppConfig["auth"]> = file?.auth ?? {};
  const sms: Partial<AppConfig["sms"]> = file?.sms ?? {};

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
      publicBaseUrl: envString("MINIO_PUBLIC_BASE_URL", minio.publicBaseUrl ?? "http://127.0.0.1/minio"),
    },
    qwen: {
      mockMode: envBool("QWEN_MOCK_MODE", qwen.mockMode ?? true),
      apiKey: envString("QWEN_API_KEY", qwen.apiKey ?? ""),
      pureEnrollUrl: envString(
        "QWEN_PURE_ENROLL_URL",
        process.env.QWEN_ENROLL_URL ??
        qwen.pureEnrollUrl ??
        qwen.enrollUrl ??
        "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization",
      ),
      sceneEnrollUrl: envString(
        "QWEN_SCENE_ENROLL_URL",
        process.env.QWEN_ENROLL_URL ??
        qwen.sceneEnrollUrl ??
        qwen.enrollUrl ??
        "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization",
      ),
      pureTtsUrl: envString(
        "QWEN_PURE_TTS_URL",
        process.env.QWEN_TTS_URL ??
        qwen.pureTtsUrl ??
        qwen.ttsUrl ??
        "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer",
      ),
      sceneTtsUrl: envString(
        "QWEN_SCENE_TTS_URL",
        process.env.QWEN_TTS_URL ??
        qwen.sceneTtsUrl ??
        qwen.ttsUrl ??
        "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer",
      ),
      trialVoiceId: envString("QWEN_TRIAL_VOICE_ID", qwen.trialVoiceId ?? "Cherry"),
    },
    cookie: {
      secure: envBool("COOKIE_SECURE", cookie.secure ?? false),
      maxAge: envInt("COOKIE_MAX_AGE", cookie.maxAge ?? auth.sessionTtlSeconds ?? 2592000),
      sameSite: envSameSite("COOKIE_SAME_SITE", cookie.sameSite ?? "Lax"),
    },
    auth: {
      sessionCookieName: envString("AUTH_SESSION_COOKIE_NAME", auth.sessionCookieName ?? "voice_session"),
      sessionTtlSeconds: envInt("AUTH_SESSION_TTL_SECONDS", auth.sessionTtlSeconds ?? 2592000),
      sessionTouchIntervalSeconds: envInt(
        "AUTH_SESSION_TOUCH_INTERVAL_SECONDS",
        auth.sessionTouchIntervalSeconds ?? 300,
      ),
    },
    sms: {
      mockMode: envBool("SMS_MOCK_MODE", sms.mockMode ?? true),
      accessKeyId: envString("SMS_ACCESS_KEY_ID", sms.accessKeyId ?? ""),
      accessKeySecret: envString("SMS_ACCESS_KEY_SECRET", sms.accessKeySecret ?? ""),
      endpoint: envString("SMS_ENDPOINT", sms.endpoint ?? "dypnsapi.aliyuncs.com"),
      signName: envString("SMS_SIGN_NAME", sms.signName ?? ""),
      templateCode: envString("SMS_TEMPLATE_CODE", sms.templateCode ?? ""),
      templateParam: envString("SMS_TEMPLATE_PARAM", sms.templateParam ?? ""),
      registerSchemeName: envString("SMS_REGISTER_SCHEME_NAME", sms.registerSchemeName ?? "register"),
      loginSchemeName: envString("SMS_LOGIN_SCHEME_NAME", sms.loginSchemeName ?? "login"),
      passwordChangeSchemeName: envString("SMS_PASSWORD_CHANGE_SCHEME_NAME", sms.passwordChangeSchemeName ?? "password_change"),
      codeLength: envInt("SMS_CODE_LENGTH", sms.codeLength ?? 6),
      validTimeSeconds: envInt("SMS_VALID_TIME_SECONDS", sms.validTimeSeconds ?? 300),
      intervalSeconds: envInt("SMS_INTERVAL_SECONDS", sms.intervalSeconds ?? 60),
      codeType: envInt("SMS_CODE_TYPE", sms.codeType ?? 1),
      returnVerifyCode: envBool("SMS_RETURN_VERIFY_CODE", sms.returnVerifyCode ?? false),
    },
  };

  // 用脱敏摘要固定记录配置来源，避免启动目录变化时误判配置未生效。
  console.info(
    `[config] cwd=${process.cwd()} envFiles=${LOADED_ENV_PATHS.join(",") || "none"} configFile=${findConfigFile() ?? "none"}`,
  );
  console.info(
    `[config] dbHost=${config.database.host} dbPort=${config.database.port} dbName=${config.database.name} dbUser=${config.database.user} dbPasswordSet=${config.database.password.length > 0}`,
  );

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
