# STATUS — SP007 agent-quality-and-extensions

- 生命周期：ACTIVE（实施中，T1–T7 完成）
- 更新：2026-11-21
- 分支：feature/SP007/agent-quality-and-extensions（基线 master 4705232）
- 提交链：a6466a4 开轮文档 → edf3835 计划 → e7cabeb T1 → 8d02514 T2 → 07104b8 T3 → a813b5f T4 → 7129d6f T5 → c13820e T6 → （T7 待提交）
- 需求：requirements.md（60 AC：SA×16 / RD×16 / PC×8 / MM×10 / ER×6 / FB×4）
- 设计：design/design.zh.md（自审 PASS，含 D1–D14 偏离登记）；计划：design/plan.zh.md（T1–T16）
- 验证：core+storage+provider 全量 341 项 340 pass 1 skip（POSIX 权限已知）；TUI coding-loop/wire-e2e/stress-loop 6/6；test:checks 模块边界 PASS
- 参考：budingWorkerSpace b5c9be8（只读）；三份侦察报告已固化入需求（R1 子代理 / R2 诊断 / R3+R4 供应商与多模态）
- 关键决策：第二协议=Anthropic Messages 直连适配器（D1）；PNG 纯 JS zlib 缩放不引 sharp；ToolSearch 客户端发现集替代 tool_reference beta；
  /doctor 警告式（修正 r5「Fix 屏」措辞）；单目录承载五工作流（沿用 SP006 先例）；
  D13 frontmatter 手写平铺解析（yaml 不在产品依赖白名单）；D14 定义 IO 落 src/tui/agents.ts、子政策/sidechain 经端口注入 core（core 禁 IO）
- 用户指令：m00001 开发自测至无 bug→提交推送功能分支、**不合入 master**；m00014 像素级参考参考仓 TUI
- 阻塞：无（真实模型凭据 .env.e2e.local 在位；缺项将记 UNVERIFIED）
- 已完成模块：
  - T1 契约：events 图片块/agent_* 事件/NoticeCode、provider ApiContentPart、tools concurrencySafe、normalize 图片 parts、transcript model、config protocol/vision
  - T2 provider/anthropic.ts（createAnthropicProvider/probeAnthropic/discoverModelsAnthropic）＋image-errors.ts
  - T3 core/agent-definitions.ts（纯解析/内置三代理/序列化）＋tui/agents.ts（目录 IO/缓存/save/delete）
  - T4 core/agent-runtime.ts（createAgentRegistry 并发闸/权限上限/预算/取消/后台通知）＋session 性能采集/通知队列
  - T5 core/agent-tools.ts（Agent/TaskOutput/TaskStop）＋session dispatchTools 连续并发安全组并行（dispatchOne 抽取，结果按原序回灌）
  - T6 core/tool-search.ts（门控 off/auto/auto:N/standard、计分 12/10/6/5/4/3/2、select/裸名/前缀/关键词、发现集 scanHistory resume 重建、压缩 tool_state 快照）＋session buildRequest filter/notice/失败引导
  - T7 会话图片链路：SubmitOptions.images→userMessage image 块；vision===false 前置拒绝 notice image_rejected 不发请求；vision 未知错误驱动降级（剥离最近 user 图片→notice image_downgraded→无图重试一次→再失败 image_error）；buildRequest 媒体上限 100 丢最旧＋可见 notice；PC-05 非法 JSON 以 <tool_use_error>InputValidationError 回灌；isImageUnsupportedError 移 core/image-errors.ts（provider re-export，core 禁 import provider）
- 下一步：T8 图片粘贴与 PNG 纯 JS 缩放（tui 键位 chat:imagePaste＋image-cache＋[Image #N] 占位）
- 清理待办：侦察副产品 .recon-b1.md/.recon-b2.md/undefined/ 已被子代理自行清理（工作区干净）
