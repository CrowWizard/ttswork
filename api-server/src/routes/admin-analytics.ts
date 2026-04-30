import { Hono } from "hono";
import { requireAdminBasicAuth } from "../lib/admin-auth";
import type { AppConfig } from "../lib/config";
import { errorResponse } from "../lib/http";
import {
  getAdminAnalyticsChannels,
  getAdminAnalyticsOverview,
  getAdminAnalyticsTrend,
} from "../modules/admin/admin-analytics-service";
import {
  adminAnalyticsChannelsQuerySchema,
  adminAnalyticsOverviewQuerySchema,
  adminAnalyticsTrendQuerySchema,
} from "../schemas/admin";

export function createAdminAnalyticsRoutes(cfg: AppConfig) {
  const adminAnalytics = new Hono();

  adminAnalytics.use("*", requireAdminBasicAuth(cfg));

  adminAnalytics.get("/overview", async (c) => {
    const parsedQuery = adminAnalyticsOverviewQuerySchema.safeParse(c.req.query());

    if (!parsedQuery.success) {
      return errorResponse(c, parsedQuery.error.issues[0]?.message ?? "请求参数无效");
    }

    return c.json(await getAdminAnalyticsOverview(parsedQuery.data));
  });

  adminAnalytics.get("/trend", async (c) => {
    const parsedQuery = adminAnalyticsTrendQuerySchema.safeParse(c.req.query());

    if (!parsedQuery.success) {
      return errorResponse(c, parsedQuery.error.issues[0]?.message ?? "请求参数无效");
    }

    return c.json(await getAdminAnalyticsTrend(parsedQuery.data));
  });

  adminAnalytics.get("/channels", async (c) => {
    const parsedQuery = adminAnalyticsChannelsQuerySchema.safeParse(c.req.query());

    if (!parsedQuery.success) {
      return errorResponse(c, parsedQuery.error.issues[0]?.message ?? "请求参数无效");
    }

    return c.json(await getAdminAnalyticsChannels(parsedQuery.data));
  });

  return adminAnalytics;
}
