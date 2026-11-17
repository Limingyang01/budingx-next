# 验证报告 · tui-first-planning（跨 SP 规划修订，2026-11-17）

配套：[requirements](requirements.md)｜[STATUS](STATUS.md)｜[路线图 r6](../../iteration-plan.md)｜门禁规程：[集成门禁](../../integration-gate.md)

身份：规划文档＋门禁设施变更；**不含产品代码行为变更**。cwd 均为仓库根 `D:\extra_project\budingx-next`。基线 HEAD `9429c67`（并发发布会话的 0.2.0 收尾提交，本变更不覆盖其回执）。

## 1. AC 逐条结论

| AC | 结论 | 依据 |
| --- | --- | --- |
| AC-01 路线图 r6 | PASS | [iteration-plan.md](../../iteration-plan.md) r6 决定节＋总表 SP008/009/010/011/012/015/016/017/018/019/020/021 行＋版本记录 r6；历史 r1–r5 保留并加 r6 注记 |
| AC-02 全项目同步 | PASS | 矩阵 r3、advanced-capabilities-plan、npm-release-plan r4、product-brief、architecture、repository-layout、versioning、current-status、index、reference-tui-replication-audit、SP/README、SP001 汇总、PRODUCT v1.3、README、AGENTS、skills/buding-frontend-testing、src/tui/README 均已同步；grep 走查见 §3 |
| AC-03 清单 v1.1 与 spec 门禁 | PASS | `npm run spec:check` exit 0：85 项（必交 47 / 建议 22 / 可选 9 / 范围外 1 / 暂缓 6）；`node --test --experimental-test-isolation=none scripts/spec/check-spec.test.mjs` 9/9（含新增「暂缓项静默恢复」「暂缓项静默删除」两条保护用例） |
| AC-04 任务清单批注 | PASS | spec:check 任务清单 基本 30 / 高级 30 / 保护 12 / 盲测 20 锚点不变；A17–A27 备注列「暂缓 r6」、§2 配额与 §12 依赖批注、头部 inventory v2 义务登记 |
| AC-05 三权限模式 | PASS | 路线图 r6 决定节、矩阵「权限模式」行、清单 CAP-L3-06、PRODUCT §2.2/§7 均 USER_CONFIRMED 且标明 SP003/SP004 交付、当前未实现 |
| AC-06 PRODUCT 同步 | PASS | PRODUCT.md v1.3：§1 TUI 单端、§2.1 SP001 行 v1.1 注记、§2.2 状态列（5 轮 DEFERRED）、§7 暂缓行与三模式、§8 规划调整行；0.2.0 已发布事实保留 |
| AC-07 门禁 GREEN＋合入＋推送 | PASS | merge:gate 两次 GREEN（§4）；合并 99b50ee＋ancestry 证明；推送第 3 次成功，ls-remote 核对一致 |
| AC-08 outgoing 干净 | PASS | merge:gate 第 5 步扫描 29 文件无违规；CON、pnpm-lock.yaml 保持未跟踪未提交 |

## 2. 分层证据

- L0 纯逻辑/规格：spec:check exit 0；spec 自测 9/9；merge 纯函数自测 `node --test --experimental-test-isolation=none scripts/merge/cross-validate.test.mjs` 5/5（含新增 `reportFileForBranch` 约定用例）；`npm run skills:check` exit 0（entries current）。
- L1/L2 真实进程与制品：`npm test` 全段与 `npm run merge:gate`（含 pack-smoke 隔离安装＋fixture 流式请求）——见 §4 回填。
- L3 真终端人工：不适用（无产品行为变更）；既有 SP002 真终端 IME UNVERIFIED 状态不被本变更改变。
- 沙箱说明：workspace-write 沙箱实测阻止 node 派生子进程（`spawnSync` EPERM，含 cmd.exe/shell 变体），故纯函数段另以进程内隔离模式（`--experimental-test-isolation=none`）复核（spec 9/9、merge 5/5）；全量 `npm test`/`merge:gate` 在会话权限 danger-full-access 下执行（先经单次命令扩权批准，后会话策略切换为该模式），回执见 §4。

## 3. scoped diff 复核与一致性走查

