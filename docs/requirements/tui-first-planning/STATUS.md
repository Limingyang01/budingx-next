# STATUS · tui-first-planning（跨 SP 规划修订）

状态：VERIFYING｜更新：2026-11-17｜负责人：lead（Agent）｜来源：[requirements](requirements.md)

## 阶段

- [x] 需求登记（用户 2026-11-17 指示，USER_CONFIRMED 范围）
- [x] 全项目规划文档同步（路线图 r6 / 矩阵 r3 / 清单 v1.1 / 任务清单批注 / PRODUCT v1.3 / AGENTS / README / 其余配套）
- [x] spec 门禁与 merge 门禁设施扩展（含自测）
- [x] 门禁验证（spec:check / spec:test / npm test 206 项 / merge:gate GREEN）→ 证据见 [test-report](test-report.md)
- [ ] feature 分支提交（6435e86）→ 合入 master → 推送回执

## 下一步

门禁 GREEN 后按 buding-merge 规程合入 master 并推送（用户授权，网络波动可重试）；合入与推送回执回填本 STATUS 与 test-report。

## 风险与回退

- 回退：本变更为纯文档＋门禁脚本，revert 合并提交即可完全回退；清单 v1.1 与门禁 MUST_DEFER 同步回退。
- 风险：inventory v2 配额补齐前 SP021 不得宣称全量覆盖（已登记义务）；暂缓轮恢复须用户另行决定。