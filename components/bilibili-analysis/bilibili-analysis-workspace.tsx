import { WorkspaceModuleNav } from "@/components/workspace-module-nav";

const RESULT_SECTIONS = [
  {
    title: "视频基础信息",
    description: "分析后展示标题、UP 主、时长、发布时间等关键信息，便于快速确认素材背景。",
  },
  {
    title: "内容摘要",
    description: "提炼视频核心观点与关键信息，适合先判断是否值得继续深看。",
  },
  {
    title: "分段结构",
    description: "拆解视频的叙事顺序、章节转折与信息密度，帮助复盘内容组织方式。",
  },
  {
    title: "金句 / 爆点",
    description: "标记最容易传播、最值得引用或二次创作的片段与表达。",
  },
  {
    title: "可复用文案建议",
    description: "基于分析结果生成标题方向、摘要素材与可复用表达，服务后续创作。",
  },
] as const;

export function BilibiliAnalysisWorkspace() {
  return (
    <main className="flex min-h-screen w-full min-w-0 flex-col items-center px-4 py-12 sm:px-6">
      <div className="mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-6">
        <WorkspaceModuleNav />

        <section className="app-card p-6 sm:p-8">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">B站视频分析</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-text-muted sm:text-base">
            输入视频链接或 BV 号，生成摘要、结构拆解与可复用文案。
          </p>
        </section>

        <section className="app-card p-6 sm:p-8">
          <div className="flex flex-col gap-5">
            <div>
              <label htmlFor="video-analysis-input" className="text-sm font-semibold text-text-primary">
                视频链接或 BV 号
              </label>
              <input
                id="video-analysis-input"
                className="app-input"
                type="text"
                placeholder="例如 https://www.bilibili.com/video/BV... 或 BV1xx411c7mD"
              />
              <p className="mt-3 text-sm leading-6 text-text-muted">支持输入完整视频链接或以 `BV` 开头的编号。</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="app-button-primary">
                开始分析
              </button>
              <p className="text-sm leading-6 text-text-muted">当前为页面骨架阶段，后续将在此接入真实分析链路。</p>
            </div>
          </div>
        </section>

        <section className="app-card p-6 sm:p-8">
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-lg font-semibold text-text-primary">分析结果</h2>
              <p className="mt-2 text-sm leading-6 text-text-muted">
                先输入视频链接或 BV 号。分析完成后，这里会输出摘要、结构拆解和文案建议。
              </p>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {RESULT_SECTIONS.map((section) => (
                <article key={section.title} className="app-panel p-5">
                  <h3 className="text-sm font-semibold text-text-primary">{section.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-text-muted">{section.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
