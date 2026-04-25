---
name: 语音复刻工作台
description: 面向单用户建声与文本转语音任务的低干扰工作台式 MVP。
colors:
  canvas: "#f2eee7"
  canvas-warm: "#f7f2e9"
  canvas-cool: "#e8edf3"
  surface: "#f8f4ed"
  surface-muted: "#ede6dc"
  surface-elevated: "#fbf8f2"
  surface-inset: "#e5dccf"
  surface-selected: "#fdfaf4"
  border-subtle: "#d7cbbb"
  border-strong: "#a99b8a"
  text-primary: "#211f1b"
  text-secondary: "#575047"
  text-muted: "#7b7166"
  text-inverse: "#fffefa"
  action-primary: "#234a42"
  action-primary-hover: "#19362f"
  action-secondary: "#b86432"
  action-secondary-hover: "#9f4e25"
  action-record: "#f0c66b"
  action-record-hover: "#e8b24f"
  action-record-active: "#b63d2f"
  danger: "#a33a31"
  danger-surface: "#fae7e2"
  danger-border: "#e9b6ad"
  success: "#276b55"
  success-surface: "#e4f1e9"
  success-border: "#a8d1bc"
  warning: "#9a5c19"
  warning-surface: "#f8ead0"
  warning-border: "#e2bf7a"
  info: "#34516f"
  info-surface: "#e5edf5"
  info-border: "#b4c6da"
typography:
  display:
    fontFamily: "Inter, Noto Sans SC, PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Inter, Noto Sans SC, PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
  title:
    fontFamily: "Inter, Noto Sans SC, PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.35
  body:
    fontFamily: "Inter, Noto Sans SC, PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, Noto Sans SC, PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "0.18em"
rounded:
  xl: "12px"
  2xl: "16px"
  panel: "16px"
  card: "18px"
  control: "16px"
  chip: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.action-primary}"
    textColor: "{colors.text-inverse}"
    rounded: "{rounded.control}"
    padding: "16px 20px"
  button-primary-hover:
    backgroundColor: "{colors.action-primary-hover}"
    textColor: "{colors.text-inverse}"
  button-secondary:
    backgroundColor: "{colors.surface-elevated}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.control}"
    padding: "16px 20px"
  input-default:
    backgroundColor: "{colors.surface-elevated}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.control}"
    padding: "16px 16px"
  card-default:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.card}"
    padding: "24px"
---

# Design System: 语音复刻工作台

## 1. Overview

**Creative North Star: "安静的任务台"**

这套界面服务一个工作台式 MVP：用户登录后完成个人建声与文本转语音，注册页只负责账号创建，设置页只负责密码管理。视觉系统必须保持专业、直接、低情绪，避免把当前产品伪装成品牌故事、营销首页或复杂账户中心。当前实现以 Tailwind 语义 token 为唯一前端事实来源，`DESIGN.md` 只记录这些 token 的设计意图，不另建一套旧色板快照。

物理场景是：单个用户在普通办公环境中打开浏览器，想尽快确认登录状态、录制声纹、输入文本并拿到语音结果。界面应像一张整理过的任务台，层级清楚、反馈明确、干扰很少；浅色基底成立，因为当前任务需要表单输入、音频控件和状态反馈的可读性，而不是沉浸式监听或夜间控制台。

系统拒绝过强营销语气、拟人化陪伴表达、团队协作暗示、商业化套餐暗示，以及没有任务指向的情绪化欢迎语。任何新界面都应先说明用户下一步能做什么，再考虑装饰性表达。

**Key Characteristics:**
- 任务优先：注册、登录、建声、生成、管理五类动作必须一眼可见。
- 单用户视角：不出现团队、组织、成员、审批、协作等结构暗示。
- 低干扰浅色：`canvas` 承载页面，`surface` 与 `surface-muted` 做轻微任务分层。
- 直接反馈：成功、失败、处理中、待完成必须用明确状态文案表达。
- 卡片克制：卡片用于承载任务区，不用于制造装饰性网格。

## 2. Colors

调色板采用 restrained 策略：低饱和暖灰承载大部分界面，深绿作为主操作，陶土橙作为焦点与次要动作，录音琥珀只用于录音入口和文字选区。所有命名以 `tailwind.config.ts` 的 `theme.extend.colors` 为准。

### Primary
- **任务深绿** (`action-primary`, `action-primary-hover`): 主按钮与关键提交动作使用的功能色。它不是品牌色，而是“确认执行”的稳定色；hover 使用更深绿色提供即时反馈。

### Secondary
- **动作陶土** (`action-secondary`, `action-secondary-hover`): focus-visible ring、输入 focus 边框与需要强调但不提交的动作使用。
- **录音琥珀** (`action-record`, `action-record-hover`, `action-record-active`): 录音控件默认、hover 与录音中状态使用；录音中切换到红棕色以明确风险和进行中状态。
- **完成绿** (`success`, `success-surface`, `success-border`): 建声完成、TTS 完成、密码设置成功等结果态使用。

