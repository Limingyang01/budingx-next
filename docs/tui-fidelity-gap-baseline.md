# TUI 还原度差距基线（对照参考仓 buding-worker-space）

状态：r1｜更新：2026-11-18｜配套：[参考复刻排查](reference-tui-replication-audit.md)、[路线图](iteration-plan.md)

## 1. 目的

用户 2026-11-18 指示：已做 3 个 SP，功能还原不理想，要针对旧仓 `buding-worker-space` 还原能力——除特色化功能调整外，**能力要相同，TUI 的布局 / UI / 交互都要还原**。

本文件把「还原度」变成可量化的工程目标：先定**可比口径**（不跑旧仓、只对照行为与结构事实），再定**优先级**（按用户可见权重排序，而不是按旧仓目录顺序），最后定**落地机制**（哪些机制必须自研扩展、哪些按公开来源实现）。

依据沿用 [独立实现与复用边界](independent-development.md) 与 SP001 决定 3：**读机制、不抄代码**；效果口径沿用 O5=B：自有测量 + 能力清单覆盖度，**禁用「已对齐/同等效果」措辞**。

## 2. 规模事实（只读盘点）

| 维度 | 参考仓 | 本仓（现状） | 倍率 |
| --- | --- | --- | --- |
| src 下 `*.ts`/`*.tsx` 文件数 | 2360 | 约 130（不含 dist） | ≈18× |
| src 代码行数 | ≈167,157 | ≈9,073 | ≈18× |
| `src/components` 组件数 | 149 | 0（布局逻辑内联在 app.tsx / render/*） | — |
| `src/commands` 命令目录 | 60+ | 12 个内联命令 | ≈5× |
| `src/tools` 工具目录 | 50+（34 族真实实现） | 0（工具在 `src/workspace`） | — |
| `src/keybindings` 键位系统 | 11 文件 | 1 文件（`editor/keys.ts`） | ≈11× |
| `src/ink` 自研渲染层 | 60+ 文件 | 0（直接用上游 Ink 8） | — |

**结论**：差距不在「补几个功能点」，而在**缺一层结构**。逐文件追平参考仓不可行（且违反不抄代码边界），必须以**用户可见行为**为单位重建结构。

## 3. 差距分层（按用户可见权重）

### L1 布局与视觉骨架（最高权重，最影响「像不像」）

参考仓的 TUI 不是「聊天窗口 + 输入框」，而是自研渲染层 `src/ink`（reconciler + Yoga 布局 + log-update 差分 + OffscreenFreeze 冻结缓存）之上的多层结构：

| 区域 | 参考仓实现 | 本仓现状 | 差距 |
| --- | --- | --- | --- |
| 首屏欢迎框 | `LogoV2/WelcomeV2.tsx`(438) + `LogoV2.tsx`(542) + 8 个提示位组件 | `render/header.ts`(318) 单文件静态框 | 缺：tips feed 列、condensed 横幅、多终端尺寸分支、mascot 动效 |
| 消息区 | `Messages.tsx`(833) + `MessageRow` + `VirtualMessageList` + `OffscreenFreeze` + 折叠汇总 | `render/reducer.ts`(212) 行式渲染 | 缺：折叠汇总行（Read N files / Searched N patterns）、虚拟列表、冻结缓存 |
| 输入区 | `PromptInput.tsx`(**2333**) + 18 个附属组件 | `app.tsx`(832) 内联 + `editor/buffer.ts`(216) | 缺：footer 三段布局、模式指示、队列提示、stash 提示、帮助菜单 |
| 页脚 | `PromptInputFooter.tsx`(190) + `FooterLeftSide` + `FooterSuggestions` + `StatusLine.tsx`(333) | `app.tsx` 内联提示行 | 缺：左/中/右三段、权限模式徽标、后台任务计数、上下文百分比 |
| 工具卡片 | `FileEditToolDiff`、`StructuredDiff`、todo 卡片、审批卡 | `render/diff-view.ts`(60) + `approval.ts`(41) | 缺：todo 卡片、工具卡片族、gutter 行号、着色 |
| 状态栏 | `StatusLine.tsx` 可执行 command + 13 字段 JSON 契约 | 无 | 全缺 |

### L2 交互契约（决定「用起来像不像」）

| 面 | 参考仓机制 | 本仓现状 |
| --- | --- | --- |
| 键位系统 | 18 个上下文块、约 90 个 action、chord（`ctrl+x ctrl+k`）、`command:` 引用、保留键校验（ctrl+c/d/m 不可重绑）、提示随重绑动态变化 | 单一 `applyKey` 映射，无上下文、无 chord、无用户重绑 |
| 补全 | 统一 typeahead，最多 5 条 overlay，图标区分，LCP，目录续补，`@`/`/` 同源 | `render/completion.ts`(169) 有基础版，缺 overlay 视觉与 LCP 语义 |
| 输入编辑 | readline 键族、kill-ring/yank-pop、ctrl+r 内联历史搜索、undo 防抖双绑定、bracketed paste + 万字截断占位符、ctrl+s stash、ctrl+g 外部编辑器、U0001f5dd bash 模式、ghost text | `editor/buffer.ts` 有基础键，缺历史搜索、stash、外部编辑器、bash 模式、粘贴截断 |
| 折叠/转录 | ctrl+o 转录、ctrl+e 全展开、thinking 折叠、折叠汇总动词变化 | 无 |
| Vim | INSERT/NORMAL 两模式、11 态命令机、motion/operator/文本对象、dot-repeat、`-- INSERT --` 页脚 | 无 |

### L3 能力面（功能等价）

- **斜杠命令**：参考 60+ 目录、三型契约（`local` / `local-jsx` / `prompt` + `progressMessage`）、注册表驱动、feature 门控。本仓现为内联 switch + 两个面板（models/rules），无注册表、无三型契约、无统一 `local-jsx` 模态槽。用户清单 18 项 + /models 的逐项排期见 [TUI 命令路线图](tui-command-roadmap.md)（2026-11-20）。
- **工具**：参考 34 族真实工具 + 50 个工具目录。本仓 `src/workspace` 提供 5 个文件工具，**零** Agent 工具（Task/Agent/Todo/Plan/AskUserQuestion 等）。
- **Agent 主循环**：参考有 plan 模式、工具回合、子代理、后台任务六件套、todo 状态机。本仓 `src/core` 有基本回合，无计划模式、无 todo、无子代理。

## 3.6 master 前进后的基线修订（2026-11-18 晚间）

本文件初稿基于 master `8556ba4`。此后 master 已推进到 `e808679`（0.3.5 已发布、0.3.6 候选），新增 **30 个提交**，其中多项直接落在我原列的 P0 缺口上。**基线按当前 master 事实修订如下**，避免拿过时差距做计划。

| 原基线所列缺口 | master 现状（`e808679`） | 修订后结论 |
| --- | --- | --- |
| 消息区：折叠汇总 | `src/tui/render/history-window.tsx` 有 `collapseReadSearch`（≥2 次 read/search 折叠为汇总行，提示 Ctrl+O 展开） | **已完成** |
| 消息区：虚拟列表 | `history-window.tsx` 有 `visibleHistoryRange` + `virtualThreshold = 64`（fullScreen 且条目 ≥64 时按视口切片） | **已完成**（冻结缓存仍缺） |
| 折叠/转录：Ctrl+O 转录 | `src/tui/render/transcript.tsx` 独立转录视图，`app.tsx` 有 `transcriptMode` | **已完成** |
| 工具卡片：diff 着色 | `src/tui/render/diff-view.ts` 引入 `lowlight`（新增运行时依赖） | **已完成** |
| 输入区：Markdown 渲染 | `transcript.tsx` 引入 `marked`（gfm） | **已完成** |
| 输入区：鼠标滚轮 | `src/tui/editor/mouse.ts` 有 `useWheel`（SGR 1000/1006 协议） | **已完成**（属原 R-A 可选项，已提前交付） |
| 消息区：冻结缓存（OffscreenFreeze 等价） | 全仓无 `offscreen` / `freeze` 缓存实现 | **仍缺** |
| 帧缓冲差分（只重绘变化行） | 无独立帧缓冲层；依赖 Ink 输出 | **仍缺** |
| 键位：上下文分发 + chord + 保留键校验 | `src/tui/editor/keys.ts` 仍为单表映射，无 context/chord/保留键概念 | **仍缺** |
| 状态栏：可执行 command + 13 字段 JSON 契约 | 无 statusline 实现 | **仍缺** |
| 命令面：三型注册表 | `src/tui/commands.ts` 仍为内联 if-else + `CommandOutcome` | **仍缺** |
| 工具族：34 族 Agent 工具 | `src/workspace` 仍为 5 个文件工具；`src/core` 有基本回合 | **仍缺**（属 SP004/SP007） |
| 面板类命令（/config /permissions /theme /model 等） | `model-manager.tsx` 有模型面板，但无统一模态槽与设置面板骨架 | **部分** |

**修订后的 P0 剩余项**（SP006 出口仍以此为准）：① 消息区冻结缓存；② 帧缓冲差分；③ 上下文键位系统（含 chord 与保留键校验）；④ 状态栏可执行契约；⑤ 四区骨架收口（首屏/输入区/页脚仍需与参考对齐）。已完成的折叠汇总、虚拟列表、转录、Markdown、diff 着色、鼠标滚轮**从 P0 缺口清单移出，转入「已有能力」基线**。

**新增依赖登记**：master 为会话 Markdown 与 diff 着色引入 `marked@18.2.1`、`lowlight@3.3.0`（运行时依赖，非开发依赖），已在 master 的 `THIRD-PARTY-NOTICES.md` 与 `src/tui/package.json` 登记。本分支合并 master 后同步这两项依赖；**本轮还原度工作不新增任何运行时依赖**。
## 4. 落地机制：四条周旋路径

按 [独立实现边界](independent-development.md) 与排查文档 §6 总则，对参考仓依赖自研/私有组件处换方式达同效：

### M1 渲染层：单模式自研扩展（不做 fullscreen 虚拟列表）

参考的 `src/ink` 是自研 reconciler + NAPI Yoga + log-update 差分 + 冻结缓存 + 备用屏 + SGR 鼠标，共 60+ 文件。**整层搬运既越界又不可控**。

复刻路径：
- 保留上游 Ink 8 作为布局引擎（已验证、MIT）。
- 在 `src/tui/render` 内自建**受控扩展层**：① 帧缓冲差分（只重绘变化行，消除闪烁）；② 冻结缓存（等价 `OffscreenFreeze`，长会话不重排）；③ 虚拟列表（等价 `VirtualMessageList`，按视口窗口渲染历史消息）。
- **明确降级**：备用屏、鼠标选区（1002/1003）、kitty 键盘协议 → 归入「受控扩展预算（R-A）」，列为可选，不进主路径。
- 判定依据：用户可见权重最高的是「首屏 + 消息区 + 输入区 + 页脚」的骨架与滚动观感，不是鼠标选区。

### M2 键位系统：上下文分发 + chord，自写

- 自写 `src/tui/keybindings`：上下文块（Global / Chat / Autocomplete / Confirmation / Help / Transcript / HistorySearch / Task / Settings / Tabs / Select / DiffDialog / ModelPicker / Footer / Scroll…）+ 键→action 解析 + chord 前缀状态机 + 保留键校验 + `command:<slash>` 引用 + 用户 `keybindings.json` 覆盖。
- 表面与参考一致（`bindings[]{context, bindings}`），实现独立。

### M3 命令面：注册表 + 三型契约

- 自写 `src/tui/commands` 注册表，把现有 12 个内联命令迁入；三型：`local`（内联文本）/ `local-jsx`（模态槽对话框/面板）/ `prompt`（展开为模型提示 + `progressMessage`）。
- `local-jsx` 是参考里「/config /permissions /hooks /theme /model /resume」等面板类命令的统一机制；本仓要还原这些面板就必须先有模态槽。

### M4 工具与 Agent 主循环：按公开契约自写

- 工具族按参考的**行为事实**（输入 schema、输出形状、审批语义、卡片表现）自写：TodoWrite、AskUserQuestion、EnterPlanMode/ExitPlanMode、Agent（子代理）、TaskCreate/Get/List/Update/Output/Stop（后台任务六件套）、SendMessage、Skill、WebFetch/WebSearch。
- 工具卡片是 L1 布局的一部分（todo 卡片 ✔/■/□ + blocked by、审批三档、diff gutter 行号），必须与工具实现同步落地，否则还原度只到骨架。

### M5 差异着色与状态栏：公开来源 + 自写

- diff 着色：参考用 NAPI Rust；改用 JS 高亮（`shiki` 或 `prismjs` 风格自研） + 无色降级；hunk 结构与 gutter 行号按行为事实自写。
- statusline：参考是「外部 command + stdin JSON（13 字段）」；本仓自写同契约（model / workspace / version / output_style / context 百分比 / rate_limits / session_name / vim 模式）。

## 5. 优先级排序（按「用户一眼能看出」的权重）

| 优先级 | 批次 | 内容 | 判定还原度 |
| --- | --- | --- | --- |
| P0 | **骨架对齐** | 首屏欢迎框 + 消息区（折叠汇总 + 虚拟列表 + 冻结缓存）+ 输入区三段 footer + 状态栏 + 工具卡片族（todo/审批/diff/结果） | 截图并排可判 |
| P0 | **键位契约** | 上下文键位系统 + chord + 保留键 + 提示随重绑变化 | 交互序列可判 |
| P1 | **命令注册表** | 三型契约 + 注册表 + 面板类 `local-jsx` 命令（/config /permissions /theme /model 等） | 命令面清单可判 |
| P1 | **输入编辑完整性** | 历史搜索、stash、外部编辑器、bash 模式、粘贴截断、ghost text | 交互序列可判 |
| P2 | **工具与主循环** | TodoWrite / Plan 模式 / AskUserQuestion / 子代理 / 后台任务六件套 | 能力清单可判 |
| P2 | **折叠与转录** | ctrl+o / ctrl+e / thinking 折叠 / 汇总动词变化 | 交互序列可判 |
| P3 | **Vim / 鼠标 / 备用屏** | 独立可选模块，R-A 预算内做 | 明确标为可选 |

## 6. 「还原度」的可比口径（防自欺）

禁用「已对齐」「同等效果」（SP001 O5=B）。本仓采用：

1. **结构覆盖率**：以参考的**用户可见表面清单**为分母（首屏区、消息区、输入区、页脚区、命令面、工具面、键位面），逐项记 PASS / PARTIAL / MISS，公布覆盖率。
2. **行为用例**：每个交互写「按键序列 → 期望可见结果」的可执行用例，作为回归基准；不比对旧仓二进制输出，只比对**我们自己定义的行为事实**。
3. **截图/帧基线**：首屏与关键状态存基准帧（我们自己的），做差分回归；不声称与旧仓像素一致。
4. **能力清单覆盖度**：沿用 SP001 能力清单 v1.3 的 47 项必交分母，不扩分母、不降门槛。

## 7. 与现有 SP 的关系

- **不新增 SP 编号**：还原度提升是 SP001–SP016 的横向要求，不另立迭代号。
- **落点**：
  - P0 骨架 + P1 命令注册表 + 键位系统 → 主要落在 **SP006「日常开发与 TUI 候选」**（该轮出口门槛已含「TUI 中文/多行/快捷键/终端 resize」）。
  - 工具族与主循环 → **SP004（计划/任务/命令执行）+ SP007（子代理/诊断）**。
  - 折叠/转录/状态栏 → SP006。
  - Vim/鼠标/备用屏 → R-A 预算，SP006 末段或 SP015。
- **本文件不授权开发**；实施须在对应轮次开轮时按 SDD 流程写入需求/设计/计划。

## 8. 风险

| 编号 | 风险 | 处置 |
| --- | --- | --- |
| R-F1 | 参考副本为 local recovery build，部分工具目录是生成 no-op stub（`__stubMissing`），照抄 stub 目录名会得到无实现的「空能力」 | 工具只按**行为事实**立项；stub 目录不作为能力来源 |
| R-F2 | 直接搬 `src/ink` 越界（不抄代码 + 无许可） | 只搬**机制**；渲染层自研扩展（§4 M1） |
| R-F3 | 追求像素级一致与「还原」冲突，可能诱导复制旧实现 | 以结构覆盖率 + 行为用例为准；明令不复制 |
| R-F4 | 18× 规模差导致 P0 也做不完就宣称完成 | P0 单独设出口门槛，未过不进入 P1 |
| R-F5 | 长会话渲染性能劣化（自研扩展引入） | 冻结缓存 + 虚拟列表为 P0 强制项，性能基线纳入回归 |
| R-F6 | 参考的 7 权限模式与我们固定 3 模式冲突 | 保留三模式，参考 7 模式仅作安全底线语义来源（deny 规则/凭据保护），不还原模式数量 |
