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
