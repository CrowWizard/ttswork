import { createHash, randomUUID } from "node:crypto";
import { isSupportedAudioMimeType, normalizeSupportedAudioMimeType } from "./audio-format";
import type { AppConfig } from "./config";

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

const QWEN_VC_TARGET_MODEL = "qwen3-tts-vc-2026-01-22";

function buildPreferredName() {
  return Date.now().toString(36);
}

function assertEnv(name: string, value: string) {
  if (!value) {
    throw new Error(`${name} is required when QWEN_MOCK_MODE=false`);
  }

  return value;
}

function buildMockVoiceId(audioBuffer: Buffer) {
  const digest = createHash("sha256").update(audioBuffer).digest("hex").slice(0, 16);
  return `mock-voice-${digest}-${randomUUID().slice(0, 8)}`;
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

async function mockEnrollVoice(audioBuffer: Buffer): Promise<VoiceEnrollmentResult> {
  return {
    voiceId: buildMockVoiceId(audioBuffer),
    rawResponse: { mode: "mock" },
  };
}

async function mockSynthesizeSpeech(params: { text: string; voiceId: string }): Promise<TtsResult> {
  const durationSeconds = Math.min(Math.max(params.text.length / 8, 1.5), 8);
  const voiceSeed = createHash("md5").update(params.voiceId).digest()[0] ?? 0;
  const frequency = 220 + (voiceSeed % 180);

  return {
    audioBuffer: buildWaveFile(durationSeconds, frequency),
    contentType: "audio/wav",
    extension: "wav",
    rawResponse: { mode: "mock", requestId: randomUUID() },
  };
}

async function requestJson(url: string, init: RequestInit) {
  const response = await fetch(url, init);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Qwen request failed: ${response.status} ${text}`);
  }

  return response.json();
}

async function requestArrayBuffer(url: string, init: RequestInit) {
  const response = await fetch(url, init);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Qwen request failed: ${response.status} ${text}`);
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

async function liveEnrollVoice(cfg: AppConfig["qwen"], audioBuffer: Buffer, mimeType: string) {
  const url = assertEnv("QWEN_ENROLL_URL", cfg.enrollUrl);
  const apiKey = assertEnv("QWEN_API_KEY", cfg.apiKey);
  const normalizedMimeType = normalizeSupportedAudioMimeType(mimeType);

  if (!isSupportedAudioMimeType(normalizedMimeType)) {
    throw new Error("Qwen 建声只支持 WAV、MP3、M4A");
  }

  const base64Audio = audioBuffer.toString("base64");
  const audioData = `data:${normalizedMimeType};base64,${base64Audio}`;
  const preferredName = buildPreferredName();
  const requestPayload = {
    model: "qwen-voice-enrollment",
    input: {
      action: "create",
      target_model: QWEN_VC_TARGET_MODEL,
      preferred_name: preferredName,
      audio: {
        data: audioData,
      },
    },
  };

  console.info("[Qwen enroll] request", {
    url,
    payload: {
      ...requestPayload,
      input: {
        ...requestPayload.input,
        audio: {
          data: `${audioData.slice(0, 80)}...`,
          bytes: audioBuffer.byteLength,
          mimeType: normalizedMimeType,
        },
      },
    },
  });

  const payload = await requestJson(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestPayload),
  });

  console.info("[Qwen enroll] response", payload);

  const voiceId = payload?.output?.voice ?? payload?.voice ?? payload?.output?.voiceId ?? payload?.voiceId;

  if (!voiceId || typeof voiceId !== "string") {
    throw new Error("Qwen enrollment response missing voiceId");
  }

  return {
    voiceId,
    rawResponse: payload,
  } satisfies VoiceEnrollmentResult;
}

async function liveSynthesizeSpeech(cfg: AppConfig["qwen"], params: { text: string; voiceId: string }) {
  const url = assertEnv("QWEN_TTS_URL", cfg.ttsUrl);
  const apiKey = assertEnv("QWEN_API_KEY", cfg.apiKey);
  const requestPayload = {
    model: QWEN_VC_TARGET_MODEL,
    input: {
      text: params.text,
      voice: params.voiceId,
      language_type: "Chinese",
    },
  };

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
    throw new Error(`Qwen request failed: ${response.status} ${text}`);
  }

  const contentType = normalizeAudioContentType(response.headers.get("content-type"));

  if (!contentType.includes("json")) {
    const audioBuffer = Buffer.from(await response.arrayBuffer());

    return {
      audioBuffer,
      contentType,
      extension: contentType.includes("wav") ? "wav" : "mp3",
      rawResponse: { mode: "live", contentType },
    } satisfies TtsResult;
  }

  const payload = await response.json();
  const audioResult = await fetchTtsAudioFromPayload(payload);

  return {
    audioBuffer: audioResult.audioBuffer,
    contentType: audioResult.contentType,
    extension: audioResult.extension,
    rawResponse: payload,
  } satisfies TtsResult;
}

export async function enrollVoice(cfg: AppConfig["qwen"], params: { audioBuffer: Buffer; mimeType: string }) {
  if (cfg.mockMode) {
    return mockEnrollVoice(params.audioBuffer);
  }

  return liveEnrollVoice(cfg, params.audioBuffer, params.mimeType);
}

export async function synthesizeSpeech(cfg: AppConfig["qwen"], params: { text: string; voiceId: string }) {
  if (cfg.mockMode) {
    return mockSynthesizeSpeech(params);
  }

  return liveSynthesizeSpeech(cfg, params);
}
