import type { AnalyticsChannel, AnalyticsEventName, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";

type DbClient = Prisma.TransactionClient | typeof prisma;

export type UpsertAnalyticsVisitorInput = {
  anonymousId: string;
  userId?: string | null;
  occurredAt: Date;
  referrer?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  landingPage: string;
};

export type CreateAnalyticsSessionInput = {
  anonymousId: string;
  userId?: string | null;
  clientSessionId?: string | null;
  startedAt: Date;
  endedAt: Date;
  entryPage: string;
  entryReferrer?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  channel: AnalyticsChannel;
};

export type CreateAnalyticsEventInput = {
  anonymousId: string;
  userId?: string | null;
  analyticsSessionId: string;
  eventName: AnalyticsEventName;
  url: string;
  referrer?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  channel: AnalyticsChannel;
  occurredAt: Date;
};

export async function upsertAnalyticsVisitor(db: DbClient, input: UpsertAnalyticsVisitorInput) {
  const existing = await db.analyticsVisitor.findUnique({
    where: { anonymousId: input.anonymousId },
  });

  if (!existing) {
    return db.analyticsVisitor.create({
      data: {
        anonymousId: input.anonymousId,
        userId: input.userId ?? null,
        firstSeenAt: input.occurredAt,
        lastSeenAt: input.occurredAt,
        firstReferrer: input.referrer ?? null,
        firstUtmSource: input.utmSource ?? null,
        firstUtmMedium: input.utmMedium ?? null,
        firstUtmCampaign: input.utmCampaign ?? null,
        firstLandingPage: input.landingPage,
      },
    });
  }

  return db.analyticsVisitor.update({
    where: { id: existing.id },
    data: {
      lastSeenAt: input.occurredAt,
      userId: input.userId ?? existing.userId,
    },
  });
}

export async function findLatestAnalyticsSession(db: DbClient, anonymousId: string) {
  return db.analyticsSession.findFirst({
    where: { anonymousId },
    orderBy: [
      { endedAt: "desc" },
      { startedAt: "desc" },
    ],
  });
}

export async function createAnalyticsSession(db: DbClient, input: CreateAnalyticsSessionInput) {
  return db.analyticsSession.create({
    data: {
      anonymousId: input.anonymousId,
      userId: input.userId ?? null,
      clientSessionId: input.clientSessionId ?? null,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      entryPage: input.entryPage,
      entryReferrer: input.entryReferrer ?? null,
      utmSource: input.utmSource ?? null,
      utmMedium: input.utmMedium ?? null,
      utmCampaign: input.utmCampaign ?? null,
      channel: input.channel,
    },
  });
}

export async function updateAnalyticsSession(db: DbClient, sessionId: string, data: Prisma.AnalyticsSessionUpdateInput) {
  return db.analyticsSession.update({
    where: { id: sessionId },
    data,
  });
}

export async function createAnalyticsEvent(db: DbClient, input: CreateAnalyticsEventInput) {
  return db.analyticsEvent.create({
    data: {
      anonymousId: input.anonymousId,
      userId: input.userId ?? null,
      analyticsSessionId: input.analyticsSessionId,
      eventName: input.eventName,
      url: input.url,
      referrer: input.referrer ?? null,
      utmSource: input.utmSource ?? null,
      utmMedium: input.utmMedium ?? null,
      utmCampaign: input.utmCampaign ?? null,
      channel: input.channel,
      occurredAt: input.occurredAt,
    },
  });
}
