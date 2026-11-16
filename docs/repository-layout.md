# 仓库与源码布局

USER_CONFIRMED：按最新决定采用一个 Git 仓库，产品模块统一放 src/，不使用 packages/，不创建子仓/submodule。此前参考 d2utral 的多仓方案已被本决定替代。

```text
budingx-next/
  docs/                         # 目标、架构、规划、开发/发布说明
  SP/                           # 迭代索引、功能/优化需求、模板
  skills/                       # canonical 开发技能
  scripts/                      # 技能、构建、测试、版本和发布编排
  src/
    tui/                        # 当前已实现；独立产品 package/编译/测试
      src/                      # TypeScript 代码
      test/                     # Node 回归/进程测试
      dist/                     # 编译产物，忽略 Git，发布时纳入 tarball
      package.json
      tsconfig.json
```

后续建议在 src/ 下按责任增加 core/、providers/、storage/、protocol/、desktop/、vscode/、mobile/、gateway/、adapters/、scheduler/ 等模块；这是边界建议，不为尚未实现的端创建空工程。各端的具体框架和构建目录在对应迭代设计，不能把此清单当已实现结构。

Core 和公开协议不能依赖某个 UI；各端共享业务逻辑但各自启动/打包；共享代码从明确接口引用，不把 TUI 进程作为其他端运行前置，不复制 Core。需要独立 npm 包的模块可以有自己的 package.json，但“有 package.json”不等于必须放 packages/。根 package 保持 private，TUI 发布只选 src/tui 白名单。

未来根构建/测试命令按实际模块路由，版本台账记录各制品是否交付；一次 TUI 发布不表示其他端已发布。用户数据根 ~/.budingx 与 repo/src 布局互不混用，目录通过当前用户 home 解析，不硬编码电脑名或用户名。
