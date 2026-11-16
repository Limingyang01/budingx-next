# O8 选型调研 · Ink 路线证据报告（内部件）

来源：2026-11-16 调研子代理（npm registry + GitHub API 取证，raw.githubusercontent 网络受限未用）；评估基准 **ink 8.0.0（2026-10-03）**。仅用于 SP002 设计评审（TC-01 输入）；UNVERIFIED 项不得写成结论。

## ① 逐项结论（L1 = 能力清单 CAP-L1-*）

| 项 | 结论 | 关键证据（访问日 2026-11-16） | 含义 |
|---|---|---|---|
| L1-01 flexbox 布局 | PASS | Yoga 引擎；依赖 yoga-layout ~3.2.1（WASM，MIT，未打包 224KB）；百分比尺寸不支持（yoga#872） | 布局成熟；聊天 UI 基本不需要百分比 |
| L1-01 ANSI 正确性 | PARTIAL（持续修复） | 宽字符撕裂 #929（已关）；Windows stale frame PR #971（已合）；CSI 3J #935（已关）；diff 管线基于 @alcalzone/ansi-tokenize | 高频场景（满屏/宽字符/Windows）曾有集中缺陷，靠回归测试兜底 |
| L1-01 键盘/鼠标 | 键盘 PASS；鼠标 FAIL | useInput 不投递鼠标报告（README 1739 行）；Kitty 键盘协议 v6.7.0+ opt-in（#855/#866/#895） | 鼠标滚轮/点击需完全自接 SGR 追踪（首发可砍） |
| L1-01 备用屏 | PARTIAL | v7.0.0 新增 render({alternateScreen})（#263）；alt-screen 光标归位 #1113/#1114 open（2026-11-15/16）；resize 重绘 #1103/#1106/#1107 刚合 | 功能新（约 7 个月），边缘 bug 周级修复中，跟进成本要预留 |
| L1-02 多行输入编辑 | **FAIL（需自研）** | 无输入编辑组件；#676/#660 open；ink-text-input 单行；@inkjs/ui TextInput 单行且 2024-05 后停更、未适配 ink 8 | 多行编辑器（光标/选区/撤销/历史/输入法适配）为最大自研块，数千行级 |
| L1-03 文本粘贴 | PASS（v7.0.0 起） | usePaste 自动开 bracketed paste（ESC[?2004h），整段送达；PR #1110 | 「大段粘贴 vs 回车」核心痛点官方已解；6.x 无 |
| L1-04 CJK/IME/宽度 | PARTIAL | string-width@9/widest-line@6（grapheme+EAW）；CJK 撕裂 #929 已修；**IME issue #759 open（2025-08-30 起，仅 3 评论）**；useCursor 6.7.0 提供 IME 定位 | 静态渲染可靠；**打字 lag/丢字必须 Windows Terminal + ConHost 双端实测**（Go/No-Go 项）；ConHost IME 组合串行为 UNVERIFIED |
| L1-05 输入历史/搜索 | FAIL（确认无） | hooks 清单无相关能力 | 自研（纯业务逻辑，小-中） |
| L1-14 resize/虚拟滚动/流式性能 | PARTIAL | resize hooks 近期集中修复；**每帧全量 tokenize 性能 issue #1032 open（2026-09-24）**；maxFps 默认 30；incrementalRendering 8.x 提供；无内建虚拟滚动（ink-virtual-list@0.3.0 低频维护）；Static 为 append-only | 高 token 速率是已知软肋；官方姿势 throttle+Static+增量渲染；滚动视口需自建 |
| L1-15 非 TTY/NO_COLOR | 非TTY PASS；NO_COLOR FAIL | interactive 模式自动降级（CI/非 TTY）；v8 起可传任意流；chalk 6.0.1 vendored supports-color 无 NO_COLOR 逻辑（源码 grep） | 管道行为明确可测；NO_COLOR 产品侧几行 shim |

工程项：

- **版本/节奏**：latest 8.0.0（2026-10-03）；12 个月 15 版；7.0.0 起强制 Node 22。
- **维护**：pushed_at 2026-11-13；周吞吐 8 PR/issue；40,280 stars；open issues 36；维护以 sindresorhus + costajohnt 为主，极活跃。
- **许可**：ink MIT。
- **运行时**：engines >=22 精确吻合；纯 ESM 无 CJS 层。
- **Windows/ConHost**：无 ConHost 打不开类 issue；Windows 缺陷集中修复且有 weekly Windows 测试 PR #1073；**ConHost 下 IME/alt-screen/kitty 探测无一手实测 = UNVERIFIED，须 spike**。
- **退出健壮性**：v8 明确恢复光标策略；#1067（signal-exit@4 场景）open；泄漏风险中低。
- **生产背书**：官方「Who's Using Ink」列有 Claude Code——同量级流式编码 TUI 已上线（其输入层实现闭源，UNVERIFIED）。

## ② 依赖树与许可（ink 8.0.0 直接依赖，registry 逐项核）

全部 ∈ {MIT, ISC, CC0}：yoga-layout(MIT 224KB)、react-reconciler(MIT 1.85MB)、react>=19.3(peer)、chalk/ansi-styles/wrap-ansi/ansi-escapes/cli-boxes/cli-cursor/cli-truncate/string-width/widest-line/indent-string/code-excerpt(均 MIT)、@alcalzone/ansi-tokenize(MIT)、es-toolkit(MIT，#1059 后可 tree-shake)、type-fest(MIT/CC0 类型)、signal-exit@3(ISC)、is-in-ci/auto-bind/patch-console/quick-lru/terminal-size/stack-utils(MIT)。ink 本体 620KB；无原生编译（yoga 为 WASM，Win x64/arm64 通用）。

## ③ 采用 Ink 还须自研（规模感受）

1. 多行输入编辑器（最大块，数千行级 + 边界测试）；2. 流式渲染管道（合帧 ≤maxFps、live 区 vs Static 落屏、内存上界；#1032 未关）；3. 滚动视口/回看虚拟化；4. 鼠标（可首发砍掉）；5. NO_COLOR shim；6. **CJK/IME 双端实测回归脚本（小工作量、高风险、Go/No-Go）**；7. 信号/崩溃下终端恢复自检；8. 输入历史/搜索。

**Errata（2026-11-16，builder 实包复核 ink@8.0.0 / chalk@6.0.1 tarball）**：① ink 8.0.0 实际依赖 `string-width@^8.3.0`（本文写作 9）；② chalk 6.0.1 vendored supports-color **已处理 `FORCE_COLOR`/`TERM=dumb`**（本文 L1-15 行「NO_COLOR 缺失」属实）。其余断言经 tarball 核对属实；登记 THIRD-PARTY-NOTICES 时以实包 lockfile 版本为准。

## ④ 调研代理建议

**可行（有条件）**；推荐 2-3 天级 Windows spike 实测后再签设计。关键风险排序：①CJK/IME 打字体验（#759）；②多行编辑器全自研为确定成本，恰是核心 UI；③alt-screen×resize 边缘 bug 周级变动，升级即回归；④高 token 速率性能（#1032，200-500 tok/s 观感需原型验证）；⑤ConHost UNVERIFIED + React 19 peer 约束。
