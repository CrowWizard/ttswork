import { Hono } from "hono";
import { requireAdminBasicAuth } from "../lib/admin-auth";
import type { AppConfig } from "../lib/config";
import { errorResponse } from "../lib/http";
import { getAdminUserDetail, listAdminUsers } from "../modules/admin/admin-users-service";
import { adminUsersListQuerySchema } from "../schemas/admin";

export function createAdminUsersRoutes(cfg: AppConfig) {
  const adminUsers = new Hono();

  adminUsers.use("*", requireAdminBasicAuth(cfg));

  adminUsers.get("/", async (c) => {
    const parsedQuery = adminUsersListQuerySchema.safeParse(c.req.query());

    if (!parsedQuery.success) {
      return errorResponse(c, parsedQuery.error.issues[0]?.message ?? "请求参数无效");
    }

    return c.json(await listAdminUsers(parsedQuery.data));
  });

  adminUsers.get("/:id", async (c) => {
    const detail = await getAdminUserDetail(c.req.param("id"));

    if (!detail) {
      return errorResponse(c, "用户不存在", 404);
    }

    return c.json(detail);
  });

  return adminUsers;
}
