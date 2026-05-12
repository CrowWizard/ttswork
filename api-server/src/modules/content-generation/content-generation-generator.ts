import type { z } from "zod";
import { Agent } from "@mastra/core/agent";
import { createOpenAI } from "@ai-sdk/openai";
import type { AppConfig } from "../../lib/config";
import { buildErrorLogContext, loggerError } from "../../lib/logger";
import { buildJsonPrompt, SYSTEM_PROMPT } from "./content-generation-prompts";

function buildMockJson(schemaName: string, payload?: unknown) {
  const generateShots = hasGenerateShotsEnabled(payload);
  const sections = [
    { section: "hero", duration_seconds: 15, density: "Impact", purpose: "用具体反差建立观看理由" },
    { section: "features", duration_seconds: 20, density: "Standard", purpose: "解释核心亮点" },
    { section: "demo", duration_seconds: 20, density: "Standard", purpose: "展示使用场景" },
    { section: "comparison", duration_seconds: 10, density: "Compact", purpose: "对比旧做法" },
    { section: "summary", duration_seconds: 10, density: "Impact", purpose: "收束结论" },
    { section: "references", duration_seconds: 5, density: "Standard", purpose: "说明信息来源" },
    { section: "outro", duration_seconds: 10, density: "Impact", purpose: "引导互动" },
  ];

  switch (schemaName) {
    case "DIRECTION_RESEARCH":
      return {
        direction: { audience: "内容创作者", style: "信息清晰、节奏紧凑", scope: "MVP 可落地脚本", tone: "personal", duration: "short" },
        research: {
          summary: ["近期讨论集中在效率提升", "用户更关注可验证结果", "短视频更适合用场景化示例解释"],
          sources: [],
          confidence: "medium",
        },
      };
    case "CATEGORY_TOPIC":
      return { category: "科技", topic: "AI 创作工具的实用场景" };
    case "STRUCTURE":
      return { title_position: "top-center", sections };
    case "HOOK":
      return { hook: "如果一个创作工具只能帮你省下一步，那它还不够好。真正有价值的是把想法变成能发布的内容。" };
    case "CTA":
      return { cta: "如果你也想把 AI 创作工具用到自己的短视频流程里，评论区留下你的选题，我用下一期拆一个真实案例。" };
    case "CONTENT":
      return {
        script: sections.map((item) => {
          const shot = generateShots ? `\n镜头内容：展示和“${item.purpose}”相关的真实操作画面。` : "";
          return `[SECTION:${item.section}]\n${item.purpose}，用口语化表达把观点讲清楚。${shot}`;
        }).join("\n"),
        references: "基于任务输入、结构化研究摘要和通用行业知识生成。",
      };
    default:
      return { ok: true };
  }
}

function hasGenerateShotsEnabled(payload: unknown) {
  if (!payload || typeof payload !== "object") return true;
  const value = (payload as { generateShots?: unknown; preferences?: { generateShots?: unknown } }).generateShots
    ?? (payload as { preferences?: { generateShots?: unknown } }).preferences?.generateShots;

  return typeof value === "boolean" ? value : true;
}

function createContentGenerationAgent(cfg: AppConfig) {
  const openai = createOpenAI({
    apiKey: cfg.qwen.apiKey,
    baseURL: normalizeOpenAICompatibleBaseUrl(cfg.qwen.chatCompletionUrl),
  });

  return new Agent({
    id: "content-generation-agent",
    name: "Content Generation Agent",
    instructions: SYSTEM_PROMPT,
    model: openai.chat(cfg.contentGeneration.llmModel),
  });
}

function normalizeOpenAICompatibleBaseUrl(value: string) {
  return value.replace(/\/chat\/completions\/?$/, "").replace(/\/responses\/?$/, "").replace(/\/$/, "");
}

export async function generateContentGenerationJson<T extends object>(params: {
  cfg: AppConfig;
  schemaName: string;
  payload: unknown;
  schema: z.ZodSchema<T>;
  temperature?: number;
}) {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = params.cfg.qwen.mockMode
        ? buildMockJson(params.schemaName, params.payload)
        : (await createContentGenerationAgent(params.cfg).generate(
          [{ role: "user", content: buildJsonPrompt(params.schemaName, params.payload) }],
          {
            structuredOutput: { schema: params.schema as z.ZodSchema<object> },
          },
        )).object;
      const parsed = params.schema.safeParse(raw);

      if (parsed.success) {
        return parsed.data;
      }

      lastError = parsed.error;
      loggerError("content_generation.llm.validation_failed", {
        schemaName: params.schemaName,
        attempt,
        issues: parsed.error.issues.slice(0, 3),
        rawPreview: JSON.stringify(raw).slice(0, 500),
      });
    } catch (error) {
      lastError = error;
      loggerError("content_generation.llm.call_failed", {
        schemaName: params.schemaName,
        attempt,
        ...buildErrorLogContext(error),
      });
    }
  }

  throw lastError instanceof Error ? lastError : new Error("内容生成模型输出校验失败");
}
