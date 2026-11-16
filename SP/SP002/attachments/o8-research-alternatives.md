# O8 选型调研 · 替代路线证据报告（内部件）

来源：2026-11-16 调研子代理；取证 = npm registry 直查 + `npm pack` 解包读 LICENSE/源码 + WebSearch；github.com 页面被网络策略拦截处以 registry 数据与包内文件代替。Ink 路线另见 [o8-research-ink.md](o8-research-ink.md)。本报告为 TC-01 输入；spike 前不构成选型结论。

## ① 路线 × 能力结论（口径：CAP-L1-01/02/03/04/05/15）

### A. terminal-kit 3.1.4（MIT，2026-07-19，维护属实）
- L1-01 PASS（低层 ANSI + 高层 Document/Element 28 组件）；布局仅 columns/rows 盒式，**无 flexbox**（全包 grep "flex" 0 命中）。
- L1-02 PARTIAL：单行 inputField 完整；多行 EditableTextBox 存在但质量未实测。
- L1-03 **FAIL：无 bracketed paste**（lib/ grep `bracketed|2004|200~` 0 命中）。
- L1-04 PARTIAL：TextBuffer 有全角双宽处理；IME 无证据。
- L1-05 PASS：inputField 自带 history + UP/DOWN/Ctrl-R。
- L1-15 PARTIAL：非 TTY 不崩但降级粗糙。
- 依赖 8 个含图像处理栈（get-pixels/chroma-js/ndarray），违背「依赖越少越好」；Windows/ConHost UNVERIFIED。

### B. blessed 0.1.81（2015 停摆）/ neo-blessed 0.2.0（2018）/ reblessed 0.2.1（2023）
- **GPL 双授权疑点查实：不成立**——npm 发布物 tarball 内 LICENSE 纯 MIT（chjj 版权头）、README 与 registry license 字段均 MIT；WebSearch 无 GPL 证据（疑似与 jQuery 记忆混淆）；chjj 原 repo 因网络拦截未直读，残余风险标注。
- Windows 硬伤：blessed README 自认 Windows 无 mouse/resize 事件。
- 判定：**三条全部因维护停摆出局**。

### C. @inquirer/core 12.1.0 / @clack/* 1.6.0/1.9.0（MIT，2026-11 活跃）
- 证据：inquirer core 是 readline 包装、await 逐题形态；clack 有 multiline() 与 stream API（README 注明用于 LLM 流式）。
- **判定：「提示词级问答/向导」框架，无整屏常驻分区+持久输入框的文档模型 → L1-01 作为整屏应用 FAIL，独立路线出局**；其零件（useKeypress hooks、clack multiline）可作 E 路线输入层候选（UNVERIFIED）。

### D. 其他
- **@opentui/core 0.9.1**（MIT，极活跃）：Zig 原生渲染核 + flexbox + win32 预编译；「依赖 Bun」疑点**部分属实但已解绑**——README：Bun>=1.3.14 **或 Node>=26.4**（ESM）。→ Node 下限高于本项目 22，**本轮出局，列观察名单**。
- **@mariozechner/pi-tui 0.73.1**（MIT，2026-05-07，engines node>=20）：README 逐条命中本项目形态——差分渲染三策略、CSI 2026 同步输出防闪烁、bracketed paste、**IME 候选窗定位接口（Editor/Input 已实现）**、常驻 Editor.onSubmit、Text/Markdown/Loader、slash/文件补全；作者自用终端编码 agent（badlogic/pi-mono）；依赖仅 5 个（chalk、marked、get-east-asian-width、mime-types+types）全 MIT 系。→ **D 中唯一强候选**；0.x API 稳定性与 ConHost 实测 UNVERIFIED。
- termual：npm 404 不存在，排除；oterm：浏览器终端仿真器错类别，排除；micro：Go，排除。

### E. 自研增强（raw + MIT 小件）
- 清单件全部 2026-11-16 registry 验证：string-width 9.0.0、get-east-asian-width 1.7.0（替代停滞的 east-asian-width 0.1.1——后者 license URL 指向第三方仓库，异常勿用）、ansi-escapes 7.3.0、wrap-ansi 10.0.2、slice-ansi 10.0.1、cli-truncate 6.2.0、picocolors 1.1.1(ISC)、diff 9.0.0(BSD-3)。许可全绿。
- 必须自研：渲染差分+同步输出（最大件）、Line 编辑+IME 光标、bracketed paste、ConHost VT 启用（ENABLE_VIRTUAL_TERMINAL_PROCESSING **纯 Node 无原生 API 暴露，无 native 路径 UNVERIFIED，spike 关键**）。
- node:readline（v26 文档）已有 `bracketedPaste` 与 `history` 选项；Node>=22 下限实际可用性 UNVERIFIED（间接证据：gemini-cli issue #2474 称 node<20 不工作）。
- 本地预览版 `src/tui` 缺口（只读盘点）：已有流式直写/SIGINT 中断/slash 分发/ANSI 消毒/非 TTY 行模式降级/--prompt；缺多行编辑/IME/粘贴标记/CJK 宽度/历史持久化/输出输入互斥与状态区/Windows VT 启用。沿 E 升级 ≈ 输入层+渲染层全部；引入 pi-tui 可一次覆盖 4/6。

## ② 许可与维护风险

见各节内联；全候选许可 ∈ {MIT, ISC, BSD}，无 GPL 传染实据（blessed 疑点已排除）。

## ③ 各路线还须自研（粗粒度）

- A：粘贴(中)+常驻多行输入打磨(中高)+Document 层驯服到流式共存(中) ≈ 3 中块。
- B：全自研还背 16k 行死代码 → 最差。
- C：整屏渲染全自研却受 prompt 生命周期束缚，不划算（零件除外）。
- **D pi-tui：仅 ConHost 适配验证(低-中)+历史持久化(低)+agent loop 接线(低)——最薄。**
- E：渲染引擎(大)+Line 编辑 IME(大)+粘贴(中)+宽度(小)+VT(小-中,未证)+历史(小) ≈ 6 块含 2 大块。

## ④ 调研代理推荐（spike 排序）

1. **pi-tui（首选）**：形态逐项对口、MIT、纯 Node>=20；spike 验 Windows Terminal & ConHost 实跑（VT/resize/粘贴）、0.x API 稳定性、marked/chalk 可否绕开。
2. **E 混合自研（次选）**：现有骨架上 raw stdin + ansi-escapes + get-east-asian-width 最小原型；spike 验 ConHost VT 无 native 路径、readline bracketedPaste/history 可用性、多行编辑成本。两 spike 共用 Windows 手工验收脚本。
- terminal-kit 仅当 pi-tui Windows 崩盘且 E 过贵的替补；B/C 不入围。

主要证据源：registry.npmjs.org/<各包>（2026-11-16，含 tarball 内文件）、nodejs.org/api/readline.html、github.com/{chjj/blessed, badlogic/pi-mono, anomalyco/opentui, SBoudrias/Inquirer.js, natemoo-re/clack, google-gemini/gemini-cli/issues/2474}。
