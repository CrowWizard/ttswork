import { Hono } from "hono";
import type { AppConfig } from "../lib/config";
import { prisma } from "../lib/prisma";
import { checkMinioHealth } from "../lib/minio";

export function createHealthRoutes(cfg: AppConfig) {
  const health = new Hono();

  health.get("/", async (c) => {
    const database = await prisma.$queryRaw`SELECT 1`
      .then(() => ({ ok: true }))
      .catch((error: unknown) => ({
        ok: false,
        message: error instanceof Error ? error.message : "unknown database error",
      }));

    const minio = await checkMinioHealth(cfg.minio);
    const healthy = database.ok && minio.ok;

    return c.json(
      {
        ok: healthy,
        services: {
          database,
          minio,
          qwen: {
            ok: true,
            mode: cfg.qwen.mockMode ? "true" : "false",
          },
        },
        timestamp: new Date().toISOString(),
      },
      healthy ? 200 : 503,
    );
  });

  return health;
}
