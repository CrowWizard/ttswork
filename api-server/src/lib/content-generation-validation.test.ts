import { describe, expect, test } from "bun:test";
import { contentGenerationJobCreateSchema } from "./validation";

describe("content generation validation", () => {
  test("applies video script defaults", () => {
    const parsed = contentGenerationJobCreateSchema.parse({ topic: "AI 工具" });

    expect(parsed).toEqual({
      topic: "AI 工具",
      type: "video_script",
      tone: "personal",
      verbosity: "concise",
      duration: "short",
      generateShots: true,
    });
  });

  test("accepts generateShots option", () => {
    const parsed = contentGenerationJobCreateSchema.parse({ topic: "AI 工具", generateShots: false });

    expect(parsed.generateShots).toBe(false);
  });

  test("rejects non video script type", () => {
    const parsed = contentGenerationJobCreateSchema.safeParse({ topic: "AI 工具", type: "social_post" });

    expect(parsed.success).toBe(false);
  });

  test("rejects excluded MVP fields", () => {
    expect(contentGenerationJobCreateSchema.safeParse({ topic: "AI 工具", format: "thread" }).success).toBe(false);
    expect(contentGenerationJobCreateSchema.safeParse({ topic: "AI 工具", isPicture: true }).success).toBe(false);
  });

  test("rejects empty topic and removed presets", () => {
    expect(contentGenerationJobCreateSchema.safeParse({ topic: "" }).success).toBe(false);
    expect(contentGenerationJobCreateSchema.safeParse({ topic: "AI 工具", platform: "youtube" }).success).toBe(false);
    expect(contentGenerationJobCreateSchema.safeParse({ topic: "AI 工具", language: "en-US" }).success).toBe(false);
    expect(contentGenerationJobCreateSchema.safeParse({ topic: "AI 工具", heroOpening: "开头" }).success).toBe(false);
    expect(contentGenerationJobCreateSchema.safeParse({ topic: "AI 工具", outroClosing: "结尾" }).success).toBe(false);
  });
});
