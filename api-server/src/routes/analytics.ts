import { Hono } from "hono";
import { requireCurrentUser } from "../lib/auth";
import type { AppConfig } from "../lib/config";
import { errorResponse } from "../lib/http";
import { collectAnalyticsEvent } from "../modules/analytics/analytics-service";
import { analyticsCollectSchema } from "../schemas/analytics";

export function createAnalyticsRoutes(cfg: AppConfig) {
  const analytics = new Hono();

  analytics.post("/collect", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsedBody = analyticsCollectSchema.safeParse(body);

    if (!parsedBody.success) {
      return errorResponse(c, parsedBody.error.issues[0]?.message ?? "请求参数无效");
    }

    const currentUser = await requireCurrentUser(c, cfg);
    const result = await collectAnalyticsEvent({
      ...parsedBody.data,
      user_id: currentUser?.id,
    });

    return c.json({
      success: true,
      visitorId: result.visitorId,
      sessionId: result.sessionId,
      eventId: result.eventId,
      channel: result.channel,
    }, 201);
  });

  return analytics;
}
