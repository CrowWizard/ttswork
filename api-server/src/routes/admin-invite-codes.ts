import { Hono } from "hono";
import { requireAdminBasicAuth } from "../lib/admin-auth";
import type { AppConfig } from "../lib/config";
import { errorResponse } from "../lib/http";
import {
  generateAdminInviteCodes,
  getAdminInviteCodeTtsJobs,
  listAdminInviteCodes,
} from "../modules/admin/admin-invite-codes-service";
import {
  adminInviteCodesGenerateBodySchema,
  adminInviteCodesListQuerySchema,
} from "../schemas/admin";

export function createAdminInviteCodesRoutes(cfg: AppConfig) {
  const adminInviteCodes = new Hono();

  adminInviteCodes.use("*", requireAdminBasicAuth(cfg));

  adminInviteCodes.get("/", async (c) => {
    const parsedQuery = adminInviteCodesListQuerySchema.safeParse(c.req.query());

    if (!parsedQuery.success) {
      return errorResponse(c, parsedQuery.error.issues[0]?.message ?? "请求参数无效");
    }

    return c.json(await listAdminInviteCodes(parsedQuery.data));
  });

  adminInviteCodes.post("/generate", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsedBody = adminInviteCodesGenerateBodySchema.safeParse(body);

    if (!parsedBody.success) {
      return errorResponse(c, parsedBody.error.issues[0]?.message ?? "请求参数无效");
    }

    return c.json(await generateAdminInviteCodes(parsedBody.data.count), 201);
  });

  adminInviteCodes.get("/:id/tts-jobs", async (c) => {
    const result = await getAdminInviteCodeTtsJobs(c.req.param("id"));

    if (!result) {
      return errorResponse(c, "使用码不存在", 404);
    }

    return c.json(result);
  });

  return adminInviteCodes;
}
