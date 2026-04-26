import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "./config";

type LogLevel = AppConfig["server"]["logLevel"];

const LOG_LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

let currentLogLevel: LogLevel = "info";
let logFilePath = "/var/log/voice-mvp/api-server.log";

function shouldLog(level: LogLevel) {
  return LOG_LEVEL_WEIGHT[level] >= LOG_LEVEL_WEIGHT[currentLogLevel];
}

function safeSerialize(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => safeSerialize(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, safeSerialize(item)]),
    );
  }

  return value;
}

function writeLog(level: LogLevel, event: string, context: Record<string, unknown> = {}) {
  if (!shouldLog(level)) {
    return;
  }

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...(safeSerialize(context) as Record<string, unknown>),
  };
  const line = `${JSON.stringify(entry)}\n`;

  try {
    appendFileSync(logFilePath, line, "utf-8");
  } catch (error) {
    process.stderr.write(`[logger] write failed ${(error as Error).message}\n`);
  }

  const output = line.trimEnd();

  if (level === "error") {
    console.error(output);
    return;
  }

  if (level === "warn") {
    console.warn(output);
    return;
  }

  console.info(output);
}

export function initLogger(serverConfig: AppConfig["server"]) {
  currentLogLevel = serverConfig.logLevel;
  logFilePath = join(serverConfig.logDir, "api-server.log");
}

export function isDebugEnabled() {
  return currentLogLevel === "debug";
}

export function loggerDebug(event: string, context: Record<string, unknown> = {}) {
  writeLog("debug", event, context);
}

export function loggerInfo(event: string, context: Record<string, unknown> = {}) {
  writeLog("info", event, context);
}

export function loggerWarn(event: string, context: Record<string, unknown> = {}) {
  writeLog("warn", event, context);
}

export function loggerError(event: string, context: Record<string, unknown> = {}) {
  writeLog("error", event, context);
}

export function buildErrorLogContext(error: unknown) {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack,
    };
  }

  return {
    errorMessage: String(error),
  };
}
