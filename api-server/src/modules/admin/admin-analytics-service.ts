import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";

type DateRange = {
  startAt?: Date;
  endAt?: Date;
};

type DailyCountRow = {
  day: Date;
  count: bigint | number;
};

type ChannelCountRow = {
  channel: string;
  count: bigint | number;
};

function toNumber(value: bigint | number | null | undefined) {
  return Number(value ?? 0);
}

function buildRangeWhere(column: Prisma.Sql, range: DateRange) {
  if (range.startAt && range.endAt) {
    return Prisma.sql`WHERE ${column} >= ${range.startAt} AND ${column} <= ${range.endAt}`;
  }

  if (range.startAt) {
    return Prisma.sql`WHERE ${column} >= ${range.startAt}`;
  }

  if (range.endAt) {
    return Prisma.sql`WHERE ${column} <= ${range.endAt}`;
  }

  return Prisma.empty;
}

function buildRangeAnd(column: Prisma.Sql, range: DateRange) {
  if (range.startAt && range.endAt) {
    return Prisma.sql`AND ${column} >= ${range.startAt} AND ${column} <= ${range.endAt}`;
  }

  if (range.startAt) {
    return Prisma.sql`AND ${column} >= ${range.startAt}`;
  }

  if (range.endAt) {
    return Prisma.sql`AND ${column} <= ${range.endAt}`;
  }

  return Prisma.empty;
}

async function queryDistinctCount(sql: Prisma.Sql) {
  const rows = await prisma.$queryRaw<Array<{ count: bigint | number }>>(sql);
  return toNumber(rows[0]?.count);
}

function buildDateSeries(range: DateRange) {
  const end = range.endAt ? new Date(range.endAt) : new Date();
  const start = range.startAt ? new Date(range.startAt) : new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000);
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  const keys: string[] = [];

  while (cursor.getTime() <= last.getTime()) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return keys;
}

function mapDailyRows(rows: DailyCountRow[]) {
  return new Map(
    rows.map((row) => [
      row.day.toISOString().slice(0, 10),
      toNumber(row.count),
    ]),
  );
}

export async function getAdminAnalyticsOverview(range: DateRange) {
  const pvPromise = prisma.analyticsEvent.count({
    where: {
      eventName: "PAGE_VIEW",
      occurredAt: {
        gte: range.startAt,
        lte: range.endAt,
      },
    },
  });

  const sessionsPromise = prisma.analyticsSession.count({
    where: {
      startedAt: {
        gte: range.startAt,
        lte: range.endAt,
      },
    },
  });

  const newUsersPromise = prisma.user.count({
    where: {
      createdAt: {
        gte: range.startAt,
        lte: range.endAt,
      },
    },
  });

  const voiceGenerationsPromise = prisma.ttsJob.count({
    where: {
      createdAt: {
        gte: range.startAt,
        lte: range.endAt,
      },
    },
  });

  const [pv, sessions, newUsers, voiceGenerations, uv, voiceprintUsers, voiceGenerationUsers, inviteCodeUsers] = await Promise.all([
    pvPromise,
    sessionsPromise,
    newUsersPromise,
    voiceGenerationsPromise,
    queryDistinctCount(Prisma.sql`
      SELECT COUNT(DISTINCT "anonymousId")::bigint AS count
      FROM "AnalyticsEvent"
      ${buildRangeWhere(Prisma.sql`"occurredAt"`, range)}
    `),
    queryDistinctCount(Prisma.sql`
      SELECT COUNT(DISTINCT "userId")::bigint AS count
      FROM "VoiceEnrollment"
      WHERE "status" = 'READY' AND "userId" IS NOT NULL
      ${buildRangeAnd(Prisma.sql`"createdAt"`, range)}
    `),
    queryDistinctCount(Prisma.sql`
      SELECT COUNT(DISTINCT "userId")::bigint AS count
      FROM "TtsJob"
      WHERE "userId" IS NOT NULL
      ${buildRangeAnd(Prisma.sql`"createdAt"`, range)}
    `),
    queryDistinctCount(Prisma.sql`
      SELECT COUNT(DISTINCT "consumedByUserId")::bigint AS count
      FROM "UsageCode"
      WHERE "consumedByUserId" IS NOT NULL
      ${buildRangeAnd(Prisma.sql`"consumedAt"`, range)}
    `),
  ]);

  return {
    range,
    metrics: {
      pv,
      uv,
      sessions,
      newUsers,
      voiceprintUsers,
      voiceGenerations,
      voiceGenerationUsers,
      inviteCodeUsers,
    },
  };
}

