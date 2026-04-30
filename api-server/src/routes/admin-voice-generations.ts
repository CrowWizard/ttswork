import { Hono } from "hono";
import { requireAdminBasicAuth } from "../lib/admin-auth";
import type { AppConfig } from "../lib/config";
import { errorResponse } from "../lib/http";
import {
  getAdminVoiceGenerationDetail,
  listAdminVoiceGenerations,
} from "../modules/admin/admin-voice-generations-service";
import { adminVoiceGenerationsListQuerySchema } from "../schemas/admin";

export function createAdminVoiceGenerationsRoutes(cfg: AppConfig) {
  const adminVoiceGenerations = new Hono();

  adminVoiceGenerations.use("*", requireAdminBasicAuth(cfg));

  adminVoiceGenerations.get("/", async (c) => {
    const parsedQuery = adminVoiceGenerationsListQuerySchema.safeParse(c.req.query());

    if (!parsedQuery.success) {
      return errorResponse(c, parsedQuery.error.issues[0]?.message ?? "请求参数无效");
    }

    return c.json(await listAdminVoiceGenerations(parsedQuery.data));
  });

  adminVoiceGenerations.get("/:id", async (c) => {
    const detail = await getAdminVoiceGenerationDetail(c.req.param("id"));

    if (!detail) {
      return errorResponse(c, "语音生成记录不存在", 404);
    }

    return c.json(detail);
  });

  return adminVoiceGenerations;
}
