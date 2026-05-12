export const PROMPT_VERSION = "content-generation-video-script-mvp-2026-05-11";

const sectionDisplayLabels: Record<string, string> = {
  hero: "开场吸引",
  features: "核心亮点",
  demo: "场景演示",
  comparison: "对比说明",
  summary: "总结收束",
  references: "参考依据",
  outro: "结尾行动",
};

export const SYSTEM_PROMPT = [
  "你是 B站视频脚本文案生成专家，只能生成 video_script，不生成 social_post、图片提示词、发布时间建议或点数相关内容。",
  "输出必须是纯 JSON，不得包含 Markdown、解释文本或代码块。",
  "脚本必须保留并按顺序使用 [SECTION:hero]、[SECTION:features]、[SECTION:demo]、[SECTION:comparison]、[SECTION:summary]、[SECTION:references]、[SECTION:outro]。",
  "只有上下文 generateShots 为 true 时才生成镜头内容；为 false 时不要写镜头、画面、机位、转场或 B-roll 描述。",
  "CTA 必须结合主题和受众的下一步行动，不能只写点赞关注收藏。",
  "TTS 数字规则：年份、日期、带单位数字、百分比、小数、技术单位和小整数保留阿拉伯数字；ISO 日期转中文日期；多段版本号转 v一点二点三；电话分段转中文数字；无单位长整数转中文或近似万/亿。",
].join("\n");

export function buildJsonPrompt(schemaName: string, payload: unknown) {
  return [
    `SCHEMA_NAME: ${schemaName}`,
    "请严格按下面的 JSON 形状返回。只返回 JSON 对象，不要返回数组、Markdown 或解释文本。",
    getSchemaInstruction(schemaName),
    "上下文：",
    JSON.stringify(payload, null, 2),
  ].join("\n");
}

function getSchemaInstruction(schemaName: string) {
  switch (schemaName) {
    case "DIRECTION_RESEARCH":
      return `必须返回：{"direction":{"audience":"string","style":"string","scope":"string","tone":"string","duration":"short|medium|long"},"research":{"summary":["string"],"sources":[{"title":"string","url":"string","snippet":"string"}],"confidence":"low|medium|high"}}`;
    case "CATEGORY_TOPIC":
      return `必须返回：{"category":"string","topic":"string"}`;
    case "STRUCTURE":
      return `必须返回：{"title_position":"top-center","sections":[{"section":"hero|features|demo|comparison|summary|references|outro","duration_seconds":20,"density":"Impact|Standard|Compact","purpose":"string"}]}`;
    case "HOOK":
      return `必须返回：{"hook":"string"}`;
    case "CTA":
      return `必须返回：{"cta":"string"}。cta 必须围绕主题给出具体互动或行动建议，并适合放在视频结尾。`;
    case "CONTENT":
      return `必须返回：{"script":"[SECTION:hero]\\n...\\n[SECTION:features]\\n...","references":"string"}。如果上下文 generateShots 为 true，每个主要段落可包含“镜头内容：...”；如果为 false，script 只能写口播文案和必要的段落标题。`;
    default:
      return "必须返回当前步骤 schema 要求的 JSON 对象。";
  }
}

export function buildPreferencesLabel(params: {
  platform: string;
  language: string;
  tone: string;
  verbosity: string;
  generateShots: boolean;
  heroOpening: string;
  outroClosing: string;
}) {
  return `[PREFERENCES] Platform: ${params.platform} | Language: ${params.language} | Tone: ${params.tone} | Verbosity: ${params.verbosity} | GenerateShots: ${params.generateShots} | HeroOpening: ${params.heroOpening} | OutroClosing: ${params.outroClosing}`;
}

export function buildDirectionResearchLabel(params: { audience: string; style: string; scope: string; tone: string; duration: string; summary: string[] }) {
  return [
    `[DIRECTION] 受众-${params.audience} | 风格-${params.style} | 范围-${params.scope} | 语调-${params.tone} | 时长-${params.duration}`,
    `[RESEARCH] ${params.summary.map((item) => `• ${item}`).join(" ")}`,
  ].join("\n");
}

export function buildCategoryTopicLabel(params: { category: string; topic: string }) {
  return `[CATEGORY] ${params.category}\n[TOPIC] ${params.topic}`;
}

export function buildStructureLabel(sections: Array<{ section: string; duration_seconds: number; density: string }>) {
  return [
    "[STRUCTURE]",
    ...sections.map((section) => `【${sectionDisplayLabels[section.section] ?? section.section}】 ${section.duration_seconds}s, Density: ${section.density}`),
  ].join("\n");
}

export function buildHookLabel(hook: string) {
  return `[HOOK] ${hook}`;
}

export function buildCtaLabel(cta: string) {
  return `[CTA] ${cta}`;
}

export function buildContentLabel(script: string) {
  return `[CONTENT] ${formatSectionMarkersForDisplay(script)}`;
}

function formatSectionMarkersForDisplay(script: string) {
  return script.replace(/\[SECTION:([^\]]+)\]/g, (_, section: string) => `【${sectionDisplayLabels[section] ?? section}】`);
}
