# 验证报告：SDD 委托扩展 + 参考仓盘点沉淀 + Windows 粘贴修复

分支：feature/skill-push-paste-fix → master｜更新：2026-11-17

## 改动范围

| 文件 | 改动 |
|---|---|
| AGENTS.md | push 和发布前准备纳入委托范围 |
| skills/buding-sdd/SKILL.md | §阶段与授权/§停等条件/§计划/§交付更新 + 新增 §7 发布前准备 |
| skills/buding-sdd/references/reference-repo-inventory.md | 参考仓行为事实盘点沉淀（新文件） |
| src/tui/editor/keys.ts | `\r` 过滤修复 |
| src/tui/app.tsx | Ctrl+V 剪贴板粘贴回退（跨平台） |

## 验证结论

| 检查项 | 结果 | 证据 |
|---|---|---|
| 全量单元测试（302 项） | PASS | `npm test` 退出码 0，302 pass / 0 fail |
| Release 测试（16 项） | PASS | `npm run test:release` 退出码 0，16 pass / 0 fail |
| Merge 门禁测试（5 项） | PASS | `npm run merge:test` 退出码 0，5 pass / 0 fail |
| Spec 检查 | PASS | `npm run spec:check` 退出码 0 |
| Skills 检查 | PASS | `npm run skills:check` 退出码 0 |
| Pack smoke | PASS | `node scripts/release/pack-smoke.mjs` 退出码 0 |
| TypeScript 构建 | PASS | `tsc -p src/tui/tsconfig.json` 无错误 |
| 模块边界检查 | PASS | `node scripts/checks/module-boundaries.mjs` 通过 |
| 禁带路径扫描 | PASS | 无依赖/产物/凭据/异源 lockfile 违规 |

## 自审记录

- **buding-sdd SKILL.md**：推送从「不在委托内」改为「在委托内」；发布前准备按 buding-version-prepare 规程执行；实际 npm 发布仍由用户在 GitHub 手动触发。与 AGENTS.md 两处授权描述一致。
- **reference-repo-inventory.md**：内容汇总自 SP002 旧仓机制盘点、剩余 SP 参考复刻排查、独立实现边界文档；仅行为事实，无源码摘录；使用限制明确标注。
- **keys.ts \r 过滤**：Windows 粘贴发送 `\r\n`，`buffer.insert` 只按 `\n` 分割，裸 `\r` 会作为可见字符插入；修复后过滤 `\r`，空字符串直接返回 handled。
- **app.tsx Ctrl+V 回退**：Ink usePaste 依赖 bracketed paste（DEC 2004），Windows 老版 conhost 不支持；Ctrl+V 被 parseKeypress 解析为 ctrl+v 普通按键，text='v'；修复拦截 ctrl+v 主动读取系统剪贴板（Win: powershell Get-Clipboard -Raw / macOS: pbpaste / Linux: xclip|xsel）；超时 3s，失败显示提示；不影响已有 usePaste 在现代终端的行为。

## 未验证项

无。本轮改动为文档/技能更新 + 输入层 bug 修复，不涉及产品架构变更。L3 真终端人工验证（Ctrl+V 在 PowerShell/CMD 中的实际粘贴效果）需用户在真实环境中确认。
