# skill-authoring · STATUS（0.9.1）

- 范围：SA-01…SA-08；分支 `feature/SP009/fix-0.9.1`（基线 master `0af9249`）。
- 授权：用户 2026-11-23「直接复刻…也做到 SP009 里面…修复到 0.9.1」+「技能刷新加一个命令，不轮询」+ AGENTS.md 委托。

| 阶段 | 状态 | 证据 |
| --- | --- | --- |
| 需求/设计/计划 | ✅ | requirements/design/plan |
| S1 多级别发现 | ✅ | skills.ts 用户>项目(向上至 git 根)>内置、首胜+realpath 去重、扩展键；sp009-skill-authoring SA-01…04、sp006-skills 更新 |
| S2 内置 skillify | ✅ | skills-bundled.ts；SA-05/06（级别选择/确认/刷新关键词） |
| S3 /reload-skills 命令刷新 | ✅ | builtin-extended reloadSkillsCommand + app skillsRevision；SA-07/08（新技能即时发现，不轮询） |
| S4 AST 复核 | ✅ | sp004-ast 映射 skills/skills-bundled，PASS |
| S5 收口 | ✅ | npm test 全绿 |

提交：`bc723c8`。待门禁 GREEN 后合入 master。
