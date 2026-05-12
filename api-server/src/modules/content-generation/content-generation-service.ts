import { ContentGenerationStage, VideoAnalysisStageEventStatus } from "@prisma/client";
import { Mastra } from "@mastra/core/mastra";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import type { AppConfig } from "../../lib/config";
import { buildErrorLogContext, loggerError, loggerInfo } from "../../lib/logger";
import {
  finishContentGenerationStage,
  loadContentGenerationProgressLog,
  markContentGenerationFailed,
  markContentGenerationReady,
  startContentGenerationStage,
  writeContentGenerationPartial,
  type ContentGenerationWorkerJob,
} from "./content-generation-repository";
import { generateContentGenerationJson } from "./content-generation-generator";
import { searchRecentTopic } from "./content-generation-search";
import {
  categoryTopicSchema,
  ctaSchema,
  directionResearchSchema,
  hookSchema,
  preferencesSchema,
  structureSchema,
  contentSchema,
  type FinalOutput,
  type Preferences,
} from "./content-generation-schemas";
import {
  buildCategoryTopicLabel,
  buildContentLabel,
  buildCtaLabel,
  buildDirectionResearchLabel,
  buildHookLabel,
  buildPreferencesLabel,
  buildStructureLabel,
  PROMPT_VERSION,
} from "./content-generation-prompts";
import { buildFinalOutput } from "./content-generation-format";

type ContentGenerationWorkflowState = {
  cfg: AppConfig;
  job: ContentGenerationWorkerJob;
  warnings: string[];
  preferences?: Preferences;
  search?: Awaited<ReturnType<typeof searchRecentTopic>>;
  directionResearch?: Awaited<ReturnType<typeof directionResearchSchema.parse>>;
  categoryTopic?: Awaited<ReturnType<typeof categoryTopicSchema.parse>>;
  structure?: Awaited<ReturnType<typeof structureSchema.parse>>;
  hook?: Awaited<ReturnType<typeof hookSchema.parse>>;
  cta?: Awaited<ReturnType<typeof ctaSchema.parse>>;
  content?: Awaited<ReturnType<typeof contentSchema.parse>>;
  finalOutput?: FinalOutput;
};

const workflowStateSchema = z.custom<ContentGenerationWorkflowState>();

const platformLabels = {
  BILIBILI: "bilibili",
  YOUTUBE: "youtube",
  XIAOHONGSHU: "xiaohongshu",
  DOUYIN: "douyin",
  WEIXIN_CHANNELS: "weixin-channels",
  TWITTER: "twitter",
} as const;

const languageLabels = {
  ZH_CN: "zh-CN",
  EN_US: "en-US",
} as const;

const toneLabels = {
  PERSONAL: "personal",
  COMPANY: "company",
  PROFESSIONAL_CASUAL: "professional-casual",
} as const;

const verbosityLabels = {
  CONCISE: "concise",
  DETAILED: "detailed",
} as const;

const durationLabels = {
  SHORT: "short",
  MEDIUM: "medium",
  LONG: "long",
} as const;

const defaultCta: Record<string, Record<string, string>> = {
  bilibili: { "zh-CN": "一键三连！评论区留言，下期再见！", "en-US": "Like, coin, and favorite! Leave a comment, see you next time!" },
  youtube: { "zh-CN": "点赞订阅转发！评论区留言，下期再见！", "en-US": "Like, subscribe, and share! Leave a comment, see you next time!" },
  xiaohongshu: { "zh-CN": "点赞收藏加关注，评论区见！", "en-US": "Like, save & follow! See you in comments!" },
  douyin: { "zh-CN": "点赞关注，评论区见！", "en-US": "Like & follow! See you in comments!" },
  "weixin-channels": { "zh-CN": "点赞关注，转发给朋友！", "en-US": "Like, follow & share with friends!" },
  twitter: { "zh-CN": "转发+关注，获取更多干货！", "en-US": "Retweet & follow for more insights!" },
};

