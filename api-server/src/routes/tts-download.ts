import { Hono } from "hono";
import type { AppConfig } from "../lib/config";
import { requireCurrentUser, unauthorizedResponse } from "../lib/auth";
import { errorResponse } from "../lib/http";
import { getObjectBuffer } from "../lib/minio";
import { prisma } from "../lib/prisma";

export function createTtsDownloadRoutes(cfg: AppConfig) {
  const ttsDownload = new Hono();

  ttsDownload.get("/:jobId/download", async (c) => {
    const currentUser = await requireCurrentUser(c, cfg);

    if (!currentUser) {
      return unauthorizedResponse(c);
    }

    const jobId = c.req.param("jobId");
    const job = await prisma.ttsJob.findFirst({
      where: {
        id: jobId,
        userId: currentUser.id,
      },
    });

    if (!job) {
      return errorResponse(c, "任务不存在", 404);
    }

    if (job.status !== "READY" || !job.objectKey || !job.outputContentType) {
      return errorResponse(c, "语音尚未生成完成", 409);
    }

    const audioBuffer = await getObjectBuffer(cfg.minio, job.objectKey);

    return new Response(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": job.outputContentType,
        "Content-Disposition": `inline; filename="${job.id}"`,
        "Cache-Control": "no-store",
      },
    });
  });

  return ttsDownload;
}