### Tertiary
- **阻断红棕** (`danger`, `danger-surface`, `danger-border`): 错误、失败、作废 active voice 等风险动作使用。只出现在需要用户修正或确认风险的局部。
- **说明蓝灰** (`info`, `info-surface`, `info-border`): 调试验证码、加载说明和非阻断信息提示使用。
- **提示琥珀** (`warning`, `warning-surface`, `warning-border`): 需要注意但不阻断的提示使用，不能替代录音控件的 `action-record`。

### Neutral
- **页面画布** (`canvas`, `canvas-warm`, `canvas-cool`): 页面根背景。当前实际页面默认使用纯 `canvas`，`canvas-warm` / `canvas-cool` 仅作为后续局部过渡储备。
- **任务表面** (`surface`): 主任务卡、注册卡、设置卡的默认表面。
- **柔砂分区** (`surface-muted`): 内部面板、账户信息行、空态和辅助信息块。
- **升起输入面** (`surface-elevated`): 输入框、次级按钮和需要轻微凸显的控件表面。
- **内陷/选中面** (`surface-inset`, `surface-selected`): 分段控件、选择态、局部 inset 信息块使用。
- **边界线** (`border-subtle`, `border-strong`): 默认结构边界与禁用按钮背景。
- **文本组** (`text-primary`, `text-secondary`, `text-muted`, `text-inverse`): 标题/关键值、说明/次级动作、辅助说明、深色按钮反白文字。

### Named Rules
**The ≤10% Accent Rule.** 陶土、录音琥珀、状态绿、警告琥珀、红棕和信息蓝灰都不是装饰色；任一屏幕中强调色面积必须很小，只服务焦点、结果、录音或错误。

**The No Pure White Canvas Rule.** 页面背景禁止使用纯白大面积铺底；使用 `canvas` 承载页面，再让 `surface` / `surface-elevated` 只出现在卡片和输入区域。

## 3. Typography

**Display Font:** Inter, Noto Sans SC, PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif  
**Body Font:** Inter, Noto Sans SC, PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif  
**Label/Mono Font:** 当前没有独立 mono 字体。

**Character:** 字体系统是单一 sans 方向，偏现代、清楚、低情绪。中文优先使用系统中文字体回退，避免引入具有强品牌人格的显示字体，因为当前产品事实尚未确认品牌定位。

### Hierarchy
- **Display** (600, `2.25rem`, 1.1): 页面主标题，例如“语音复刻工作台”“个人设置”。只在页面顶层出现。
- **Headline** (600, `1.5rem`, 1.2): 主要任务区标题，例如“建声录音”“文本转语音”。
- **Title** (600, `1.125rem`, 1.35): 卡片内部小标题、账号信息与密码管理分区标题。
- **Body** (400, `0.875rem`, 1.5): 表单说明、状态解释、空态说明。正文行长应控制在 65–75ch 内。
- **Label** (600, `0.75rem`, 0.18em when uppercase): 小型元信息标签，例如 `active voice`、`当前账号`。

### Named Rules
**The No Personality Type Rule.** 在品牌事实未确认前，禁止用强装饰字体制造品牌感；层级只能通过字号、字重、行距和信息位置建立。

**The Action Word Rule.** 标题和按钮文案必须优先使用动作词：注册、登录、建声、生成、管理、返回、下载。

## 4. Elevation

系统使用“细边界 + 1px 级轻阴影”的混合分层。阴影只用于补足边界识别，不用于制造漂浮感、玻璃质感或模板化卡片。内部面板优先使用柔砂背景与细边框，而不是继续叠加重阴影。

### Shadow Vocabulary
- **Card Shadow** (`0 1px 2px rgba(69, 53, 35, 0.05)`): 当前 `app-card` 默认阴影，用于页面主任务卡的轻微边界提示。
- **Panel Shadow** (`0 1px 1px rgba(69, 53, 35, 0.04)`): 当前 `app-panel` 默认阴影，用于卡片内部的轻分组。
- **Control Shadow** (`inset 0 1px 0 rgba(255, 254, 250, 0.55)`): 当前按钮与输入控件的内侧高光，避免控件在同色表面上糊成一片。

### Named Rules
**The Shadow Has a Job Rule.** 阴影只能表达任务容器或控件边界；如果一个区域已经有背景色和边框，就不要再额外加重阴影。

**The No Glass Rule.** 禁止把半透明白卡和 backdrop blur 当作默认容器。当前产品需要清晰表单和音频控件，不需要玻璃拟态装饰。

## 5. Components

