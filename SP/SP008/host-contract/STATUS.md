# STATUS — host-contract（SP008）

## 1. 当前有效范围

- 需求：`SP/SP008/host-contract/requirements.md`（R1/R2/R3，SH-01…SH-05、SO-01…SO-04、TB-01…TB-08）
- 设计：`design/design.zh.md`（待建立，Agent 自审对象）
- 计划：`design/plan.zh.md`（设计自审通过后建立）
- 基线：master `a8628b5`；功能分支 `feature/SP008/host-contract`
- 授权范围：设计、计划、实施、测试、交付记录、功能分支本地提交（中文说明）；
  **不含**合入 master / 推送 master（用户 m00133），不含打标签、npm 发布、远端设置、分支删除。

## 2. 阶段清单

- [x] 需求：SP008 汇总、需求正文、STATUS 骨架（无提交）
- [x] 设计：design/design.zh.md + 自审记录（§6/§8）
- [x] 计划：design/plan.zh.md（T1…T14，含 RED/GREEN 与命令）
- [ ] 实施：R1 共享数据、R2 会话归属、R3 宿主契约与传输
- [ ] 测试收口：AC→单元+功能用例 RED→GREEN
- [ ] 多轮端到端复跑（用户 m00133）
- [ ] AST 复核（新增文件全映射、命中全处置）
- [ ] 交付记录：test-report、PRODUCT.md 同步、门禁证据

当前停点：需求、设计、计划完成，进入实施 T1。

## 3. 批准与来源

| 事项 | 来源 | 范围 |
| --- | --- | --- |
| SP008 开发 | 用户 m00001（2026-11-21） | 本轮全部内容，按 buding-sdd |
| 不合入 master | 用户 m00133（2026-11-21） | 覆盖 AGENTS.md 默认「门禁 GREEN 后合入并推送」委托 |
| 多轮端到端 + AST 检测 | 用户 m00133（2026-11-21） | 交付前必须完成 |
| 参考实现对照 | AGENTS.md 工作边界；用户 m00133 | `D:\my_project\budingWorkerSpace` @ b5c9be8，只读，不抄代码 |

## 4. AC 与验证（占位，随实施更新）

| AC | 结果 | 证据 |
| --- | --- | --- |
| SH-01…SH-05 | UNVERIFIED | 待实施 |
| SO-01…SO-04 | UNVERIFIED | 待实施 |
| TB-01…TB-08 | UNVERIFIED | 待实施 |

## 5. 提交与集成

- 本地提交：待实施（功能分支）
- 合并/推送：**未执行**；用户 m00133 要求先不合入 master
