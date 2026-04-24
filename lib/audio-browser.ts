export async function getBlobDurationSeconds(blob: Blob) {
  return new Promise<number>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const audio = new Audio();

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      audio.removeAttribute("src");
      audio.load();
    };

    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const durationSeconds = Number.isFinite(audio.duration) ? audio.duration : 0;

      cleanup();
      resolve(durationSeconds);
    };
    audio.onerror = () => {
      cleanup();
      reject(new Error("无法读取录音真实时长"));
    };
    audio.src = objectUrl;
  });
}

function writeWaveHeader(buffer: ArrayBuffer, params: { channels: number; sampleRate: number; bitsPerSample: number; dataSize: number }) {
  const view = new DataView(buffer);
  const byteRate = params.sampleRate * params.channels * (params.bitsPerSample / 8);
  const blockAlign = params.channels * (params.bitsPerSample / 8);

  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + params.dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, params.channels, true);
  view.setUint32(24, params.sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, params.bitsPerSample, true);
  writeString(36, "data");
  view.setUint32(40, params.dataSize, true);

  return view;
}

export async function convertBlobToWavFile(blob: Blob, fileName = "enrollment.wav") {
  const audioContext = new AudioContext();

  try {
    const sourceBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(sourceBuffer.slice(0));
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const dataSize = audioBuffer.length * audioBuffer.numberOfChannels * bytesPerSample;
    const wavBuffer = new ArrayBuffer(44 + dataSize);
    const view = writeWaveHeader(wavBuffer, {
      channels: audioBuffer.numberOfChannels,
      sampleRate: audioBuffer.sampleRate,
      bitsPerSample,
      dataSize,
    });

    let offset = 44;

    for (let sampleIndex = 0; sampleIndex < audioBuffer.length; sampleIndex += 1) {
      for (let channelIndex = 0; channelIndex < audioBuffer.numberOfChannels; channelIndex += 1) {
        const channelData = audioBuffer.getChannelData(channelIndex);
        const sample = Math.max(-1, Math.min(1, channelData[sampleIndex] ?? 0));
        const value = sample < 0 ? sample * 0x8000 : sample * 0x7fff;

        view.setInt16(offset, value, true);
        offset += bytesPerSample;
      }
    }

    return new File([wavBuffer], fileName, { type: "audio/wav" });
  } catch {
    throw new Error("无法将录音转换为 WAV 格式");
  } finally {
    await audioContext.close();
  }
}
