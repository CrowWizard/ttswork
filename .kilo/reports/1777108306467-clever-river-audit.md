# 前端静态审计报告

## 审计说明

- 审计方法：静态代码审计，未启动运行态服务；登录模式切换补充键盘焦点顺序复核。
- 审计范围：`components/voice-studio.tsx`、`components/ui/status-message.tsx`、`app/register/page.tsx`、`app/settings/page.tsx`、`app/layout.tsx`、`app/globals.css`、`tailwind.config.ts`、`PRODUCT.md`、`DESIGN.md`。
- 上下文置信度说明：当前已存在 `PRODUCT.md` 与 `DESIGN.md`，可对产品定位、语气、任务边界、主题系统与当前实现做较高置信审计。未进行浏览器运行态、屏幕阅读器实测和真机触控测试，因此运行态动效、实际焦点顺序和浏览器录音权限体验仍需后续补测。

## Audit Health Score

| # | Dimension | Score | Key Finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | 4/4 | 关键状态已接入语义组件，录音主交互具备键盘路径，焦点可见性已统一 |
| 2 | Performance | 3/4 | 录音计时已下沉到局部组件，但 `VoiceStudio` 文件体量和职责仍偏大 |
| 3 | Responsive Design | 4/4 | 关键窄屏挤压点已处理，触控目标和换行策略明显改善 |
| 4 | Theming | 3/4 | Tailwind 已转向语义 token，但 `DESIGN.md` 与实现色值仍存在漂移 |
| 5 | Anti-Patterns | 3/4 | 模板化渐变、大圆角、柔阴影已收敛，但整体视觉仍偏 MVP 工具台 |
| **Total** | | **17/20** | **Good（基础质量达标，剩余问题以体系一致性和结构维护为主）** |

## Anti-Patterns Verdict

结论：**已从 fail 改为 pass，但仍不应继续叠加同质化卡片。**

可验证的改善点：

- 全局背景已收敛为单一 `bg-canvas`，不再在主页面重复使用模板化渐变背景：`app/globals.css:11-17`、`components/voice-studio.tsx:1191-1193`、`app/register/page.tsx:129-132`、`app/settings/page.tsx:247-249`。
- 卡片、面板、输入和按钮已抽象为 `app-card`、`app-panel`、`app-input`、`app-button-*`，减少逐页复制大圆角与阴影组合：`app/globals.css:29-52`。
- 半透明白卡与 `backdrop-blur` 未在当前审计范围内继续出现，界面更接近低干扰任务台而非玻璃拟态模板。
- 字体已由通用 `Arial, Helvetica, sans-serif` 改为 `Inter` + 中文系统字体回退：`app/globals.css:15-18`。

剩余风险：当前三个页面仍主要依靠浅色卡片、细边框和柔砂面板组织层级，品牌识别度还不强；但这与 `PRODUCT.md` 中“专业、直接、低情绪、面向任务完成”的 MVP 约束基本一致，不构成当前阶段阻断。

## Executive Summary

- Audit Health Score：**17/20（Good）**
- 问题总数：**4**
  - **P0**：0
  - **P1**：0
  - **P2**：2
  - **P3**：2
- 已确认修复的旧高优问题：
  - 录音按钮已支持键盘按 `Space` / `Enter` 开始，再次按键结束：`components/voice-studio.tsx:451-485,1176-1189`。
  - 通用状态反馈已通过 `StatusMessage` 暴露 `role`、`aria-live`、`aria-atomic`：`components/ui/status-message.tsx:15-38`。
  - 全局 `focus-visible` 已恢复高对比 ring，不再只依赖弱边框变化：`app/globals.css:24-26`。
  - 成功、错误、提示与警告已拆成带 `type` 的状态对象，不再把成功消息写入错误状态：`components/voice-studio.tsx:55-61,611-612,959-962,1077-1080,1111-1115`。
  - 录音计时已下沉到 `RecordingElapsedStatus`，刷新频率从旧报告的 100ms 降到 500ms：`components/voice-studio.tsx:123-160`。
