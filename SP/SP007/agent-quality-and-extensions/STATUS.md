# STATUS — SP007 agent-quality-and-extensions

- 生命周期：ACTIVE（实施中，T1–T9 完成）
- 更新：2026-11-21
- 分支：feature/SP007/agent-quality-and-extensions（基线 master 4705232）
- 提交链：a6466a4 开轮文档 → edf3835 计划 → e7cabeb T1 → 8d02514 T2 → 07104b8 T3 → a813b5f T4 → 7129d6f T5 → c13820e T6 → b14db5d T7 → 68f80db T8 → （T9 待提交）
- 需求：requirements.md（60 AC：SA×16 / RD×16 / PC×8 / MM×10 / ER×6 / FB×4）
- 设计：design/design.zh.md（自审 PASS，含 D1–D14 偏离登记）；计划：design/plan.zh.md（T1–T16）
- 验证：core+storage+provider 全量 341 项 340 pass 1 skip；T9 sp007-agents-panel 14/14（含真实 Ink 面板功能用例）；全量 TUI 402 项 401 pass（唯一失败 sp006-screen-e2e:216 拒绝写保留草稿＝并发 flaky，单独跑 51/51 全过，非 T9 回归）；T8 image-paste 14/14；sp006-keybindings 8/8；test:checks 模块边界 PASS；Windows 剪贴板无图优雅返回 undefined（有图 UNVERIFIED）
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
  - T8 图片粘贴与缩放：tui/image-resize.ts（PNG 纯 JS zlib 解码/unfilter 0-4/双线性降采样/filter0 编码，8-bit RGB/RGBA 非隔行，调色板/16-bit/隔行/灰度拒绝，级联 8000→2048→1568 目标 raw≤3.75MB/base64≤5MB，非 PNG 超限拒绝）；tui/image-paste.ts（Windows PowerShell Get-Clipboard 临时 PNG fire-and-forget 删＋Linux/macOS 尽力而为＋路径 token 识别去引号还原双反斜杠＋readImageFile 失败明确报错）；storage/image-cache.ts（~/.budingx/image-cache/<sid>/<id>.<ext> 私有 0o700/0o600＋LRU 200 淘汰＋file:// url）；paths.imageCacheDir；keybindings 平台分支 IMAGE_PASTE_KEY（Win alt+v/其他 ctrl+v）chat:imagePaste＋ctrl+b agent.background
  - T9 TUI 代理接线：runtime（provider 协议分支/resolveSnapshot vision/ToolSearch 门控/agent registry/imageCache/AgentRuntime.agents·toolSearch·imageCache）＋storage createSubagentTranscript（sidechain）＋commands（openAgents 等 outcome、builtin-agents /agents local-jsx·/agent prompt、index 注册）＋render/agent-card.ts（8 色/最后3条/Done/ctrl+b/并行树）＋agents.ts listAgentEntries（overridden）＋agents-menu.tsx（list→view/edit/delete＋Manual 向导 wx）＋app.tsx（COMMAND_NAMES 补全导出/AgentsMenu 模态/agent_* 卡片/submitPrompt 图片附件/imagePaste·ctrl+b 键/卡片渲染）＋cli.ts（agents surface·imageCache）＋/tasks Agents 分组
- 下一步：T10 诊断面板（/status 三页签 /stats JSONL 聚合热力图 /doctor 警告式＋ToolSearch 宿主门控已随 T9）
- 清理待办：侦察副产品 .recon-b1.md/.recon-b2.md/undefined/ 已被子代理自行清理（工作区干净）
