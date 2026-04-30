export function WorkspaceHeader() {
  return (
    <section className="app-card w-full p-6 sm:p-8">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-4xl">语音复刻工作台</h1>
      <p className="mt-3 text-sm leading-6 text-text-muted">
        上传或录制清晰语音，系统将自动生成声纹，随后即可输入文本生成语音。
      </p>
    </section>
  );
}
