import { randomUUID } from "node:crypto";
import { loadConfig, buildDatabaseUrl, ensureLogDir } from "../lib/config";
import { initLogger, loggerInfo, loggerError, buildErrorLogContext } from "../lib/logger";
import { initPrisma } from "../lib/prisma";
import { claimNextContentGenerationJob } from "../modules/content-generation/content-generation-repository";
import { processContentGenerationJob } from "../modules/content-generation/content-generation-service";

const POLL_INTERVAL_MS = Number(process.env.CONTENT_GENERATION_WORKER_POLL_MS ?? 3000);
const DEBUG_BREAK_ON_START = process.env.CONTENT_GENERATION_WORKER_DEBUG_BREAK === "1";
const workerId = `content-generation-${randomUUID()}`;
const cfg = loadConfig();

initPrisma(buildDatabaseUrl(cfg.database));
ensureLogDir(cfg.server.logDir);
initLogger(cfg.server);

loggerInfo("content_generation.worker.start", { workerId, pollIntervalMs: POLL_INTERVAL_MS });

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWorkerLoop() {
  while (true) {
    try {
      const job = await claimNextContentGenerationJob(workerId);

      if (!job) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      await processContentGenerationJob(cfg, job);
    } catch (error) {
      loggerError("content_generation.worker.loop_failed", {
        workerId,
        ...buildErrorLogContext(error),
      });
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

void runWorkerLoop();