export async function processContentGenerationJob(cfg: AppConfig, job: ContentGenerationWorkerJob) {
  try {
    loggerInfo("content_generation.worker.job.start", { jobId: job.id, userId: job.userId });
    const mastra = new Mastra({ workflows: { contentGenerationWorkflow: createContentGenerationWorkflow() } });
    const workflow = mastra.getWorkflow("contentGenerationWorkflow");
    const run = await workflow.createRun();
    const result = await run.start({ inputData: { cfg, job, warnings: [] } });

    if (result.status !== "success") {
      throw new Error("Mastra 内容生成 workflow 执行失败");
    }
  } catch (error) {
    loggerError("content_generation.worker.job.failed", { jobId: job.id, ...buildErrorLogContext(error) });
    const message = error instanceof Error ? error.message : "内容生成失败";
    await markContentGenerationFailed(job.id, message);
  }
}

function createContentGenerationWorkflow() {
  const preferencesStep = createStep({
    id: "content-generation-preferences",
    inputSchema: workflowStateSchema,
    outputSchema: workflowStateSchema,
    execute: async ({ inputData }) => {
      const { job } = inputData;
      const preferences = await runStage(job.id, ContentGenerationStage.PREFERENCES, "[PREFERENCES]", "已加载用户偏好", async () => {
        const platform = platformLabels[job.platform];
        const language = languageLabels[job.language];
        const parsed = preferencesSchema.parse({
          platform,
          language,
          tone: toneLabels[job.tone],
          verbosity: verbosityLabels[job.verbosity],
          generateShots: job.generateShots,
          heroOpening: job.heroOpening ?? "",
          outroClosing: job.outroClosing ?? "",
        });
        return { result: parsed, label: buildPreferencesLabel(parsed), details: parsed };
      });

      return { ...inputData, preferences };
    },
  });

  const directionResearchStep = createStep({
    id: "content-generation-direction-research",
    inputSchema: workflowStateSchema,
    outputSchema: workflowStateSchema,
    execute: async ({ inputData }) => {
      const { cfg, job, preferences } = requireWorkflowState(inputData, ["preferences"]);
      const search = await searchRecentTopic(cfg.contentGeneration, job.topicInput, new Date().getFullYear());
      const warnings = search.warning ? [...inputData.warnings, search.warning] : inputData.warnings;
      const directionResearch = await runStage(job.id, ContentGenerationStage.DIRECTION_RESEARCH, "[DIRECTION] [RESEARCH]", "正在定义方向并整理研究要点", async () => {
        const result = await generateContentGenerationJson({
          cfg,
          schemaName: "DIRECTION_RESEARCH",
          schema: directionResearchSchema,
          payload: { topic: job.topicInput, preferences, search },
        });
        if (search.sources.length >= 3) {
          result.research.sources = search.sources.slice(0, 5);
          result.research.confidence = "high";
        } else if (search.warning) {
          result.research.confidence = "low";
        }
        return {
          result,
          label: buildDirectionResearchLabel({ ...result.direction, summary: result.research.summary }),
          details: { ...result, searchQuery: search.query },
        };
      });
      await writeContentGenerationPartial(job.id, {
        directionJson: JSON.stringify(directionResearch.direction),
        researchSummary: directionResearch.research.summary.join("\n"),
      });

      return { ...inputData, warnings, search, directionResearch };
    },
  });

  const categoryTopicStep = createStep({
    id: "content-generation-category-topic",
    inputSchema: workflowStateSchema,
    outputSchema: workflowStateSchema,
    execute: async ({ inputData }) => {
      const { cfg, job, directionResearch } = requireWorkflowState(inputData, ["directionResearch"]);
      const categoryTopic = await runStage(job.id, ContentGenerationStage.CATEGORY_MATCH, "[CATEGORY] [TOPIC]", "已完成分类和主题匹配", async () => {
        const result = await generateContentGenerationJson({
          cfg,
          schemaName: "CATEGORY_TOPIC",
          schema: categoryTopicSchema,
          payload: { topic: job.topicInput, directionResearch },
        });
        return { result, label: buildCategoryTopicLabel(result), details: result };
      });
      await writeContentGenerationPartial(job.id, { category: categoryTopic.category, matchedTopic: categoryTopic.topic });

      return { ...inputData, categoryTopic };
    },
  });

  const structureStep = createStep({
    id: "content-generation-structure",
    inputSchema: workflowStateSchema,
    outputSchema: workflowStateSchema,
    execute: async ({ inputData }) => {
      const { cfg, job, preferences, directionResearch, categoryTopic } = requireWorkflowState(inputData, ["preferences", "directionResearch", "categoryTopic"]);
      const structure = await runStage(job.id, ContentGenerationStage.STRUCTURE_DESIGN, "[STRUCTURE]", "已生成固定 Section 内容结构", async () => {
        const result = await generateContentGenerationJson({
          cfg,
          schemaName: "STRUCTURE",
          schema: structureSchema,
          payload: { topic: job.topicInput, preferences, directionResearch, categoryTopic },
        });
        return { result, label: buildStructureLabel(result.sections), details: result };
      });
      await writeContentGenerationPartial(job.id, { structureJson: JSON.stringify(structure) });

      return { ...inputData, structure };
    },
  });

  const hookStep = createStep({
    id: "content-generation-hook",
    inputSchema: workflowStateSchema,
    outputSchema: workflowStateSchema,
    execute: async ({ inputData }) => {
      const { cfg, job, preferences, directionResearch, categoryTopic, structure } = requireWorkflowState(inputData, ["preferences", "directionResearch", "categoryTopic", "structure"]);
      const hook = await runStage(job.id, ContentGenerationStage.HOOK_GENERATION, "[HOOK]", "已生成视频开头 hook", async () => {
        const result = await generateContentGenerationJson({
          cfg,
          schemaName: "HOOK",
          schema: hookSchema,
          payload: { topic: job.topicInput, preferences, directionResearch, categoryTopic, structure },
        });
        const finalHook = preferences.heroOpening || result.hook;
        return { result: { hook: finalHook }, label: buildHookLabel(finalHook), details: { hook: finalHook } };
      });
      await writeContentGenerationPartial(job.id, { hook: hook.hook });

      return { ...inputData, hook };
    },
  });

  const contentStep = createStep({
    id: "content-generation-content",
    inputSchema: workflowStateSchema,
    outputSchema: workflowStateSchema,
    execute: async ({ inputData }) => {
      const { cfg, job, preferences, directionResearch, categoryTopic, structure, hook } = requireWorkflowState(inputData, ["preferences", "directionResearch", "categoryTopic", "structure", "hook"]);
      const content = await runStage(job.id, ContentGenerationStage.CONTENT_GENERATION, "[CONTENT]", "已生成完整视频脚本", async () => {
        const cta = preferences.outroClosing || (await generateContentGenerationJson({
          cfg,
          schemaName: "CTA",
          schema: ctaSchema,
          payload: { topic: job.topicInput, preferences, directionResearch, categoryTopic, structure, hook },
          temperature: 0.7,
        })).cta || defaultCta[preferences.platform]?.[preferences.language] || "关注我，评论区聊聊你的下一步计划。";
        const result = await generateContentGenerationJson({
          cfg,
          schemaName: "CONTENT",
          schema: contentSchema,
          payload: { topic: job.topicInput, preferences, directionResearch, categoryTopic, structure, hook, cta, generateShots: job.generateShots },
          temperature: 0.6,
        });
        const script = applyOpeningAndClosing(result.script, hook.hook, cta);
        return {
          result: { ...result, script },
          label: [buildCtaLabel(cta), buildContentLabel(script)].join("\n"),
          details: { ...result, cta, generateShots: job.generateShots, script },
        };
      });
      await writeContentGenerationPartial(job.id, { contentJson: JSON.stringify(content) });

      return { ...inputData, content };
    },
  });

  const formatStep = createStep({
    id: "content-generation-format",
    inputSchema: workflowStateSchema,
    outputSchema: workflowStateSchema,
    execute: async ({ inputData }) => {
      const { job, preferences, structure, hook, content } = requireWorkflowState(inputData, ["preferences", "structure", "hook", "content"]);
      const finalOutput = await runStage(job.id, ContentGenerationStage.FORMAT_VALIDATE, "[OUTPUT]", "已校验并组装最终结果", async () => {
        const progressLog = await loadContentGenerationProgressLog(job.id);
        const result = buildFinalOutput({
          topic: job.topicInput,
          platform: preferences.platform,
          language: preferences.language,
          duration: durationLabels[job.duration],
          structure,
          hook: hook.hook,
          content,
          generateShots: job.generateShots,
          warnings: inputData.warnings,
          progressLog,
        });
        return { result, label: "[OUTPUT] completed", details: result };
      });

      return { ...inputData, finalOutput };
    },
  });

  const writebackStep = createStep({
    id: "content-generation-writeback",
    inputSchema: workflowStateSchema,
    outputSchema: workflowStateSchema,
    execute: async ({ inputData }) => {
      const { cfg, job, finalOutput } = requireWorkflowState(inputData, ["finalOutput"]);
      await runStage(job.id, ContentGenerationStage.RESULT_WRITEBACK, "[OUTPUT]", "内容生成结果已写回", async () => {
        const progressLog = [...finalOutput.progress_log, { step: "result_writeback", ts: Date.now(), message: "内容生成结果已写回" }];
        const finalJson: FinalOutput = { ...finalOutput, progress_log: progressLog };
        await markContentGenerationReady(job.id, {
          finalJson: JSON.stringify(finalJson),
          metadataJson: JSON.stringify(finalJson.metadata),
          progressLogJson: JSON.stringify(progressLog),
          modelName: cfg.contentGeneration.llmModel,
          promptVersion: PROMPT_VERSION,
        });
        return { result: finalJson, label: "[OUTPUT] ready", details: { status: finalJson.status } };
      });

      return inputData;
    },
  });

  return createWorkflow({
    id: "content-generation-workflow",
    inputSchema: workflowStateSchema,
    outputSchema: workflowStateSchema,
  })
    .then(preferencesStep)
    .then(directionResearchStep)
    .then(categoryTopicStep)
    .then(structureStep)
    .then(hookStep)
    .then(contentStep)
    .then(formatStep)
    .then(writebackStep)
    .commit();
}

