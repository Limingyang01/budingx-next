# STATUS · tui-first-planning（跨 SP 规划修订）

状态：CLOSED（2026-11-17 合入 master 并推送核验）｜更新：2026-11-17｜负责人：lead（Agent）｜来源：[requirements](requirements.md)

## 阶段

- [x] 需求登记（用户 2026-11-17 指示，USER_CONFIRMED 范围）
- [x] 全项目规划文档同步（路线图 r6 / 矩阵 r3 / 清单 v1.1 / 任务清单批注 / PRODUCT v1.3 / AGENTS / README / 其余配套）
- [x] spec 门禁与 merge 门禁设施扩展（含自测）
- [x] 门禁验证：spec:check OK；npm test 206 项 0 失败；merge:gate 两次 GREEN（报告 artifacts/merge-gate/feature-tui-first-planning-2026-11-17T10-44-17-461Z.md 与 …10-45-40-697Z.md）
- [x] feature 分支提交 6435e86 / bf1d5b5 → 合入 master **99b50ee**（ancestry 证明通过）→ 推送第 3 次成功，ls-remote = 99b50ee
- [x] 合入后 master 复跑全绿；回执收口提交见 test-report §4 追加行

## 结果

- 合并提交：99b50ee08636a7a9dfd7093e99f0f8473863d3d3；远端 master 已核对一致（推送回执收口后以 test-report §4 追加行为准）。
- 遗留义务：SP020 开轮前 inventory v2 补齐高级 30 / 高级盲测 10 配额；暂缓轮（SP008/009/016/017/018）恢复须用户另行决定。
- 未验证项：仅既有 SP002 真终端人工 smoke（历史遗留，非本变更范围），恢复条件见 test-report §5。

## 风险与回退

- 回退：revert 合并提交 99b50ee 即可完全回退（纯文档＋门禁脚本）；清单 v1.1 与 MUST_DEFER 同步回退后分母恢复 53。
- 风险：inventory v2 配额补齐前 SP021 不得宣称全量覆盖（已登记义务）。