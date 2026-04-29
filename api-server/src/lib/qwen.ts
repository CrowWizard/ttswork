import { createHash, randomUUID } from "node:crypto";
import { isSupportedAudioMimeType } from "./audio-format";
import type { AppConfig } from "./config";
import { isDebugEnabled, loggerDebug, loggerError } from "./logger";

export type VoiceEnrollmentResult = {
  voiceId: string;
  rawResponse: unknown;
};

export type TtsResult = {
  audioBuffer: Buffer;
  contentType: string;
  extension: string;
  rawResponse: unknown;
};

const PURE_VOICE_TARGET_MODEL = "qwen3-tts-vc-2026-01-22";
const SCENE_VOICE_TARGET_MODEL = "cosyvoice-v3.5-plus";

function assertEnv(name: string, value: string) {
  if (!value) {
    throw new Error(`${name} is required when QWEN_MOCK_MODE=false`);
  }

  return value;
}

function buildMockVoiceId(source: string) {
  const digest = createHash("sha256").update(source).digest("hex").slice(0, 16);
  return `mock-voice-${digest}-${randomUUID().slice(0, 8)}`;
}

function buildPreferredName() {
  return Date.now().toString(36);
}

function buildWaveFile(durationSeconds: number, frequency: number) {
  const sampleRate = 24000;
  const channels = 1;
  const bitsPerSample = 16;
  const totalSamples = Math.max(sampleRate, Math.floor(sampleRate * durationSeconds));
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = totalSamples * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let index = 0; index < totalSamples; index += 1) {
    const sample = Math.round(Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 16000);
    buffer.writeInt16LE(sample, 44 + index * 2);
  }

  return buffer;
}

async function mockEnrollVoice(source: string): Promise<VoiceEnrollmentResult> {
  return {
    voiceId: buildMockVoiceId(source),
    rawResponse: { mode: "mock" },
  };
}

async function mockSynthesizeSpeech(params: { text: string; voiceId: string; instruction?: string }): Promise<TtsResult> {
  const durationSeconds = Math.min(Math.max(params.text.length / 8, 1.5), 8);
  const voiceSeed = createHash("md5").update(`${params.voiceId}:${params.instruction ?? ""}`).digest()[0] ?? 0;
  const frequency = 220 + (voiceSeed % 180);

  return {
    audioBuffer: buildWaveFile(durationSeconds, frequency),
    contentType: "audio/wav",
    extension: "wav",
    rawResponse: { mode: "mock", requestId: randomUUID() },
  };
}

async function requestJson(url: string, init: RequestInit) {
  if (isDebugEnabled()) {
    loggerDebug("qwen.request_json.start", {
      url,
      method: init.method ?? "GET",
      body: typeof init.body === "string" ? init.body : undefined,
    });
  }

  const response = await fetch(url, init);

  if (!response.ok) {
    const text = await response.text();
    loggerError("qwen.request_json.failed", {
      url,
      method: init.method ?? "GET",
      status: response.status,
      responseText: text,
    });
    throw new Error(`Qwen request failed: ${response.status} ${text}`);
  }

  if (isDebugEnabled()) {
    loggerDebug("qwen.request_json.success", {
      url,
      method: init.method ?? "GET",
      status: response.status,
      contentType: response.headers.get("content-type") ?? undefined,
    });
  }

  return response.json();
}

async function requestArrayBuffer(url: string, init: RequestInit) {
  if (isDebugEnabled()) {
    loggerDebug("qwen.request_binary.start", {
      url,
      method: init.method ?? "GET",
    });
  }

  const response = await fetch(url, init);

  if (!response.ok) {
    const text = await response.text();
    loggerError("qwen.request_binary.failed", {
      url,
      method: init.method ?? "GET",
      status: response.status,
      responseText: text,
    });
    throw new Error(`Qwen request failed: ${response.status} ${text}`);
  }

  if (isDebugEnabled()) {
    loggerDebug("qwen.request_binary.success", {
      url,
      method: init.method ?? "GET",
      status: response.status,
      contentType: response.headers.get("content-type") ?? undefined,
    });
  }

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") ?? "audio/mpeg",
  };
}

