# tui-conversation · STATUS

1. **目标与版本**：[需求 v0.1（已批准）](requirements.md)（AC TC-01…08；TC-01 已依 U5 关闭为 Ink 8）；[设计 v0.3 approved](../design/design.zh.md)（本需求相关：§3.6、§3.7 证据链）；[实施计划](../design/plan.zh.md) T8–T11；[验证报告](../test-report.md)。
2. **阶段清单**：需求 ✅ → 设计 ✅（2026-11-16 批准）→ 计划 ✅ → 实施 ✅ → 测试 ✅ → 交付 ✅（本地提交并推送功能分支）。O8 调研/spike 经用户豁免（U5）；CJK/IME 由真终端 smoke 承接（设计 §7-R1，不达标回退自研输入层）。
3. **用户决定**：U1/U3/U4 同前；**U5 原话「没有版权问题你直接使用一样的即可，无需再调研」**（O8 关闭依据）；通用许可义务（NOTICES 登记、仅限渲染层）仍有效；2026-11-16「继续SP002,我批准了设计」。
4. **执行记录**：实现于 `src/tui/{cli.ts,app.tsx,approval.ts,commands.ts,editor/*,render/*}`，运行时依赖钉扎 `ink@8.0.0` / `react@19.3.1` / `string-width@9.0.0`（均 MIT，已登记 `THIRD-PARTY-NOTICES.md`，仅限渲染层）。多行编辑器自研（`EditorBuffer`，光标按 code point，中文/emoji 不错位），渲染 reducer 纯函数，审批卡 claim-once。验证：TUI 相关 38 项（cli 5 + commands 10 + editor 9 + render 6 + approval 3 + package 5）全绿；打包隔离安装 smoke 通过（tarball 30 文件、仓库外安装、真实流式请求）。**真终端人工项（TC-02/03/04/05/07 的 Windows Terminal + ConHost 部分）记 UNVERIFIED**，清单见报告 §5。
5. **下一轮**：用户验收时按报告 §5 补人工证据；若 CJK/IME 打字体验不可接受，按设计 §7-R1 回退自研输入层（事件契约解耦，只替换 tui 层）。