- 推荐方向：不再优先做基础无障碍抢修，下一步应聚焦运行态真机验证和更复杂错误链路的字段级关联。

## Detailed Findings by Severity

### P2

#### [P2] `VoiceStudio` 文件仍然过大，长期维护风险偏高

- Location：`components/voice-studio.tsx:1-1252`
- Category：Performance / Maintainability
- Impact：虽然 UI 已拆出 `AuthPanel`、`WorkspaceHeader`、`RecordingPanel`、`TtsPanel` 等内部组件，但认证、资料恢复、录音、建声、作废、TTS、历史刷新和登出逻辑仍集中在一个 client component 文件中。后续继续扩展配额、错误恢复、上传、历史筛选或更多账号设置时，回归面会快速扩大。
- WCAG/Standard：React maintainability / render-surface best practice
- Recommendation：下一轮优先按文件拆分，而不是继续只在同文件内增加函数。建议至少拆出 `components/voice-studio/auth-panel.tsx`、`recording-panel.tsx`、`tts-panel.tsx`，再把认证、资料、录音、TTS 各自的状态逻辑收敛为局部 hook。
- Suggested command：`/impeccable optimize`

#### [P2] `DESIGN.md` 与 Tailwind 实现 token 已出现色值漂移

- Location：`DESIGN.md:4-23`、`tailwind.config.ts:11-45`
- Category：Theming
- Impact：设计文档仍记录 `cream`、`sand`、`mist`、`ink` 等旧色值与旧主按钮色，而实现已改为 `canvas`、`surface`、`border-*`、`text-*`、`action-*`、`status-*` 等更完整语义 token。后续如果按文档新增页面，容易重新引入旧视觉语言。
- WCAG/Standard：Design token source-of-truth best practice
- Recommendation：将 `DESIGN.md` frontmatter 与正文色彩章节同步到当前 `tailwind.config.ts`，明确 Tailwind 为实现源，文档只描述语义、用法和可接受变化范围。
- Suggested command：`/impeccable document`

### P3

#### [P3] 状态消息组件语义正确，但视觉与文案仍可进一步系统化

- Location：`components/ui/status-message.tsx:1-43`、`components/voice-studio.tsx:374-377,488-491`、`app/register/page.tsx:202-208`、`app/settings/page.tsx:328-330,425-431`
- Category：Accessibility / UX copy
- Impact：当前 `StatusMessage` 已解决朗读语义和重复样式问题，但所有状态消息都采用相同结构，缺少可选的操作区、错误修复建议、字段级关联和调试信息收纳策略。对 MVP 足够，对更复杂失败链路仍偏基础。
- WCAG/Standard：WCAG 3.3.1 Error Identification / Status communication best practice
- Recommendation：保留当前组件作为基础层，后续只在真实复杂错误出现时扩展 `action`、`details` 或字段级 `aria-describedby`，避免现在过度设计。
- Suggested command：`/impeccable clarify`

#### [P3] 品牌识别仍处于 MVP 工作台阶段

- Location：`PRODUCT.md:121-142`、`DESIGN.md:95-109`、`app/layout.tsx:4-7`
- Category：Theming / Product UX
- Impact：当前标题、字体、色彩和文案已符合“专业、直接、低情绪”的产品边界，但尚未形成强品牌资产。对于内部或单用户 MVP 合理；若后续面向外部用户，界面会显得偏工具化。
- WCAG/Standard：Product consistency best practice
- Recommendation：在品牌名称、目标人群和商业策略确认前，不建议强行加入装饰性品牌表达。若产品进入公开使用阶段，再补品牌命名、登录页定位语和更明确的信息架构。
- Suggested command：`/impeccable polish`

## Patterns & Systemic Issues