function normalizeAudioContentType(contentType: string | null | undefined) {
  return contentType?.split(";")[0]?.trim() || "audio/mpeg";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchTtsAudioFromPayload(payload: any): Promise<{ audioBuffer: Buffer; contentType: string; extension: string }> {
  const audioData = payload?.output?.audio?.data as string | undefined;
  const audioUrl = payload?.output?.audio?.url as string | undefined;

  if (typeof audioData === "string" && audioData) {
    const matchedDataUrl = audioData.match(/^data:([^;]+);base64,(.+)$/);

    if (matchedDataUrl) {
      const contentType = normalizeAudioContentType(matchedDataUrl[1]);

      return {
        audioBuffer: Buffer.from(matchedDataUrl[2], "base64"),
        contentType,
        extension: contentType.includes("wav") ? "wav" : "mp3",
      };
    }

    return {
      audioBuffer: Buffer.from(audioData, "base64"),
      contentType: "audio/wav",
      extension: "wav",
    };
  }

  if (typeof audioUrl === "string" && audioUrl) {
    const audioResponse = await requestArrayBuffer(audioUrl, { method: "GET" });
    const contentType = normalizeAudioContentType(audioResponse.contentType);

    return {
      audioBuffer: audioResponse.buffer,
      contentType,
      extension: contentType.includes("wav") ? "wav" : "mp3",
    };
  }

  throw new Error("Qwen TTS response missing audio data");
}

async function liveEnrollPureVoice(cfg: AppConfig["qwen"], params: { audioBuffer: Buffer; mimeType: string }) {
  const url = assertEnv("QWEN_PURE_ENROLL_URL", cfg.pureEnrollUrl);
  const apiKey = assertEnv("QWEN_API_KEY", cfg.apiKey);

  if (!isSupportedAudioMimeType(params.mimeType)) {
    throw new Error("Qwen 建声只支持 WAV、MP3、W4V");
  }

  const base64Audio = params.audioBuffer.toString("base64");
  const audioData = `data:${params.mimeType};base64,${base64Audio}`;
  const preferredName = buildPreferredName();
  const requestPayload = {
    model: "qwen-voice-enrollment",
    input: {
      action: "create",
      target_model: PURE_VOICE_TARGET_MODEL,
      preferred_name: preferredName,
      audio: {
        data: audioData,
      },
    },
  };

  if (isDebugEnabled()) {
    loggerDebug("qwen.enroll.pure.request", {
      url,
      targetModel: PURE_VOICE_TARGET_MODEL,
      preferredName,
      mimeType: params.mimeType,
      audioBytes: params.audioBuffer.length,
      audioPreview: `${audioData.slice(0, 80)}...`,
    });
  }

  const payload = await requestJson(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestPayload),
  });

  const voiceId = payload?.output?.voice ?? payload?.voice ?? payload?.output?.voiceId ?? payload?.voiceId;

  if (!voiceId || typeof voiceId !== "string") {
    throw new Error("Qwen enrollment response missing voiceId");
  }

  if (isDebugEnabled()) {
    loggerDebug("qwen.enroll.pure.success", {
      url,
      voiceId,
      preferredName,
    });
  }

  return {
    voiceId,
    rawResponse: payload,
  } satisfies VoiceEnrollmentResult;
}

