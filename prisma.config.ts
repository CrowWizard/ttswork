import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "prisma/config";

type DatabaseConfig = {
  host?: string;
  port?: number;
  name?: string;
  user?: string;
  password?: string;
  schema?: string;
};

function findConfigPath() {
  const paths = [
    ...(process.env.CONFIG_PATH ? [resolve(process.env.CONFIG_PATH)] : []),
    resolve(process.cwd(), "config.yaml"),
    resolve(process.cwd(), "config.yml"),
    resolve(process.cwd(), "api-server/config.yaml"),
    resolve(process.cwd(), "api-server/config.yml"),
    resolve("/opt/voice-mvp/config.yaml"),
    resolve("/etc/voice-mvp/config.yaml"),
  ];

  return paths.find((item) => existsSync(item)) ?? null;
}

function parseDatabaseSection(rawConfig: string): DatabaseConfig {
  const database: Record<string, string | number> = {};
  const lines = rawConfig.split(/\r?\n/);
  let inDatabase = false;

  for (const line of lines) {
    if (/^database:\s*$/.test(line)) {
      inDatabase = true;
      continue;
    }

    if (inDatabase && /^[^\s].*:/.test(line)) {
      break;
    }

    if (!inDatabase) {
      continue;
    }

    const matched = line.match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/);

    if (!matched) {
      continue;
    }

    const key = matched[1];
    const rawValue = matched[2].trim().replace(/^['"]|['"]$/g, "");
    database[key] = key === "port" ? Number(rawValue) : rawValue;
  }

  return database;
}

function readDatabaseConfig(): DatabaseConfig {
  const configPath = findConfigPath();

  if (!configPath) {
    return {};
  }

  return parseDatabaseSection(readFileSync(configPath, "utf-8"));
}

function buildDatabaseUrl() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const database = readDatabaseConfig();
  const host = process.env.DB_HOST ?? database.host ?? "127.0.0.1";
  const port = process.env.DB_PORT ?? String(database.port ?? 5432);
  const name = process.env.DB_NAME ?? database.name ?? "voice_mvp";
  const user = process.env.DB_USER ?? database.user ?? "voice_mvp";
  const password = process.env.DB_PASSWORD ?? database.password ?? "your_password";
  const schema = process.env.DB_SCHEMA ?? database.schema ?? "public";

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${name}?schema=${schema}`;
}

const databaseUrl = buildDatabaseUrl();

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: databaseUrl,
  },
});
