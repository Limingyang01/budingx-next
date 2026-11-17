# model-management · STATUS

1. **目标与版本**：[需求 v0.1（已批准）](requirements.md)（AC MM-01…07）；[设计 v0.3 approved](../design/design.zh.md)（本需求相关：§3.5、快照 §3.3）；[实施计划](../design/plan.zh.md) T7；[验证报告](../test-report.md)。
2. **阶段清单**：需求 ✅ → 设计 ✅（2026-11-16 批准）→ 计划 ✅ → 实施 ✅ → 测试 ✅ → 交付 ✅（本地提交并推送功能分支）。阻塞：无。
3. **用户决定**：U1/U2/U4/U5 同 [provider-streaming STATUS](../provider-streaming/STATUS.md) 第 3 条；2026-11-16「继续SP002,我批准了设计」覆盖计划/实现/测试/本地提交，验收与发布独立授权。
4. **执行记录**：实现于 `src/storage/{paths,atomic,config-store,credentials,profiles}.ts`。数据根 `~/.budingx`（`os.homedir()` 解析，不硬编码），配置与凭据分文件，凭据按 `(id, 主机)` 双键绑定，配置三源优先级 CLI > env > file。验证：storage 相关 20 项（config-store 10 + credentials 7 + profiles 3）+ TUI 命令 2 项全绿。旧「预览版 /model 清空会话」缺陷已修复：切换保留历史、自下一回合生效。
5. **下一轮**：验收后按版本规范准备 0.2.0（`npm run version:prepare -- minor --iteration SP002`），发布另行授权；跨端共享模型库属 SP010。
