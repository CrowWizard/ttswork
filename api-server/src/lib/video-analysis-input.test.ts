import { afterEach, describe, expect, test } from "bun:test";
import { parseVideoAnalysisInput, resolveVideoAnalysisInput } from "./video-analysis-input";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("video analysis input", () => {
  test("accepts BV id", () => {
    const parsed = parseVideoAnalysisInput("BV1AbCdEfG12");

    expect(parsed?.inputType).toBe("BV");
    expect(parsed?.normalizedBvid).toBe("BV1AbCdEfG12");
    expect(parsed?.normalizedUrl).toBe("https://www.bilibili.com/video/BV1AbCdEfG12");
  });

  test("extracts bilibili video url from shared text", () => {
    const parsed = parseVideoAnalysisInput("【标题】 https://www.bilibili.com/video/BV1AbCdEfG12/?spm_id_from=333.999");

    expect(parsed?.inputType).toBe("URL");
    expect(parsed?.inputValue).toBe("【标题】 https://www.bilibili.com/video/BV1AbCdEfG12/?spm_id_from=333.999");
    expect(parsed?.normalizedBvid).toBe("BV1AbCdEfG12");
  });

  test("resolves b23 short url from shared text", async () => {
    globalThis.fetch = (async () => new Response(null, {
      status: 302,
      headers: {
        location: "https://www.bilibili.com/video/BV1AbCdEfG12/?share_source=copy_web",
      },
    })) as unknown as typeof fetch;

    const parsed = await resolveVideoAnalysisInput("【68万亿化债开始了？错，是削藩开始了！化债周期谁能偷跑？-哔哩哔哩】 https://b23.tv/AQgQmZq");

    expect(parsed?.inputType).toBe("URL");
    expect(parsed?.inputValue).toBe("【68万亿化债开始了？错，是削藩开始了！化债周期谁能偷跑？-哔哩哔哩】 https://b23.tv/AQgQmZq");
    expect(parsed?.normalizedBvid).toBe("BV1AbCdEfG12");
    expect(parsed?.normalizedUrl).toBe("https://www.bilibili.com/video/BV1AbCdEfG12");
  });
});