export async function getAdminAnalyticsTrend(range: DateRange) {
  const [pvRows, uvRows, sessionRows, newUserRows, voiceprintRows, voiceGenerationRows, inviteCodeRows] = await Promise.all([
    prisma.$queryRaw<DailyCountRow[]>(Prisma.sql`
      SELECT date_trunc('day', "occurredAt") AS day, COUNT(*)::bigint AS count
      FROM "AnalyticsEvent"
      WHERE "eventName" = 'PAGE_VIEW'
      ${buildRangeAnd(Prisma.sql`"occurredAt"`, range)}
      GROUP BY 1
      ORDER BY 1 ASC
    `),
    prisma.$queryRaw<DailyCountRow[]>(Prisma.sql`
      SELECT date_trunc('day', "occurredAt") AS day, COUNT(DISTINCT "anonymousId")::bigint AS count
      FROM "AnalyticsEvent"
      ${buildRangeWhere(Prisma.sql`"occurredAt"`, range)}
      GROUP BY 1
      ORDER BY 1 ASC
    `),
    prisma.$queryRaw<DailyCountRow[]>(Prisma.sql`
      SELECT date_trunc('day', "startedAt") AS day, COUNT(*)::bigint AS count
      FROM "AnalyticsSession"
      ${buildRangeWhere(Prisma.sql`"startedAt"`, range)}
      GROUP BY 1
      ORDER BY 1 ASC
    `),
    prisma.$queryRaw<DailyCountRow[]>(Prisma.sql`
      SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::bigint AS count
      FROM "User"
      ${buildRangeWhere(Prisma.sql`"createdAt"`, range)}
      GROUP BY 1
      ORDER BY 1 ASC
    `),
    prisma.$queryRaw<DailyCountRow[]>(Prisma.sql`
      SELECT date_trunc('day', "createdAt") AS day, COUNT(DISTINCT "userId")::bigint AS count
      FROM "VoiceEnrollment"
      WHERE "status" = 'READY' AND "userId" IS NOT NULL
      ${buildRangeAnd(Prisma.sql`"createdAt"`, range)}
      GROUP BY 1
      ORDER BY 1 ASC
    `),
    prisma.$queryRaw<DailyCountRow[]>(Prisma.sql`
      SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::bigint AS count
      FROM "TtsJob"
      ${buildRangeWhere(Prisma.sql`"createdAt"`, range)}
      GROUP BY 1
      ORDER BY 1 ASC
    `),
    prisma.$queryRaw<DailyCountRow[]>(Prisma.sql`
      SELECT date_trunc('day', "consumedAt") AS day, COUNT(DISTINCT "consumedByUserId")::bigint AS count
      FROM "UsageCode"
      WHERE "consumedByUserId" IS NOT NULL AND "consumedAt" IS NOT NULL
      ${buildRangeAnd(Prisma.sql`"consumedAt"`, range)}
      GROUP BY 1
      ORDER BY 1 ASC
    `),
  ]);

  const pvMap = mapDailyRows(pvRows);
  const uvMap = mapDailyRows(uvRows);
  const sessionMap = mapDailyRows(sessionRows);
  const newUserMap = mapDailyRows(newUserRows);
  const voiceprintMap = mapDailyRows(voiceprintRows);
  const voiceGenerationMap = mapDailyRows(voiceGenerationRows);
  const inviteCodeMap = mapDailyRows(inviteCodeRows);

  return {
    range,
    items: buildDateSeries(range).map((date) => ({
      date,
      pv: pvMap.get(date) ?? 0,
      uv: uvMap.get(date) ?? 0,
      sessions: sessionMap.get(date) ?? 0,
      newUsers: newUserMap.get(date) ?? 0,
      voiceprintUsers: voiceprintMap.get(date) ?? 0,
      voiceGenerations: voiceGenerationMap.get(date) ?? 0,
      inviteCodeUsers: inviteCodeMap.get(date) ?? 0,
    })),
  };
}

