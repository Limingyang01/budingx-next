# model-management · STATUS

1. **目标与版本**：[需求 v0.1（已批准）](requirements.md)（AC MM-01…07）；[设计 v0.3 approved](../design/design.zh.md)（本需求相关：§3.5、快照 §3.3）；[实施计划](../design/plan.zh.md) T7；[验证报告](../test-report.md)。
2. **阶段清单**：需求 ✅ → 设计 ✅（2026-11-16 批准）→ 计划 ✅ → 实施 ✅ → 测试 ✅ → 交付 ✅（本地提交并推送功能分支）。阻塞：无。
3. **用户决定**：U1/U2/U4/U5 同 [provider-streaming STATUS](../provider-streaming/STATUS.md) 第 3 条；2026-11-16「继续SP002,我批准了设计」覆盖计划/实现/测试/本地提交，验收与发布独立授权。
4. **执行记录**：实现于 `src/storage/{paths,atomic,config-store,credentials,profiles}.ts`。数据根 `~/.budingx`（`os.homedir()` 解析，不硬编码），配置与凭据分文件，凭据按 `(id, 主机)` 双键绑定，配置三源优先级 CLI > env > file。验证：storage 相关 20 项（config-store 10 + credentials 7 + profiles 3）+ TUI 命令 2 项全绿。旧「预览版 /model 清空会话」缺陷已修复：切换保留历史、自下一回合生效。
5. **下一步**：0.2.0 已 published 并完成官方安装/来源核验；后续版本按已确认迭代准备，跨端共享模型库仍属 SP010。

## 2026-11-17 缺口收尾

按用户要求补齐报告中本模块相关缺口，详见 [验证报告 §12](../test-report.md#12-2026-11-17-缺口收尾g01g17) 与 [实施计划](../design/gap-closure-plan.md)。历史 PASS 保留当时覆盖范围；当前代码与新增回归不替代 live Provider 或真实终端人工验收。验收、版本准备和发布状态未因本次修复自动改变。

## 0.2.0 发布准备（2026-11-17）

本模块纳入 SP002 的 0.2.0；源码版本、prepared 台账和[发行说明](../../../release-notes/v0.2.0.md)已同步。发布由维护者手动触发，尚无 published 回执。历史验证与真实终端人工 UNVERIFIED 保持各自证据边界。

## 0.2.0 已发布（2026-11-17）

本模块随 0.2.0 发布，latest 已更新；[运行 #7](https://github.com/Limingyang01/budingx-next/actions/runs/44055301185) 的 Windows/Linux 验证与 OIDC publish 均 success。发布源码 `6ed77d8`，公开 provenance 和官方隔离安装/签名已核实，台账 published。此前 prepared 记录是发布前快照；未验证的人机终端体验维持原边界。详细证据见 [test-report §19](../test-report.md#19-020-正式发布收尾2026-11-17)。