async function liveEnrollSceneVoice(cfg: AppConfig["qwen"], params: { publicAudioUrl: string; prefix: string }) {
  const url = assertEnv("QWEN_SCENE_ENROLL_URL", cfg.sceneEnrollUrl);
  const apiKey = assertEnv("QWEN_API_KEY", cfg.apiKey);
  const requestPayload = {
    model: "voice-enrollment",
    input: {
      action: "create_voice",
      target_model: SCENE_VOICE_TARGET_MODEL,
      prefix: params.prefix,
      url: params.publicAudioUrl,
      language_hints: ["zh"],
    },
  };

  if (isDebugEnabled()) {
    loggerDebug("qwen.enroll.scene.request", {
      url,
      targetModel: SCENE_VOICE_TARGET_MODEL,
      prefix: params.prefix,
      publicAudioUrl: params.publicAudioUrl,
    });
  }

  const payload = await requestJson(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestPayload),
  });

  const voiceId = payload?.output?.voice_id ?? payload?.output?.voiceId ?? payload?.voice_id ?? payload?.voiceId;

  if (!voiceId || typeof voiceId !== "string") {
    throw new Error("Qwen enrollment response missing voiceId");
  }

  if (isDebugEnabled()) {
    loggerDebug("qwen.enroll.scene.success", {
      url,
      voiceId,
    });
  }

  return {
    voiceId,
    rawResponse: payload,
  } satisfies VoiceEnrollmentResult;
}

async function liveSynthesizePureSpeech(cfg: AppConfig["qwen"], params: { text: string; voiceId: string }) {
  const url = assertEnv("QWEN_PURE_TTS_URL", cfg.pureTtsUrl);
  const apiKey = assertEnv("QWEN_API_KEY", cfg.apiKey);
  const requestPayload = {
    model: PURE_VOICE_TARGET_MODEL,
    input: {
      text: params.text,
      voice: params.voiceId,
      language_type: "Chinese",
    },
  };

  if (isDebugEnabled()) {
    loggerDebug("qwen.tts.pure.request", {
      url,
      voiceId: params.voiceId,
      textLength: params.text.length,
      targetModel: PURE_VOICE_TARGET_MODEL,
    });
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestPayload),
  });

  if (!response.ok) {
    const text = await response.text();
    loggerError("qwen.tts.pure.failed", {
      url,
      voiceId: params.voiceId,
      textLength: params.text.length,
      targetModel: PURE_VOICE_TARGET_MODEL,
      status: response.status,
      responseText: text,
    });
    throw new Error(`Qwen request failed: ${response.status} ${text}`);
  }

  const contentType = normalizeAudioContentType(response.headers.get("content-type"));

  if (!contentType.includes("json")) {
    const audioBuffer = Buffer.from(await response.arrayBuffer());

    if (isDebugEnabled()) {
      loggerDebug("qwen.tts.pure.success.binary", {
        url,
        voiceId: params.voiceId,
        textLength: params.text.length,
        targetModel: PURE_VOICE_TARGET_MODEL,
        contentType,
        audioBytes: audioBuffer.length,
      });
    }

    return {
      audioBuffer,
      contentType,
      extension: contentType.includes("wav") ? "wav" : "mp3",
      rawResponse: { mode: "live", contentType },
    } satisfies TtsResult;
  }

  const payload = await response.json();
  const audioResult = await fetchTtsAudioFromPayload(payload);

  if (isDebugEnabled()) {
    loggerDebug("qwen.tts.pure.success.json", {
      url,
      voiceId: params.voiceId,
      textLength: params.text.length,
      targetModel: PURE_VOICE_TARGET_MODEL,
      contentType: audioResult.contentType,
      audioBytes: audioResult.audioBuffer.length,
    });
  }

  return {
    audioBuffer: audioResult.audioBuffer,
    contentType: audioResult.contentType,
    extension: audioResult.extension,
    rawResponse: payload,
  } satisfies TtsResult;
}

