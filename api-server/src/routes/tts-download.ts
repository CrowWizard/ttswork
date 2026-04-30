import { Hono } from "hono";
import { getAudioExtension, resolveSupportedAudioMimeType } from "../lib/audio-format";
import type { AppConfig } from "../lib/config";
import { requireCurrentUser, resolveAnonymousUser, unauthorizedResponse } from "../lib/auth";
import { errorResponse } from "../lib/http";
import { getObjectBuffer } from "../lib/minio";
import { prisma } from "../lib/prisma";

export function createTtsDownloadRoutes(cfg: AppConfig) {
  const ttsDownload = new Hono();

  ttsDownload.get("/:jobId/download", async (c) => {
    const currentUser = await requireCurrentUser(c, cfg);
    const anonymousUser = currentUser ? null : await resolveAnonymousUser(c, cfg);

    if (!currentUser && !anonymousUser) {
      return unauthorizedResponse(c);
    }

    const jobId = c.req.param("jobId");
    const job = await prisma.ttsJob.findFirst({
      where: {
        id: jobId,
        ...(currentUser ? { userId: currentUser.id } : { anonymousUserId: anonymousUser?.id }),
      },
    });

    if (!job) {
      return errorResponse(c, "任务不存在", 404);
    }

    if (job.status !== "READY" || !job.objectKey || !job.outputContentType) {
      return errorResponse(c, "语音尚未生成完成", 409);
    }

    const audioBuffer = await getObjectBuffer(cfg.minio, job.objectKey);
    const supportedMimeType = resolveSupportedAudioMimeType(job.outputContentType);
    const extension = supportedMimeType ? getAudioExtension(supportedMimeType) : "wav";
    const timestamp = job.createdAt.getTime();
    const filename = `tts-${job.profileKind === "SCENE" ? "scene" : "pure"}-${timestamp}.${extension}`;

    return new Response(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": job.outputContentType,
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  });

  return ttsDownload;
}
