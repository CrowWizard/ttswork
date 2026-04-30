import { Prisma } from "@prisma/client";
import type { AnalyticsCollectInput } from "../../schemas/analytics";
import { prisma } from "../../lib/prisma";
import {
  createAnalyticsEvent,
  createAnalyticsSession,
  findLatestAnalyticsSession,
  updateAnalyticsSession,
  upsertAnalyticsVisitor,
} from "./analytics-repository";
import { buildAttributionFingerprint, classifyAnalyticsChannel } from "./channel";

const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

function shouldRotateSession(
  latestSession: {
    endedAt: Date;
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    entryReferrer: string | null;
  } | null,
  occurredAt: Date,
  fingerprint: string,
) {
  if (!latestSession) {
    return true;
  }

  if (occurredAt.getTime() - latestSession.endedAt.getTime() > SESSION_IDLE_TIMEOUT_MS) {
    return true;
  }

  const latestFingerprint = buildAttributionFingerprint({
    utmSource: latestSession.utmSource,
    utmMedium: latestSession.utmMedium,
    utmCampaign: latestSession.utmCampaign,
    referrer: latestSession.entryReferrer,
  });

  return latestFingerprint !== fingerprint;
}

export async function collectAnalyticsEvent(input: AnalyticsCollectInput) {
  const occurredAt = input.timestamp ?? new Date();
  const channel = classifyAnalyticsChannel({
    utmSource: input.utm_source,
    utmMedium: input.utm_medium,
    referrer: input.referrer,
  });
  const attributionFingerprint = buildAttributionFingerprint({
    utmSource: input.utm_source,
    utmMedium: input.utm_medium,
    utmCampaign: input.utm_campaign,
    referrer: input.referrer,
  });

  return prisma.$transaction(async (tx) => {
    const visitor = await upsertAnalyticsVisitor(tx, {
      anonymousId: input.anonymous_id,
      userId: input.user_id,
      occurredAt,
      referrer: input.referrer,
      utmSource: input.utm_source,
      utmMedium: input.utm_medium,
      utmCampaign: input.utm_campaign,
      landingPage: input.url,
    });

    const latestSession = await findLatestAnalyticsSession(tx, input.anonymous_id);
    const shouldCreateNewSession = shouldRotateSession(latestSession, occurredAt, attributionFingerprint);

    const analyticsSession = shouldCreateNewSession
      ? await createAnalyticsSession(tx, {
          anonymousId: input.anonymous_id,
          userId: input.user_id,
          clientSessionId: input.session_id,
          startedAt: occurredAt,
          endedAt: occurredAt,
          entryPage: input.url,
          entryReferrer: input.referrer,
          utmSource: input.utm_source,
          utmMedium: input.utm_medium,
          utmCampaign: input.utm_campaign,
          channel,
        })
      : await updateAnalyticsSession(tx, latestSession!.id, {
          endedAt: occurredAt > latestSession!.endedAt ? occurredAt : latestSession!.endedAt,
          userId: input.user_id ?? latestSession!.userId,
          clientSessionId: latestSession!.clientSessionId ?? input.session_id ?? undefined,
        });

    const analyticsEvent = await createAnalyticsEvent(tx, {
      anonymousId: input.anonymous_id,
      userId: input.user_id,
      analyticsSessionId: analyticsSession.id,
      eventName: input.event_name,
      url: input.url,
      referrer: input.referrer,
      utmSource: input.utm_source,
      utmMedium: input.utm_medium,
      utmCampaign: input.utm_campaign,
      channel,
      occurredAt,
    });

    return {
      visitorId: visitor.id,
      sessionId: analyticsSession.id,
      eventId: analyticsEvent.id,
      channel,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