async function liveSynthesizeSceneSpeech(cfg: AppConfig["qwen"], params: { text: string; voiceId: string; instruction?: string }) {
  const url = assertEnv("QWEN_SCENE_TTS_URL", cfg.sceneTtsUrl);
  const apiKey = assertEnv("QWEN_API_KEY", cfg.apiKey);
  const requestPayload = {
    model: SCENE_VOICE_TARGET_MODEL,
    input: {
      text: params.text,
      voice: params.voiceId,
      format: "wav",
      sample_rate: 24000,
      language_hints: ["zh"],
      ...(params.instruction ? { instruction: params.instruction } : {}),
    },
  };

  if (isDebugEnabled()) {
    loggerDebug("qwen.tts.scene.request", {
      url,
      voiceId: params.voiceId,
      textLength: params.text.length,
      instruction: params.instruction,
      targetModel: SCENE_VOICE_TARGET_MODEL,
    });
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestPayload),
  });

  if (!response.ok) {
    const text = await response.text();
    loggerError("qwen.tts.scene.failed", {
      url,
      voiceId: params.voiceId,
      textLength: params.text.length,
      targetModel: SCENE_VOICE_TARGET_MODEL,
      status: response.status,
      responseText: text,
    });
    throw new Error(`Qwen request failed: ${response.status} ${text}`);
  }

  const contentType = normalizeAudioContentType(response.headers.get("content-type"));

  if (!contentType.includes("json")) {
    const audioBuffer = Buffer.from(await response.arrayBuffer());

    if (isDebugEnabled()) {
      loggerDebug("qwen.tts.scene.success.binary", {
        url,
        voiceId: params.voiceId,
        textLength: params.text.length,
        targetModel: SCENE_VOICE_TARGET_MODEL,
        contentType,
        audioBytes: audioBuffer.length,
      });
    }

    return {
      audioBuffer,
      contentType,
      extension: contentType.includes("wav") ? "wav" : "mp3",
      rawResponse: { mode: "live", contentType },
    } satisfies TtsResult;
  }

  const payload = await response.json();
  const audioResult = await fetchTtsAudioFromPayload(payload);

  if (isDebugEnabled()) {
    loggerDebug("qwen.tts.scene.success.json", {
      url,
      voiceId: params.voiceId,
      textLength: params.text.length,
      targetModel: SCENE_VOICE_TARGET_MODEL,
      contentType: audioResult.contentType,
      audioBytes: audioResult.audioBuffer.length,
    });
  }

  return {
    audioBuffer: audioResult.audioBuffer,
    contentType: audioResult.contentType,
    extension: audioResult.extension,
    rawResponse: payload,
  } satisfies TtsResult;
}

export async function enrollPureVoice(
  cfg: AppConfig["qwen"],
  params: { audioBuffer: Buffer; mimeType: string },
) {
  if (cfg.mockMode) {
    if (isDebugEnabled()) {
      loggerDebug("qwen.enroll.pure.mock", {
        mimeType: params.mimeType,
        audioBytes: params.audioBuffer.length,
      });
    }
    return mockEnrollVoice(`pure:${params.mimeType}:${params.audioBuffer.length}`);
  }

  return liveEnrollPureVoice(cfg, params);
}

export async function enrollSceneVoice(
  cfg: AppConfig["qwen"],
  params: { publicAudioUrl: string; prefix: string },
) {
  if (cfg.mockMode) {
    if (isDebugEnabled()) {
      loggerDebug("qwen.enroll.scene.mock", {
        publicAudioUrl: params.publicAudioUrl,
        prefix: params.prefix,
      });
    }
    return mockEnrollVoice(`scene:${params.publicAudioUrl}:${params.prefix}`);
  }

  return liveEnrollSceneVoice(cfg, params);
}

export async function synthesizePureSpeech(
  cfg: AppConfig["qwen"],
  params: { text: string; voiceId: string },
) {
  if (cfg.mockMode) {
    if (isDebugEnabled()) {
      loggerDebug("qwen.tts.pure.mock", {
        voiceId: params.voiceId,
        textLength: params.text.length,
      });
    }
    return mockSynthesizeSpeech(params);
  }

  return liveSynthesizePureSpeech(cfg, params);
}

export async function synthesizeSceneSpeech(
  cfg: AppConfig["qwen"],
  params: { text: string; voiceId: string; instruction?: string },
) {
  if (cfg.mockMode) {
    if (isDebugEnabled()) {
      loggerDebug("qwen.tts.scene.mock", {
        voiceId: params.voiceId,
        textLength: params.text.length,
        instruction: params.instruction,
      });
    }
    return mockSynthesizeSpeech(params);
  }

  return liveSynthesizeSceneSpeech(cfg, params);
}