- 可访问性基础已从“局部补丁”升级为系统基线：焦点样式、状态消息、录音键盘路径和加载语义都已有统一处理。
- 当前最大系统风险已从“用户无法完成关键任务”转移为“设计源与实现源不同步”。这类风险不会立即阻断使用，但会让后续页面重新漂移。
- `VoiceStudio` 的职责拆分只完成了组件层第一步，文件边界和逻辑边界还没真正分离。
- 表单控件样式已统一，互斥模式切换已补齐 tablist 语义；字段错误关联、调试验证码展示等交互语义后续仍可更精确。
- 当前视觉去模板化方向正确：减少渐变、弱化阴影、降低圆角、保留任务台结构；不建议为了“更有设计感”重新加重装饰。

## Positive Findings

- 录音主交互同时支持鼠标、触屏和键盘路径，并向用户说明键盘操作方式：`components/voice-studio.tsx:451-485,1176-1189`。
- `StatusMessage` 将错误设置为 `role="alert"`、成功/提示/警告设置为 `role="status"`，并统一 `aria-live` 与 `aria-atomic`：`components/ui/status-message.tsx:15-38`。
- `focus-visible` 已作为全局基础样式覆盖按钮、链接、输入和摘要控件：`app/globals.css:24-26`。
- 主题 token 已覆盖 canvas、surface、border、text、action、danger、success、warning、info 等语义层：`tailwind.config.ts:11-45`。
- 触控目标已修正到常见 44px 基线，危险操作按钮为 `h-11 w-11` 并保留 `aria-label`：`components/voice-studio.tsx:425-435`。
- 注册页和设置页继续使用原生表单、label 绑定、required/minLength 等基础语义，不依赖纯视觉占位符：`app/register/page.tsx:143-216`、`app/settings/page.tsx:311-445`。
- 设置页加载态已使用 `aria-busy`、`role="status"` 与骨架占位，优于单句“加载中”：`app/settings/page.tsx:221-239`。
- 登录模式切换已补齐 `role="tablist"` / `role="tab"` / `role="tabpanel"`、`aria-selected`、`aria-controls` 与方向键/Home/End 切换：`components/voice-studio/auth-panel.tsx:24-46,70-105,107-176`。
- `PRODUCT.md` 明确了当前 MVP 的事实边界和非目标，减少 UI 过度营销化或擅自扩展的风险：`PRODUCT.md:143-183`。

## Keyboard Focus Order Audit

- 默认短信登录路径：手机号输入框 → 登录方式 tablist 中的“短信登录”tab → 验证码输入框 → 发送验证码按钮 → 短信登录按钮 → 注册链接；状态消息仅作为 live region，不额外进入 Tab 顺序。
- 密码登录路径：手机号输入框 → 登录方式 tablist 中的“密码登录”tab → 密码输入框 → 密码登录按钮 → 注册链接；隐藏的短信面板不会保留可聚焦控件。
- tablist 内部支持 `ArrowLeft` / `ArrowRight` / `ArrowUp` / `ArrowDown` 在两种登录方式间切换，`Home` 回到短信登录，`End` 跳到密码登录；非选中 tab 使用 `tabIndex={-1}`，避免 Tab 键在互斥模式内重复停留。
- 当前代码未发现正数 `tabIndex`、局部 `outline-none` 或隐藏面板残留焦点入口；全局 `focus-visible` ring 仍覆盖按钮、链接和输入控件。

## Recommended Actions

1. **[P2] `/impeccable document`** — 先同步 `DESIGN.md` 与当前 Tailwind token，避免设计系统成为旧实现快照。
2. **[P2] `/impeccable optimize`** — 将 `VoiceStudio` 从单文件内部拆分推进到文件边界与状态 hook 边界。
3. **[P3] `/impeccable clarify`** — 在出现更复杂错误链路时扩展 `StatusMessage`，当前不建议提前做大而全组件。
4. **[P3] `/impeccable polish`** — 保持低干扰工具台方向，只在产品品牌事实明确后再增强识别度。

## Verification Notes

- 本次加固修改了登录模式切换控件语义，并同步记录键盘焦点顺序审计。
- 本次已运行 `npm run lint`、`npm run typecheck` 与 `npm run build`。
- 旧报告中的部分行号已因前端重构失效，本报告已按当前文件重新标注。
