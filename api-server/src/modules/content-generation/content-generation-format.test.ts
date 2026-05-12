import { describe, expect, test } from "bun:test";
import { ensureSectionMarkers, estimateDurationSeconds, normalizeTtsNumbers } from "./content-generation-format";

describe("content generation format", () => {
  test("normalizes TTS number edge cases", () => {
    const result = normalizeTtsNumbers("2025-01-15 发布 v1.2.3，热线 400-123-4567，累计 3999999 用户");

    expect(result.text).toContain("2025年01月15日");
    expect(result.text).toContain("v1点2点3");
    expect(result.text).toContain("四零零 一二三 四五六七");
    expect(result.text).toContain("400万");
  });

  test("completes fixed section markers", () => {
    const result = ensureSectionMarkers("[SECTION:hero]\n开头");

    expect(result.script).toContain("[SECTION:hero]");
    expect(result.script).toContain("[SECTION:outro]");
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  test("estimates zh and en duration", () => {
    expect(estimateDurationSeconds("这是一段中文脚本", "zh-CN")).toBeGreaterThan(0);
    expect(estimateDurationSeconds("this is a short english script", "en-US")).toBeGreaterThan(0);
  });
});
