import { z } from "zod";

export const sectionNames = ["hero", "features", "demo", "comparison", "summary", "references", "outro"] as const;
export const sectionNameSchema = z.enum(sectionNames);

export const densityBySection: Record<(typeof sectionNames)[number], "Impact" | "Standard" | "Compact"> = {
  hero: "Impact",
  features: "Standard",
  demo: "Standard",
  comparison: "Compact",
  summary: "Impact",
  references: "Standard",
  outro: "Impact",
};

export const preferencesSchema = z.object({
  platform: z.string(),
  language: z.enum(["zh-CN", "en-US"]),
  tone: z.enum(["personal", "company", "professional-casual"]),
  verbosity: z.enum(["concise", "detailed"]),
  generateShots: z.boolean(),
  heroOpening: z.string(),
  outroClosing: z.string(),
});

export const directionSchema = z.object({
  audience: z.string().min(1),
  style: z.string().min(1),
  scope: z.string().min(1),
  tone: z.string().min(1),
  duration: z.enum(["short", "medium", "long"]),
});

export const researchSourceSchema = z.object({
  title: z.string().min(1),
  url: z.string().min(1),
  snippet: z.string().min(1),
});

export const researchSchema = z.object({
  summary: z.array(z.string().min(1)).min(1),
  sources: z.array(researchSourceSchema),
  confidence: z.enum(["low", "medium", "high"]),
});

export const directionResearchSchema = z.object({
  direction: directionSchema,
  research: researchSchema,
});

export const categoryTopicSchema = z.object({
  category: z.string().min(1),
  topic: z.string().min(1),
});

export const structureSectionSchema = z.object({
  section: sectionNameSchema,
  duration_seconds: z.number().int().min(0),
  density: z.enum(["Impact", "Standard", "Compact"]),
  purpose: z.string().min(1),
});

export const structureSchema = z.object({
  title_position: z.string().min(1),
  sections: z.array(structureSectionSchema).length(sectionNames.length),
});

export const hookSchema = z.object({
  hook: z.string().min(1),
});

export const ctaSchema = z.object({
  cta: z.string().min(1),
});

export const contentSchema = z.object({
  script: z.string().min(1),
  references: z.string().min(1),
});

export const finalOutputSchema = z.object({
  status: z.enum(["completed", "failed"]),
  metadata: z.object({
    topic: z.string().min(1),
    platform: z.string().min(1),
    language: z.enum(["zh-CN", "en-US"]),
    estimatedDurationSec: z.number().int().min(0),
    generateShots: z.boolean(),
    sections: z.array(z.object({
      name: sectionNameSchema,
      density: z.enum(["Impact", "Standard", "Compact"]),
      durationSec: z.number().int().min(0),
    })).length(sectionNames.length),
  }),
  script: z.string(),
  hook: z.string(),
  references: z.string().default(""),
  warnings: z.array(z.string()),
  progress_log: z.array(z.object({
    step: z.string().min(1),
    ts: z.number().int(),
    message: z.string().min(1),
  })),
}).strict();

export type Preferences = z.infer<typeof preferencesSchema>;
export type DirectionResearch = z.infer<typeof directionResearchSchema>;
export type CategoryTopic = z.infer<typeof categoryTopicSchema>;
export type Structure = z.infer<typeof structureSchema>;
export type HookResult = z.infer<typeof hookSchema>;
export type CtaResult = z.infer<typeof ctaSchema>;
export type ContentResult = z.infer<typeof contentSchema>;
export type FinalOutput = z.infer<typeof finalOutputSchema>;
export type ResearchSource = z.infer<typeof researchSourceSchema>;
