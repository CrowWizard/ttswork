import { z } from "zod";

function optionalTrimmedString(maxLength: number) {
  return z.preprocess(
    (value) => (typeof value === "string" ? value.trim() || undefined : value),
    z.string().max(maxLength).optional(),
  );
}

function optionalDateSchema(fieldName: string) {
  return z.preprocess((value) => {
    if (value instanceof Date) {
      return value;
    }

    if (typeof value === "string") {
      const normalized = value.trim();

      if (!normalized) {
        return undefined;
      }

      const parsed = new Date(normalized);
      return Number.isNaN(parsed.getTime()) ? value : parsed;
    }

    return value;
  }, z.date({ invalid_type_error: `${fieldName} 格式无效` }).optional());
}

function optionalIntSchema(fieldName: string, min: number, max: number, defaultValue: number) {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === "") {
      return defaultValue;
    }

    if (typeof value === "number") {
      return value;
    }

    if (typeof value === "string") {
      return Number.parseInt(value, 10);
    }

    return value;
  }, z.number({ invalid_type_error: `${fieldName} 必须是整数` }).int(`${fieldName} 必须是整数`).min(min).max(max));
}

function optionalBooleanSchema() {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "string") {
      if (value === "true") {
        return true;
      }

      if (value === "false") {
        return false;
      }
    }

    return value;
  }, z.boolean().optional());
}

export const adminPaginationQuerySchema = z.object({
  page: optionalIntSchema("page", 1, 100000, 1),
  pageSize: optionalIntSchema("pageSize", 1, 100, 20),
});

export const adminDateRangeQuerySchema = z.object({
  startAt: optionalDateSchema("startAt"),
  endAt: optionalDateSchema("endAt"),
}).superRefine((value, ctx) => {
  if (value.startAt && value.endAt && value.startAt.getTime() > value.endAt.getTime()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "startAt 不能晚于 endAt",
      path: ["startAt"],
    });
  }
});

export const adminAnalyticsOverviewQuerySchema = adminDateRangeQuerySchema;

export const adminAnalyticsTrendQuerySchema = adminDateRangeQuerySchema;

export const adminAnalyticsChannelsQuerySchema = adminDateRangeQuerySchema;

export const adminUsersListQuerySchema = adminPaginationQuerySchema.extend({
  userId: optionalTrimmedString(64),
  phoneNumber: optionalTrimmedString(32),
  inviteCode: optionalTrimmedString(32),
  anonymousId: optionalTrimmedString(128),
});

export const adminInviteCodesListQuerySchema = adminPaginationQuerySchema.extend({
  startAt: optionalDateSchema("startAt"),
  endAt: optionalDateSchema("endAt"),
  status: z.preprocess(
    (value) => (typeof value === "string" && value.trim() ? value.trim() : "all"),
    z.enum(["all", "unused", "used"]),
  ),
  code: optionalTrimmedString(32),
}).superRefine((value, ctx) => {
  if (value.startAt && value.endAt && value.startAt.getTime() > value.endAt.getTime()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "startAt 不能晚于 endAt",
      path: ["startAt"],
    });
  }
});

export const adminInviteCodesGenerateBodySchema = z.object({
  count: optionalIntSchema("count", 1, 1000, 1),
});

export const adminVoiceGenerationsListQuerySchema = adminPaginationQuerySchema.extend({
  startAt: optionalDateSchema("startAt"),
  endAt: optionalDateSchema("endAt"),
  userId: optionalTrimmedString(64),
  phoneNumber: optionalTrimmedString(32),
  hasUsageCode: optionalBooleanSchema(),
  status: z.preprocess(
    (value) => (typeof value === "string" && value.trim() ? value.trim() : undefined),
    z.enum(["PENDING", "READY", "FAILED"]).optional(),
  ),
}).superRefine((value, ctx) => {
  if (value.startAt && value.endAt && value.startAt.getTime() > value.endAt.getTime()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "startAt 不能晚于 endAt",
      path: ["startAt"],
    });
  }
});

export type AdminPaginationQuery = z.infer<typeof adminPaginationQuerySchema>;