### Buttons
- **Shape:** 控件圆角使用 16px，chip 使用 12px，触控目标高度不低于 44px。
- **Primary:** 深绿背景、反白文字、水平 20px 垫距、垂直 16px 垫距，并带 `control` 内阴影。用于提交登录、注册、设置密码、生成语音。
- **Hover / Focus:** hover 使用更深绿色；focus-visible 使用 `action-secondary` 2px ring 与 `canvas` offset，不允许只改变浅边框。
- **Secondary / Ghost / Tertiary:** `surface-elevated` 底细边框用于发送验证码、返回工作台；`surface-muted` 小 chip 用于个人设置、退出登录等低优先级操作。

### Chips
- **Style:** `surface-muted` 背景、`border-subtle` 细边框、12px 圆角、小字号半粗体。
- **State:** 只用于低优先级账号动作、模式切换或状态标签。不要把 chip 用作主要 CTA。

### Cards / Containers
- **Corner Style:** 主卡片使用 18px，内部面板和表单控件使用 16px，chip 和小信息行使用 12px。
- **Background:** 主卡使用 `surface`；内部面板使用 `surface-muted`；输入和次级按钮使用 `surface-elevated`；页面背景默认使用纯 `canvas`。
- **Shadow Strategy:** 主卡可使用 Card Shadow；内部面板最多使用 Panel Shadow；控件可使用 Control Shadow。
- **Border:** 所有任务容器默认保留 `border-subtle` 细边界，避免只靠阴影表达结构。
- **Internal Padding:** 主卡移动端 24px、宽屏 32px；内部面板 16–20px。

### Inputs / Fields
- **Style:** `surface-elevated` 底、细边框、16px 圆角、16px 内边距、小字号正文，并带 `control` 内阴影。
- **Focus:** 必须出现可见的 `action-secondary` focus ring；禁止只用 `outline-none` 加弱边框色。
- **Error / Disabled:** 错误通过 StatusMessage 与危险色表面表达；disabled 控件透明度降低并显示禁用鼠标状态。

### Navigation
- **Style, typography, default/hover/active states, mobile treatment.** 当前没有全局导航。页面间移动只通过“个人设置”“返回工作台”“立即登录”等内联链接和按钮完成；这些链接必须保持任务语义，不扩展成营销导航。

### Status Message
状态消息是本系统的关键组件。错误使用 `role="alert"` 与 assertive live region；成功、信息、警告使用 `role="status"` 与 polite live region。视觉上使用 16px 圆角、状态色边框、状态色浅表面和状态色文字，并保持标题/正文两级信息结构。

### Recording Control
录音按钮是工作台的签名组件。默认状态使用 `action-record` 相关琥珀色，录音中切换为 `action-record-active` 并使用反白文字。必须同时支持鼠标按住、触屏按住、键盘按一次开始再按一次结束，并用 live status 文案同步当前状态。

## 6. Do's and Don'ts

### Do:
- **Do** 先组织任务链路，再组织装饰：登录后页面必须围绕“个人建声 + TTS”双任务展开。
- **Do** 使用 `app-card`、`app-panel`、`app-input`、`app-button-primary`、`app-button-secondary` 作为默认界面基元。
- **Do** 让关键状态直接说明任务是否可继续，例如“建声完成”“语音合成完成，可直接播放或下载”“录音不足 5 秒”。
- **Do** 保持浅色、低干扰、面向完成的语气；说明文字必须短，且指向下一步动作。
- **Do** 为每个交互控件提供可见 focus-visible 样式，焦点环使用 `action-secondary` 而不是弱灰边框。
- **Do** 在移动端让表单控件纵向堆叠，并保证危险操作和主按钮至少 44px 高。
- **Do** 修改 Tailwind token 后同步更新本文档 front matter 与 Colors / Elevation / Components 章节，避免文档重新变成旧实现快照。

### Don't:
- **Don't** 把首页扩展为宣传首页、品牌故事页、行业方案页或销售导向 landing page。
- **Don't** 在注册页加入未经确认的营销区、客群分层区、套餐引导区。
- **Don't** 把设置页扩展为复杂账户中心；当前只允许密码管理相关内容。
- **Don't** 出现多用户、团队、组织、审批、协作相关 UI 暗示。
- **Don't** 出现价格、套餐、权益、会员、企业版等商业化 UI 暗示。
- **Don't** 使用过强营销语气、拟人化陪伴表达、夸张承诺或缺乏任务指向的情绪化欢迎语。
- **Don't** 使用玻璃拟态、渐变文字、hero metric 模板、重复同尺寸图标卡片网格或装饰性大面积渐变。
- **Don't** 用半透明白卡和 blur 作为默认容器；这里需要清楚的任务分区，不需要氛围滤镜。
- **Don't** 在页面中绕过语义 token 直接使用 `slate`、`amber`、`emerald`、`rose`、`white` 等硬编码色阶，除非是在一次性迁移过程中临时定位旧实现。