- 变更文件清单（git status）：SP/SP001 三份（清单/任务清单/汇总）、docs 十二份（iteration-plan、agent-capability-matrix、advanced-capabilities-plan、npm-release-plan、product-brief、architecture、repository-layout、versioning、current-status、index、reference-tui-replication-audit、integration-gate）、scripts/spec 两份、scripts/merge 两份、SP/README、PRODUCT、README、AGENTS、skills/buding-frontend-testing/SKILL.md、src/tui/README.md、docs/requirements/tui-first-planning 三份。无产品 src 代码改动、无依赖变更、无凭据/产物。
- 残留表述走查：`三端必交`/`分母 53`/`7 模式` 仅存于历史节与基线事实列（SP001 设计/需求/STATUS 的参考盘点、审计 §3 参考事实、路线图 r2/r3 历史节加 r6 注记）；现行规划表述统一为 TUI 单端＋暂缓＋入口保留＋三模式。
- 并发保护：发布会话提交 9429c67 的 0.2.0 回执（current-status §0.2.0 正式发布完成、PRODUCT 已发布表述、release-ledger）未被覆盖；本变更在其之上叠加。
- 编号纪律：SP008/009/016/017/018 仅标 DEFERRED，未改名/回收/重排；SP010/011/020 功能目录改名在路线图/矩阵/PRODUCT/审计四处一致。

## 4. 全量门禁回执（回填节）

- `npm run skills:test`：首跑 10 项中 1 项红——链接完整性门禁检出本报告文件尚未创建（4 处引用断链），属门禁有效拦截（RED）；创建本报告后复跑 **10/10 通过**（复绿）。
- `npm test` 全段（2026-11-17，cwd 仓库根，会话权限 danger-full-access）：**skills 10/10、spec 9/9、产品单元 166/166（含 tsc 构建）、模块边界检查通过、release 16/16、merge 5/5，合计 206 项 0 失败**。
- `npm run merge:gate`（feature/tui-first-planning → master，源 6435e86）：**GATE GREEN**；四步全 ok（npm test / spec:check / skills:check / pack-smoke 隔离安装＋fixture 流式请求）；outgoing 29 文件无禁带路径；报告审计通过（UNVERIFIED 有恢复条件节）。报告：`artifacts/merge-gate/feature-tui-first-planning-2026-11-17T10-44-17-461Z.md`（gitignored）。
- 合入：merge-tree 预演 exit 0 无冲突；master 合并提交 **99b50ee**（--no-ff，父 2fb7c1e＋bf1d5b5）；`git merge-base --is-ancestor bf1d5b5 master` 通过。并发发布会话提交 2fb7c1e 与本轮区域不重叠，合并干净，0.2.0 回执保留。
- 合入后 master 复跑（2026-11-17）：npm test **206 项 0 失败**（skills 10 / spec 9 / unit 166 / release 16 / merge 5）＋模块边界通过；spec:check OK（47/6）；skills:check current；pack-smoke **PASS**（34 文件、隔离安装 0.2.0）。
- 推送：`git push origin master` 前两次网络波动失败（github.com:443 连接超时），第 3 次成功（2fb7c1e..99b50ee）；`git ls-remote origin master` = **99b50ee08636a7a9dfd7093e99f0f8473863d3d3**，与本地一致。凭据说明：本环境无 GCM/可用 askpass，使用 bundled git 自带 `git -c credential.helper=wincred` 读取 Windows 存储凭据（仅本次命令参数，未改全局配置）。
- 回执收口：收口提交 C 记录合入/推送#1/复跑回执并推送（推送#2）；C 的 SHA 与推送#2 远端回执由下一提交 D 的本节追加行登记，D 的推送#3 回执以 ls-remote 核验并记入交接会话。
- 追加行（提交 D）：C＝**620b833674c727c6cb91e1717b1bcd82a5bf8b6f**，推送#2 一次成功，ls-remote 远端 master＝620b833 与本地一致；本追加行所在提交 D 经推送#3 上远端，回执以 ls-remote 核验并记入交接会话。本轮规划修订全部 AC PASS，STATUS CLOSED。

## 5. 未验证项与恢复条件

| 项 | 状态 | 恢复条件 |
| --- | --- | --- |
| 既有 SP002 真终端 IME/观感人工 smoke | UNVERIFIED（历史遗留，非本变更范围） | 恢复条件＝SP002 验证报告 §5 人工清单；本规划变更不改变其状态 |

## 6. 风险与回退

- 回退：revert 合并提交即可完全回退（纯文档＋门禁脚本）；清单 v1.1 与 MUST_DEFER 同步回退后分母恢复 53。
- 风险：inventory v2 配额补齐前 SP021 不得宣称全量覆盖（义务已登记于路线图 r6 与任务清单头部）；暂缓轮恢复须用户另行决定；门禁设施扩展仅增加报告路径约定，严格度不变（缺报告仍 RED）。