export async function getAdminAnalyticsChannels(range: DateRange) {
  const [sessionRows, uvRows, pvRows, voiceGenerationRows] = await Promise.all([
    prisma.$queryRaw<ChannelCountRow[]>(Prisma.sql`
      SELECT "channel"::text AS channel, COUNT(*)::bigint AS count
      FROM "AnalyticsSession"
      ${buildRangeWhere(Prisma.sql`"startedAt"`, range)}
      GROUP BY 1
      ORDER BY 2 DESC, 1 ASC
    `),
    prisma.$queryRaw<ChannelCountRow[]>(Prisma.sql`
      SELECT "channel"::text AS channel, COUNT(DISTINCT "anonymousId")::bigint AS count
      FROM "AnalyticsSession"
      ${buildRangeWhere(Prisma.sql`"startedAt"`, range)}
      GROUP BY 1
      ORDER BY 2 DESC, 1 ASC
    `),
    prisma.$queryRaw<ChannelCountRow[]>(Prisma.sql`
      SELECT "channel"::text AS channel, COUNT(*)::bigint AS count
      FROM "AnalyticsEvent"
      WHERE "eventName" = 'PAGE_VIEW'
      ${buildRangeAnd(Prisma.sql`"occurredAt"`, range)}
      GROUP BY 1
      ORDER BY 2 DESC, 1 ASC
    `),
    prisma.$queryRaw<ChannelCountRow[]>(Prisma.sql`
      SELECT COALESCE("AnalyticsSession"."channel"::text, 'UNKNOWN') AS channel, COUNT(*)::bigint AS count
      FROM "TtsJob"
      LEFT JOIN "AnalyticsSession"
        ON "AnalyticsSession"."userId" = "TtsJob"."userId"
        AND "AnalyticsSession"."startedAt" <= "TtsJob"."createdAt"
        AND "AnalyticsSession"."endedAt" >= "TtsJob"."createdAt"
      ${buildRangeWhere(Prisma.sql`"TtsJob"."createdAt"`, range)}
      GROUP BY 1
      ORDER BY 2 DESC, 1 ASC
    `),
  ]);

  const sessionMap = new Map(sessionRows.map((row) => [row.channel, toNumber(row.count)]));
  const uvMap = new Map(uvRows.map((row) => [row.channel, toNumber(row.count)]));
  const pvMap = new Map(pvRows.map((row) => [row.channel, toNumber(row.count)]));
  const voiceGenerationMap = new Map(voiceGenerationRows.map((row) => [row.channel, toNumber(row.count)]));
  const channels = Array.from(new Set([...sessionMap.keys(), ...uvMap.keys(), ...pvMap.keys(), ...voiceGenerationMap.keys()]));

  return {
    range,
    items: channels.map((channel) => ({
      channel,
      sessions: sessionMap.get(channel) ?? 0,
      uv: uvMap.get(channel) ?? 0,
      pv: pvMap.get(channel) ?? 0,
      voiceGenerations: voiceGenerationMap.get(channel) ?? 0,
    })).sort((left, right) => right.sessions - left.sessions || right.pv - left.pv || left.channel.localeCompare(right.channel)),
  };
}
