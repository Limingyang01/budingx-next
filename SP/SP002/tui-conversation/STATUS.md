# tui-conversation · STATUS

1. **目标与版本**：[需求 v0.1（已批准）](requirements.md)（AC TC-01…08；TC-01 已依 U5 关闭为 Ink 8）；[设计 v0.3 approved](../design/design.zh.md)（本需求相关：§3.6、§3.7 证据链）；[实施计划](../design/plan.zh.md) T8–T11；[验证报告](../test-report.md)。
2. **阶段清单**：需求 ✅ → 设计 ✅（2026-11-16 批准）→ 计划 ✅ → 实施 ✅ → 测试 ✅ → 交付 ✅（本地提交并推送功能分支）。O8 调研/spike 经用户豁免（U5）；CJK/IME 由真终端 smoke 承接（设计 §7-R1，不达标回退自研输入层）。
3. **用户决定**：U1/U3/U4 同前；**U5 原话「没有版权问题你直接使用一样的即可，无需再调研」**（O8 关闭依据）；通用许可义务（NOTICES 登记、仅限渲染层）仍有效；2026-11-16「继续SP002,我批准了设计」。
4. **执行记录**：实现于 `src/tui/{cli.ts,app.tsx,approval.ts,commands.ts,editor/*,render/*}`，运行时依赖钉扎 `ink@8.0.0` / `react@19.3.1` / `string-width@9.0.0`（均 MIT，已登记 `THIRD-PARTY-NOTICES.md`，仅限渲染层）。多行编辑器自研（`EditorBuffer`，光标按 code point，中文/emoji 不错位），渲染 reducer 纯函数，审批卡 claim-once。验证：TUI 相关 38 项（cli 5 + commands 10 + editor 9 + render 6 + approval 3 + package 5）全绿；打包隔离安装 smoke 通过（tarball 30 文件、仓库外安装、真实流式请求）。**真终端人工项（TC-02/03/04/05/07 的 Windows Terminal + ConHost 部分）记 UNVERIFIED**，清单见报告 §5。
5. **交付后补充（2026-11-17）**：首屏头部落地（`src/tui/render/header.ts` + 单测）——版本、模型、端点主机、密钥状态与工作目录，未配置时持续显示 `/provider add` 引导；`/model` 切换经 UI 状态计数即时重渲头部，密钥原文不进入 UI 状态。同步更新 `PRODUCT.md` §5.3。工作区遗留 `pnpm-lock.yaml` 为环境性产物（本机 pnpm 安装所致），本仓发布链为 npm（根 `package-lock.json` + `npm ci`），**不纳入提交**，待用户确认后删除。
6. **首屏样式对照重做（2026-11-17，用户反馈）**：按参考仓 LogoV2 布局机制独立重绘（紫 `#af87ff` 圆角框、顶边框嵌名/版本、双栏+dim 竖线、<70 列紧凑、配置后精简横幅、win32 老终端纯 ASCII 兜底、env 强制覆盖）；上游 Ink 无 borderText，框线以纯 styled-span 行绘制；吉祥物同槽位自有绘制，不搬旧仓美术。测试 4 → 9 项，unit 107 → **112 全绿**，smoke PASS（33 文件）。证据见 [报告 §10](../test-report.md)。
7. **交互面中文化（2026-11-17，用户原话「文案你给我替换成中文吧，除了必须用英文的地方，其余换成中文」）**：pixel 交互面中文（首屏/状态行/提示/审批/排队/命令回显与 /help，`lang='zh'`）；ASCII 兜底屏与管道/机器面保持英文（缺省 `lang='en'`，既有英文测试不回归）；命令语法/env/标识符/错误码英文。header 测试 9→10、新增 commands-zh 5 项；unit 112→**118 全绿**，smoke PASS。证据见 [报告 §11](../test-report.md)。模型行取自配置（SP002 MM-03 已实现）；服务端拉模型列表不在本轮 AC、未排期。
8. **下一轮**：用户验收时按报告 §5 补人工证据；若 CJK/IME 打字体验不可接受，按设计 §7-R1 回退自研输入层（事件契约解耦，只替换 tui 层）。

## 2026-11-17 缺口收尾

按用户要求补齐报告中本模块相关缺口，详见 [验证报告 §12](../test-report.md#12-2026-11-17-缺口收尾g01g17) 与 [实施计划](../design/gap-closure-plan.md)。历史 PASS 保留当时覆盖范围；当前代码与新增回归不替代 live Provider 或真实终端人工验收。验收、版本准备和发布状态未因本次修复自动改变。

2026-11-17 e2e/真实 Provider 回执见 [报告 §16](../test-report.md#16-真实模型与扩展端到端验证2026-11-17)：真实模型流式、工具审批回合、取消与鉴权错误通过；clear 可见内容同步及工具参数 schema 传递已修复。L3 真终端人工仍 UNVERIFIED，不把流测试当成人工验收。
