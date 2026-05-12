import { densityBySection, finalOutputSchema, sectionNames, type ContentResult, type FinalOutput, type Structure } from "./content-generation-schemas";

const durationBounds = {
  short: { min: 60, max: 120 },
  medium: { min: 180, max: 300 },
  long: { min: 420, max: 720 },
} as const;

export function normalizeTtsNumbers(input: string) {
  const warnings: string[] = [];
  let output = input.replace(/\b(20\d{2})-(0?[1-9]|1[0-2])-(0?[1-9]|[12]\d|3[01])\b/g, "$1年$2月$3日");
  output = output.replace(/\bv(\d+(?:\.\d+){2,})\b/gi, (_, value: string) => `v${value.replace(/\./g, "点")}`);
  output = output.replace(/\b(\d{3})-(\d{3})-(\d{4})\b/g, (_, a: string, b: string, c: string) => `${spellDigits(a)} ${spellDigits(b)} ${spellDigits(c)}`);
  output = output.replace(/\b(\d{7,})\b/g, (raw) => {
    const value = Number(raw);
    if (!Number.isSafeInteger(value)) {
      warnings.push(`长整数 ${raw} 无法安全转换，已保留原文`);
      return raw;
    }
    if (value >= 10000) {
      return `${Math.round(value / 10000)}万`;
    }
    return raw;
  });

  return { text: output, warnings };
}

function spellDigits(value: string) {
  const dict: Record<string, string> = {
    "0": "零",
    "1": "一",
    "2": "二",
    "3": "三",
    "4": "四",
    "5": "五",
    "6": "六",
    "7": "七",
    "8": "八",
    "9": "九",
  };
  return value.split("").map((char) => dict[char] ?? char).join("");
}

export function ensureSectionMarkers(script: string) {
  const warnings: string[] = [];
  let normalized = script.trim();

  for (const section of sectionNames) {
    const marker = `[SECTION:${section}]`;
    if (!normalized.includes(marker)) {
      normalized += `\n${marker}\n`;
      warnings.push(`缺少 ${marker} 标记，已自动补全为空段`);
    }
  }

  const orderedBlocks = sectionNames.map((section) => {
    const marker = `[SECTION:${section}]`;
    const start = normalized.indexOf(marker);
    const nextStarts = sectionNames
      .map((nextSection) => normalized.indexOf(`[SECTION:${nextSection}]`))
      .filter((index) => index > start)
      .sort((a, b) => a - b);
    const end = nextStarts[0] ?? normalized.length;
    return normalized.slice(start, end).trim();
  });

  return { script: orderedBlocks.join("\n"), warnings };
}

export function estimateDurationSeconds(script: string, language: "zh-CN" | "en-US") {
  if (language === "en-US") {
    const wordCount = script.trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(wordCount / 13));
  }

  const visibleCharacters = script.replace(/\[SECTION:[^\]]+\]/g, "").replace(/\s/g, "").length;
  return Math.max(1, Math.round(visibleCharacters / 4.5));
}

export function buildFinalOutput(params: {
  topic: string;
  platform: string;
  language: "zh-CN" | "en-US";
  duration: "short" | "medium" | "long";
  structure: Structure;
  hook: string;
  content: ContentResult;
  generateShots: boolean;
  warnings: string[];
  progressLog: FinalOutput["progress_log"];
}) {
  const sectionResult = ensureSectionMarkers(params.content.script);
  const ttsResult = normalizeTtsNumbers(sectionResult.script);
  const estimatedDurationSec = estimateDurationSeconds(ttsResult.text, params.language);
  const bounds = durationBounds[params.duration];
  const warnings = [...params.warnings, ...sectionResult.warnings, ...ttsResult.warnings];

  if (estimatedDurationSec < bounds.min) {
    warnings.push(`估算时长 ${estimatedDurationSec}s 低于 ${params.duration} 下限 ${bounds.min}s`);
  }
  if (estimatedDurationSec > bounds.max) {
    warnings.push(`估算时长 ${estimatedDurationSec}s 高于 ${params.duration} 上限 ${bounds.max}s`);
  }

  const sections = sectionNames.map((name) => {
    const matched = params.structure.sections.find((section) => section.section === name);
    return {
      name,
      density: matched?.density ?? densityBySection[name],
      durationSec: matched?.duration_seconds ?? 0,
    };
  });

  const finalOutput = {
    status: "completed",
    metadata: {
      topic: params.topic,
      platform: params.platform,
      language: params.language,
      estimatedDurationSec,
      generateShots: params.generateShots,
      sections,
    },
    script: ttsResult.text,
    hook: params.hook,
    references: params.content.references,
    warnings: [...new Set(warnings)],
    progress_log: params.progressLog,
  } satisfies FinalOutput;

  return finalOutputSchema.parse(finalOutput);
}
