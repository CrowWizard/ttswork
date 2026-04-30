import { z } from "zod";

function optionalTrimmedString(maxLength: number) {
  return z.preprocess(
    (value) => (typeof value === "string" ? value.trim() || undefined : value),
    z.string().max(maxLength).optional(),
  );
}

const optionalTimestampSchema = z.preprocess((value) => {
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
}, z.date().optional());

export const analyticsCollectSchema = z.object({
  anonymous_id: z.string().trim().min(1, "anonymous_id 不能为空").max(128, "anonymous_id 过长"),
  session_id: optionalTrimmedString(128),
  event_name: z.enum([
    "PAGE_VIEW",
    "REGISTER_SUCCESS",
    "VOICEPRINT_CREATED",
    "VOICE_GENERATED",
    "INVITE_CODE_USED",
  ]),
  url: z.string().trim().min(1, "url 不能为空").max(2000, "url 过长"),
  referrer: optionalTrimmedString(2000),
  utm_source: optionalTrimmedString(200),
  utm_medium: optionalTrimmedString(200),
  utm_campaign: optionalTrimmedString(200),
  user_id: optionalTrimmedString(64),
  timestamp: optionalTimestampSchema,
});

export type AnalyticsCollectInput = z.infer<typeof analyticsCollectSchema>;