function requireWorkflowState<K extends keyof ContentGenerationWorkflowState>(
  state: ContentGenerationWorkflowState,
  keys: K[],
): ContentGenerationWorkflowState & Required<Pick<ContentGenerationWorkflowState, K>> {
  for (const key of keys) {
    if (state[key] === undefined || state[key] === null) {
      throw new Error(`Mastra workflow state missing ${String(key)}`);
    }
  }

  return state as ContentGenerationWorkflowState & Required<Pick<ContentGenerationWorkflowState, K>>;
}

async function runStage<T>(
  jobId: string,
  stage: ContentGenerationStage,
  label: string,
  message: string,
  fn: () => Promise<{ result: T; label: string; details?: unknown }>,
) {
  const event = await startContentGenerationStage({ jobId, stage, label, message });

  try {
    const output = await fn();
    await finishContentGenerationStage({
      jobId,
      eventId: event.id,
      stage,
      status: VideoAnalysisStageEventStatus.SUCCEEDED,
      message,
      details: { label: output.label, payload: output.details ?? output.result },
    });
    return output.result;
  } catch (error) {
    await finishContentGenerationStage({
      jobId,
      eventId: event.id,
      stage,
      status: VideoAnalysisStageEventStatus.FAILED,
      message: error instanceof Error ? error.message : `${message}失败`,
    });
    throw error;
  }
}

function applyOpeningAndClosing(script: string, hook: string, cta: string) {
  const heroMarker = "[SECTION:hero]";
  const outroMarker = "[SECTION:outro]";
  let result = script;

  if (result.includes(heroMarker) && !result.includes(`${heroMarker}\n${hook}`)) {
    result = result.replace(heroMarker, `${heroMarker}\n${hook}`);
  }

  if (cta && result.includes(outroMarker) && !result.includes(cta)) {
    result = result.replace(outroMarker, `${outroMarker}\n${cta}`);
  }

  return result;
}
