import type { AppConfig } from "../../lib/config";
import { loggerInfo } from "../../lib/logger";
import type { ResearchSource } from "./content-generation-schemas";

export async function searchRecentTopic(cfg: AppConfig["contentGeneration"], topic: string, currentYear: number) {
  const query = `${topic} 最新发展 ${currentYear}`;

  if (cfg.searchProvider === "bocha") {
    return searchBocha(query, cfg);
  }

  if (cfg.searchProvider === "aliyun") {
    return searchAliyunIqs(query, cfg);
  }

  if (cfg.searchProvider !== "duckduckgo") {
    return {
      query,
      sources: [] as ResearchSource[],
      warning: "搜索服务未启用，使用模型基于通用知识生成低置信研究摘要",
    };
  }

  return searchDuckDuckGo(query, cfg.searchTimeoutSeconds);
}

async function searchBocha(query: string, cfg: AppConfig["contentGeneration"]) {
  if (!cfg.bochaApiKey) {
    return buildDisabledSearchResult(query, "Bocha API Key 未配置，使用模型基于通用知识生成低置信研究摘要");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.searchTimeoutSeconds * 1000);

  try {
    const url = "https://api.bocha.cn/v1/web-search";
    const body = {
      query,
      count: 5,
      summary: true,
    };

    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${cfg.bochaApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Bocha search failed: ${response.status}`);
    }

    const payload = await response.json();
    const sources = parseBochaResponse(payload).slice(0, 5);
    return buildSearchResult(query, sources);
  } catch {
    return buildDisabledSearchResult(query, "Bocha 搜索失败，使用模型基于通用知识生成低置信研究摘要");
  } finally {
    clearTimeout(timer);
  }
}

async function searchAliyunIqs(query: string, cfg: AppConfig["contentGeneration"]) {
  if (!cfg.aliyunIqsApiKey) {
    return buildDisabledSearchResult(query, "阿里云 IQS API Key 未配置，使用模型基于通用知识生成低置信研究摘要");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.searchTimeoutSeconds * 1000);

  try {
    const response = await fetch("https://cloud-iqs.aliyuncs.com/search/unified", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${cfg.aliyunIqsApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        engineType: cfg.aliyunIqsEngineType,
        contents: {
          summary: false,
          rerankScore: true,
        },
        advancedParams: {
          numResults: "5",
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Aliyun IQS search failed: ${response.status}`);
    }

    const payload = await response.json();
    const sources = parseAliyunIqsResponse(payload).slice(0, 5);
    return buildSearchResult(query, sources);
  } catch {
    return buildDisabledSearchResult(query, "阿里云 IQS 搜索失败，使用模型基于通用知识生成低置信研究摘要");
  } finally {
    clearTimeout(timer);
  }
}

async function searchDuckDuckGo(query: string, timeoutSeconds: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

  try {
    const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 content-generation-worker" },
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo search failed: ${response.status}`);
    }

    const html = await response.text();
    const sources = parseDuckDuckGoHtml(html).slice(0, 5);
    return {
      query,
      sources,
      warning: sources.length >= 3 ? null : "搜索结果不足 3 条，已降级为低置信研究摘要",
    };
  } catch {
    return {
      query,
      sources: [] as ResearchSource[],
      warning: "网络搜索失败，使用模型基于通用知识生成低置信研究摘要",
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseDuckDuckGoHtml(html: string): ResearchSource[] {
  const results: ResearchSource[] = [];
  const itemPattern = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>(.*?)<\/a>/g;

  for (const match of html.matchAll(itemPattern)) {
    const title = stripHtml(match[2]);
    const snippet = stripHtml(match[3]);
    const url = decodeDuckDuckGoUrl(match[1]);

    if (title && snippet && url) {
      results.push({ title, url, snippet });
    }
  }

  return results;
}

function stripHtml(value: string) {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function parseBochaResponse(payload: unknown): ResearchSource[] {
  const value = (payload as { data?: { webPages?: { value?: unknown[] } } })?.data?.webPages?.value ?? [];

  return value.flatMap((item) => {
    const source = item as { name?: unknown; title?: unknown; url?: unknown; snippet?: unknown; summary?: unknown };
    const title = getString(source.name) || getString(source.title);
    const url = getString(source.url);
    const snippet = getString(source.summary) || getString(source.snippet);

    return title && url && snippet ? [{ title, url, snippet }] : [];
  });
}

function parseAliyunIqsResponse(payload: unknown): ResearchSource[] {
  const pageItems = (payload as { pageItems?: unknown[] })?.pageItems ?? [];

  return pageItems.flatMap((item) => {
    const source = item as { title?: unknown; link?: unknown; snippet?: unknown; summary?: unknown; mainText?: unknown };
    const title = getString(source.title);
    const url = getString(source.link);
    const snippet = getString(source.summary) || getString(source.snippet) || getString(source.mainText).slice(0, 200);

    return title && url && snippet ? [{ title, url, snippet }] : [];
  });
}

function buildSearchResult(query: string, sources: ResearchSource[]) {
  return {
    query,
    sources,
    warning: sources.length >= 3 ? null : "搜索结果不足 3 条，已降级为低置信研究摘要",
  };
}

function buildDisabledSearchResult(query: string, warning: string) {
  return {
    query,
    sources: [] as ResearchSource[],
    warning,
  };
}

function getString(value: unknown) {
  return typeof value === "string" ? stripHtml(value).trim() : "";
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function decodeDuckDuckGoUrl(value: string) {
  try {
    const url = new URL(value, "https://duckduckgo.com");
    return url.searchParams.get("uddg") ?? url.href;
  } catch {
    return value;
  }
}
