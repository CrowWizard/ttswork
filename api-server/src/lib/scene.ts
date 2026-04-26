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
    label: "直播",
    instruction: "语气热情有感染力，节奏明快，重点词适度重读，像直播间口播一样自然。",
  },
  {
    key: "triumphant_celebration",
    label: "庆祝演讲",
    instruction: "请用非常激昂且高亢的语气说话，表现出获得重大成功后的狂喜与激动。",
  },
  {
    key: "graceful_reassurance",
    label: "品牌旁白",
    instruction: "语速请保持中等偏慢，语气要显得优雅、知性，给人以从容不迫的安心感。",
  },
  {
    key: "sorrowful_memory",
    label: "旧物追忆",
    instruction: "语气要充满哀伤与怀念，带有轻微的鼻音，仿佛正在诉说一段令人心碎的往事。",
  },
  {
    key: "whispered_secret",
    label: "亲密低语",
    instruction: "请尝试用气声说话，音量极轻，营造出一种在耳边亲密低语的神秘感。",
  },
  {
    key: "impatient_urge",
    label: "紧急催办",
    instruction: "语气要显得非常急躁且不耐烦，语速加快，句子之间的停顿要尽量缩短。",
  },
  {
    key: "kind_elder",
    label: "长辈嘱托",
    instruction: "请模拟一位慈祥、温和的长辈，语速平稳，声音中要透出满满的关怀与爱意。",
  },
  {
    key: "sarcastic_mockery",
    label: "反讽吐槽",
    instruction: "语气要充满讽刺和不屑，在关键词上加重读音，句尾语调略微上扬。",
  },
  {
    key: "terrified_tremble",
    label: "惊悚呼救",
    instruction: "请用一种极度恐惧且颤抖的声音说话。",
  },
  {
    key: "news_anchor",
    label: "新闻播报",
    instruction: "语气要像专业的新闻播音员一样，冷静、客观且字正腔圆，情绪保持中立。",
  },
  {
    key: "playful_smile",
    label: "幼教互动",
    instruction: "语气要显得活泼俏皮，带着明显的笑意，让声音听起来充满朝气与阳光。",
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
