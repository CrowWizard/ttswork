import type { VideoInputType } from "@prisma/client";

const BV_PATTERN = /^BV[0-9A-Za-z]{10}$/;
const BV_IN_TEXT_PATTERN = /\b(BV[0-9A-Za-z]{10})\b/;
const URL_IN_TEXT_PATTERN = /https?:\/\/[^\s\]】)>"']+/i;
const BILIBILI_HOSTS = new Set(["www.bilibili.com", "m.bilibili.com", "bilibili.com"]);
const BILIBILI_SHORT_HOSTS = new Set(["b23.tv"]);
const REDIRECT_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 5;

export type ParsedVideoAnalysisInput = {
  inputType: VideoInputType;
  inputValue: string;
  normalizedBvid: string;
  normalizedUrl: string | null;
};

export async function resolveVideoAnalysisInput(rawInput: string): Promise<ParsedVideoAnalysisInput | null> {
  const directParsed = parseVideoAnalysisInput(rawInput);

  if (directParsed) {
    return directParsed;
  }

  const extractedUrl = extractFirstUrl(rawInput);

  if (!extractedUrl || !isBilibiliShortUrl(extractedUrl)) {
    return null;
  }

  const resolvedUrl = await resolveRedirectUrl(extractedUrl);

  if (!resolvedUrl) {
    return null;
  }

  return parseVideoAnalysisInput(resolvedUrl, rawInput.trim());
}

export function parseVideoAnalysisInput(rawInput: string, inputValueOverride?: string): ParsedVideoAnalysisInput | null {
  const inputValue = rawInput.trim();

  if (BV_PATTERN.test(inputValue)) {
    return buildParsedInput("BV", inputValueOverride ?? inputValue, inputValue);
  }

  const url = parseDirectUrl(inputValue);

  if (url) {
    return parseBilibiliUrl(url, inputValueOverride ?? inputValue);
  }

  const extractedUrl = extractFirstUrl(inputValue);

  if (extractedUrl) {
    const extractedParsed = parseDirectUrl(extractedUrl);

    if (extractedParsed && !isBilibiliShortParsedUrl(extractedParsed)) {
      return parseBilibiliUrl(extractedParsed, inputValueOverride ?? inputValue);
    }
  }

  const bvidInText = inputValue.match(BV_IN_TEXT_PATTERN)?.[1];

  if (bvidInText) {
    return buildParsedInput("BV", inputValueOverride ?? inputValue, bvidInText);
  }

  return null;
}

function buildParsedInput(inputType: VideoInputType, inputValue: string, normalizedBvid: string): ParsedVideoAnalysisInput {
  return {
    inputType,
    inputValue,
    normalizedBvid,
    normalizedUrl: `https://www.bilibili.com/video/${normalizedBvid}`,
  };
}

function parseBilibiliUrl(url: URL, inputValue: string): ParsedVideoAnalysisInput | null {
  if (!BILIBILI_HOSTS.has(url.hostname.toLowerCase())) {
    return null;
  }

  const match = url.pathname.match(/\/video\/(BV[0-9A-Za-z]{10})(?:\/|$)/);

  if (!match) {
    return null;
  }

  return buildParsedInput("URL", inputValue, match[1]);
}

function extractFirstUrl(inputValue: string): string | null {
  const rawUrl = inputValue.match(URL_IN_TEXT_PATTERN)?.[0];

  if (!rawUrl) {
    return null;
  }

  return rawUrl.replace(/[，。；、,.!?！？]+$/u, "");
}

function parseDirectUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isBilibiliShortUrl(value: string): boolean {
  const url = parseDirectUrl(value);

  return url ? isBilibiliShortParsedUrl(url) : false;
}

function isBilibiliShortParsedUrl(url: URL): boolean {
  return BILIBILI_SHORT_HOSTS.has(url.hostname.toLowerCase());
}

async function resolveRedirectUrl(initialUrl: string): Promise<string | null> {
  let currentUrl = initialUrl;

  for (let redirectCount = 0; redirectCount < MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetch(currentUrl, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(REDIRECT_TIMEOUT_MS),
    }).catch(() => null);

    if (!response) {
      return null;
    }

    const location = response.headers.get("location");

    if (!location) {
      return response.url || currentUrl;
    }

    currentUrl = new URL(location, currentUrl).toString();

    if (parseVideoAnalysisInput(currentUrl)) {
      return currentUrl;
    }
  }

  return null;
}
