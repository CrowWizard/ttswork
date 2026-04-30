import { describe, expect, test } from "bun:test";
import { generateUsageCode, isUsageCodeFormatValid } from "./usage-code";

describe("usage code", () => {
  test("generates 6 alphanumeric chars", () => {
    const code = generateUsageCode();

    expect(code).toMatch(/^[0-9A-Za-z]{6}$/);
  });

  test("validates exact user input format", () => {
    expect(isUsageCodeFormatValid("Ab12Z9")).toBe(true);
    expect(isUsageCodeFormatValid("Ab12Z")).toBe(false);
    expect(isUsageCodeFormatValid("Ab12Z99")).toBe(false);
    expect(isUsageCodeFormatValid("中文1234")).toBe(false);
  });
});
