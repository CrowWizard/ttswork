export type TtsScene = {
  key: string;
  label: string;
  instruction: string;
};

const TTS_SCENES: TtsScene[] = [
  {
    key: "customer_service",
    label: "客服讲解",
    instruction: "语气温和专业，语速中等偏慢，表达要清晰耐心，像经验丰富的客服人员。",
  },
  {
    key: "live_stream",
    label: "直播带播",
    instruction: "语气热情有感染力，节奏明快，重点词适度重读，像直播间口播一样自然。",
  },
];

export function listTtsScenes() {
  return TTS_SCENES;
}

export function getTtsScene(sceneKey: string | null | undefined) {
  if (!sceneKey) {
    return null;
  }

  return TTS_SCENES.find((item) => item.key === sceneKey) ?? null;
}
