import { AnalyticsChannel } from "@prisma/client";

type ChannelInput = {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  referrer?: string | null;
};

const PAID_MEDIUM_KEYWORDS = ["cpc", "ppc", "paid", "display", "banner", "affiliate", "sponsored", "ads", "sem", "cpm"];
const SOCIAL_KEYWORDS = ["wechat", "weixin", "weibo", "x", "twitter", "facebook", "instagram", "tiktok", "douyin", "xiaohongshu", "reddit", "linkedin", "discord"];
const EMAIL_KEYWORDS = ["email", "mail", "newsletter", "edm"];
const ORGANIC_KEYWORDS = ["organic", "seo", "search"];
const SEARCH_ENGINES = ["google", "bing", "baidu", "sogou", "so.com", "yahoo", "yandex"];

function normalizeValue(value?: string | null) {
  return value?.trim().toLowerCase() || "";
}

function includesAnyKeyword(value: string, keywords: string[]) {
  return keywords.some((keyword) => value.includes(keyword));
}

function getReferrerHost(referrer?: string | null) {
  if (!referrer) {
    return "";
  }

  try {
    return new URL(referrer).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function classifyAnalyticsChannel(input: ChannelInput) {
  const utmMedium = normalizeValue(input.utmMedium);
  const utmSource = normalizeValue(input.utmSource);
  const referrerHost = getReferrerHost(input.referrer);

  if (utmMedium) {
    if (includesAnyKeyword(utmMedium, PAID_MEDIUM_KEYWORDS)) {
      return AnalyticsChannel.PAID;
    }

    if (includesAnyKeyword(utmMedium, SOCIAL_KEYWORDS)) {
      return AnalyticsChannel.SOCIAL;
    }

    if (includesAnyKeyword(utmMedium, EMAIL_KEYWORDS)) {
      return AnalyticsChannel.EMAIL;
    }

    if (includesAnyKeyword(utmMedium, ORGANIC_KEYWORDS)) {
      return AnalyticsChannel.ORGANIC;
    }

    return AnalyticsChannel.REFERRAL;
  }

  if (utmSource) {
    if (includesAnyKeyword(utmSource, SOCIAL_KEYWORDS)) {
      return AnalyticsChannel.SOCIAL;
    }

    if (includesAnyKeyword(utmSource, EMAIL_KEYWORDS)) {
      return AnalyticsChannel.EMAIL;
    }

    if (includesAnyKeyword(utmSource, SEARCH_ENGINES) || includesAnyKeyword(utmSource, ORGANIC_KEYWORDS)) {
      return AnalyticsChannel.ORGANIC;
    }

    return AnalyticsChannel.REFERRAL;
  }

  if (referrerHost) {
    if (includesAnyKeyword(referrerHost, SEARCH_ENGINES)) {
      return AnalyticsChannel.ORGANIC;
    }

    if (includesAnyKeyword(referrerHost, SOCIAL_KEYWORDS)) {
      return AnalyticsChannel.SOCIAL;
    }

    return AnalyticsChannel.REFERRAL;
  }

  return AnalyticsChannel.DIRECT;
}

export function buildAttributionFingerprint(input: ChannelInput) {
  return [
    normalizeValue(input.utmSource),
    normalizeValue(input.utmMedium),
    normalizeValue(input.utmCampaign),
    normalizeValue(input.referrer),
  ].join("|");
}
