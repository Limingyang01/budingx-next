# SP007 需求 — Agent 质量与扩展（agent-quality-and-extensions）

状态：ACTIVE ｜ 开轮：2026-11-21 ｜ 参考修订：budingWorkerSpace b5c9be8（只读）
来源：docs/iteration-plan.md:74（SP007 行）与 :136（r5 增补）；docs/agent-capability-matrix.md 对应行；
用户 m00001（开发自测推送功能分支、不合入 master）、m00014（全部功能像素级参考参考仓 TUI）。
责任范围：src/core、src/provider、src/storage、src/tui、scripts/eval；单仓布局，不新增运行时依赖。

## 目标

交付五个工作流（R1 子代理执行、R2 运行时诊断、R3 供应商兼容、R4 多模态上下文、R5 评估回归）
与 R6 失败边界/宿主契约回归，使 SP007 出口验收可判定：两类公开协议/实际模型过能力矩阵、
子代理权限/预算/取消/冲突真实链路、图片与复杂工具参数按能力处理、联网/hooks/MCP 失败不越权、
诊断/性能/隐私回归与稳定宿主契约通过。

## 排除清单（本轮不交付，明确延期）

| 项 | 理由/去向 |
| --- | --- |
| 团队/swarm、teammate 消息协议 | SP011；本轮子代理边界供其复用 |
| 子代理 worktree 隔离（isolation frontmatter） | SP011 worktree-isolation；本轮解析到该字段记 doctor 警告并不执行隔离 |
| 子代理 fork/resume/agent-memory | 参考为门控/独立功能；SP011+ 复用本轮 sidechain 转录契约 |
| 按代理 mcpServers/hooks/skills 预加载、initialPrompt 之外的记忆注入 | 后续轮；本轮 frontmatter 未支持字段记 doctor 警告，不静默忽略 |
| Read 工具读图返回图片块、PDF 附件 | 矩阵附件行由用户粘贴/路径附件覆盖；工具结果图片需改 ToolHandler 返回契约，延期 |
| /stats 趣味对比（书籍/时长类比） | 参考彩蛋，非能力；可选 polish，不占 AC |
| doctor Updates 联网 dist-tags 检查 | 隐私默认离线（矩阵「默认不上传」）；本轮只显示版本/安装方式，联网检查延期 |
| Desktop/VS Code/远程/H5/IM | r8 范围外 |

已交付不重复：effort（0.5.4）、/btw（SP006）。

## R1 子代理执行（SA）

参考事实：src/tools/AgentTool/（loadAgentsDir/runAgent/UI/agentFileUtils）、src/commands/agents/、
src/commands/agent.ts。机制：Markdown+YAML frontmatter 定义；built-in→user→project 覆盖序；
独立上下文+独立工具循环；工具裁剪；sync 共享父取消、async 独立；结果=最后 assistant 文本+usage 尾注；
后台终态以 <task-notification> 注入父循环；卡片与后台 shell 分离。

- SA-01 定义加载与覆盖序：项目级自 cwd 向上每级 .budingx/agents 至 git 根＋用户级 ~/.budingx/agents；
  frontmatter name/description 必填，tools 逗号分隔缺省=全部，model 缺省 inherit，
  color/maxTurns/effort/initialPrompt/background 可解析；正文=系统提示词；覆盖序 built-in→user→project 后者胜；
  非法文件跳过并记 doctor 警告不崩溃；写后缓存失效。【单元+功能】
- SA-02 内置代理：general-purpose（全工具）、Explore（只读，禁写入/执行/Agent）、Plan（只读规划）。【单元】
- SA-03 Agent 工具派发：入参 description(3-5词)/prompt/subagent_type?/model?/run_in_background?；
  子会话独立上下文（不见父历史）、完整工具循环、裁剪工具（禁 Agent/AskUserQuestion/计划模式工具）、
  系统提示词=定义+环境详情；未知 subagent_type 明确报错并列可用类型。【单元+功能】
- SA-04 权限上限：子有效权限≤父当前模式；frontmatter 不得提升；完全权限仍受 deny 规则与凭据保护；
  同步子代理审批弹到父终端；非交互按策略自动判定不挂起。【单元+功能】
- SA-05 预算与并发：maxTurns（参数??定义??默认常量）强制；单子代理 token 上限（MODEL_PROPOSED 常量）；
  全局并发上限（MODEL_PROPOSED 常量，参考全局工具并发 10）；超限明确终止并回报，不无界运行。【单元+功能】
- SA-06 取消传播：父回合取消→同步子代理 AbortController 树中止、子后台进程受控终止；
  后台子代理独立取消经 TaskStop；取消后终态可见。【单元+功能】
- SA-07 冲突可见：子代理修改汇入父 change_set/diff；同文件 stale 冲突→工具错误可见不静默覆盖；
  父可核验子结果（工具结果+变更证据）。【单元+功能】
- SA-08 同步结果返回：取最后 assistant 文本（纯 tool_use 回溯）为 tool_result，
  附 <usage>total_tokens/tool_uses/duration_ms</usage>；结果上限 100000 字符截断注明；
  子失败/取消→错误 tool_result 可见；父被提示须转述结果。【单元+功能】
- SA-09 后台代理：run_in_background→即返 async_launched{agentId}；sidechain 转录 JSONL 落盘；
  终态以 <task-notification>（status/summary/result/usage）作 user 消息注入父下一回合；原子防重。【单元+功能】
- SA-10 TaskOutput/TaskStop：TaskOutput{agentId,block?默认true,timeout?≤600000} 返最终答案；
  TaskStop 停止并抑制后续通知；未知 agentId 明确报错。【单元+功能】
- SA-11 /agents 面板：local-jsx；列表（来源标签、被覆盖 dim、序 built-in→user→project）→
  查看/编辑/删除/返回（内置不可编辑删除）；创建向导 位置→方式→名称→提示词→描述→工具→模型→颜色→确认；
  落盘 <name>.md frontmatter+正文，'wx' 防覆盖，写后清缓存；退出输出变更汇总；↑↓/Enter/Esc。【UI+功能】
- SA-12 /agent <type> <prompt>：prompt 型命令，注入指令令模型调 Agent；缺参给用法。【单元】
- SA-13 子代理卡片：标题=description；agentType 8 色；流式进度 Initializing…→工具分组摘要仅显最后 3 条
  +「+N more tool uses (ctrl+o expand)」→完成「Done (N tool uses · X tokens · 时长)」；
  ctrl+o 展开子转录+最终答案；失败/取消态；高度不足浓缩单行。【UI】
- SA-14 卡片分离与后台化：子代理卡片/pill 与后台 shell 六件套分离；/tasks 面板代理独立分组；
  运行≥2s 显 ctrl+b 后台提示；ctrl+b 将同步代理转后台（复用 SA-09 链路）。【UI+功能】
- SA-15 并行分组：多代理并行显「Running N agents…」+├─/└─树行（彩色类型+description+计数+状态）。【UI】
- SA-16 无头兼容：headless 下 Agent/TaskOutput/TaskStop 可用（非交互权限策略）；
  /agents、/agent 面板类不注册 headless；事件流不污染机器可读输出。【单元+功能】

## R2 运行时诊断（RD）

参考事实：src/commands/{status,stats,doctor}/、src/components/Settings/{Settings,Status}.tsx、
src/components/Stats.tsx、src/screens/Doctor.tsx、src/utils/{stats,statsCache,heatmap,doctorDiagnostic,doctorContextWarnings}.ts、
src/tools/ToolSearchTool/。**参考 /doctor 为警告式静态报告（Warning+Fix 文本），非 PASS/FAIL 清单、无交互 Fix 屏**
（r5 措辞「doctor Fix 屏」按实际参考行为修正，偏离登记见设计）。

- RD-01 /status 对话框：local-jsx immediate；三页签 Status/Config/Usage；高度 max(15,min(floor(rows*0.8),30))；
  Esc 关闭+系统消息；Status 页字段：Version、Session ID、cwd、Model/档案、API baseUrl、凭据来源、
  MCP 计数（connected/failed/pending + 「· /mcp」不列全表）、Setting sources（仅实际加载非空源）、
  System Diagnostics 警告（无效配置/doctor 警告/项目指令>40000 字符）；不显示权限模式（同参考）。【UI+单元】
- RD-02 /status Config 页：生效配置来源（cli/env/file/default 优先级）与档案摘要。【UI】
- RD-03 /status Usage 页：本会话 requests/输入输出 token/耗时（复用 /cost 格式）＋
  首 token 均值、请求 p50/p95、进程内存 RSS（MODEL_PROPOSED 落点，矩阵「诊断与性能」要求）。【UI+单元】
- RD-04 /stats 数据聚合：~/.budingx/sessions/*/transcript.jsonl（含子代理 sidechain：计 token 不计会话）；
  按模型按日累加 input+output token；tool_use 计数；mtime 预过滤；分批并行读。【单元】
- RD-05 /stats 缓存：配置根 stats-cache.json＋版本常量（更旧全量重算）；磁盘缓存只覆盖到昨天，今天恒实时；
  7d/30d 范围绕过缓存重算。【单元】
- RD-06 /stats Overview：热力图（恒 all-time）、Favorite model、Total tokens、Sessions、Longest session、
  Active days、Longest/Current streak、Most active day；r 循环 all/7d/30d（默认 all）；Tab 切页；Esc 关闭。【UI】
- RD-07 /stats Models：top3 模型折线图（height 8、宽 min(52,max(20,termWidth-7))、y 轴 k/M、<2 天不画）；
  明细双列 4 模型（百分比+In/Out）按总 token 降序；↑↓ 每次滚 2 项；不显示费用（同参考）。【UI】
- RD-08 /stats Ctrl+S：复制 ANSI 截图到剪贴板（Windows PowerShell Set-Clipboard），2 秒状态提示；失败明确提示。【UI+功能】
- RD-09 /doctor 报告：警告式，每条「Warning: …」+「Fix: …」文本；分区 Diagnostics（运行类型/版本/Node/路径/安装方式/搜索可用性）、
  Multiple installations、Invalid Settings、MCP 警告、Keybinding 解析警告、Environment Variables（BUDINGX_* 非法/超限）、
  Agent Parse Errors、Context Usage Warnings；Enter/Esc 关闭+系统消息；无问题分区隐藏。【UI+单元】
- RD-10 /doctor 自动修复：打开时清理过期会话锁（唯一自动动作），报告清理计数；其余 Fix 均为文本建议。【单元+功能】
- RD-11 上下文警告阈值：项目指令>40000 字符；代理描述总量>15000 token（列前 5）；
  MCP 工具>25000 token（按服务器分组前 5）；不可达权限规则逐条附 Fix；四项并行计算。【单元】
- RD-12 ToolSearch 工具：{query,max_results?默认5}；select:A,B,C 直选（大小写不敏感、已加载 no-op）；
  裸名精确 fast path；mcp__server 前缀；关键词空格分词 +词必需；计分 名称词精确 MCP12/普通10＞子串6/5＞
  searchHint4＞全名兜底3＞描述2；返回匹配名+total_deferred_tools+pending MCP 提示；无匹配固定文案。【单元】
- RD-13 延迟加载机制：MCP 工具恒延迟、核心工具恒加载、ToolSearch 自身不延迟；每请求工具集=非延迟+ToolSearch+
  已发现延迟工具（扫历史 tool_result 发现集）；公告 <available-deferred-tools> 排序名（池变即失效）；
  压缩边界快照发现集；断连服务器工具公告移除。【单元+功能】
- RD-14 门控与失败引导：BUDINGX_TOOL_SEARCH=off/auto/auto:N/standard（默认 auto）；
  auto 阈值=延迟工具 token≥上下文窗口×10%（N 可调）；无延迟池禁用；未加载工具校验失败→错误追加
  「call ToolSearch with query "select:<name>", then retry」。【单元】
- RD-15 诊断隐私：/status /stats /doctor 纯本地、默认不上传、无网络请求；凭据在所有诊断输出脱敏；
  两个临时 home 隔离验证。【单元+功能】
- RD-16 性能采集：首 token 延迟、每请求耗时 p50/p95、回合耗时在会话内采集（固定环境/预算口径），
  供 RD-03 与评估报告使用；采集不引入额外网络。【单元】

## R3 供应商兼容（PC）

参考事实：src/utils/model/providers.ts、src/server/types/provider.ts、src/server/config/providerPresets.ts、
src/server/proxy/transform/*（cc-switch MIT 来源线索登记台账）、src/services/api/withRetry.ts。
参考 CLI 恒说 Anthropic、第二供应商走本地翻译代理；**本仓已原生 OpenAI Chat Completions，
第二协议取 Anthropic Messages 直连适配器**（方向相反、能力等价：两类公开协议；各家 Anthropic 兼容端点可直连，
无需本地代理——偏离登记见设计）。

- PC-01 Anthropic 适配器：createAnthropicProvider 实现 ModelProvider；POST /v1/messages；
  x-api-key+anthropic-version: 2023-06-01；system 顶层、content blocks、tools input_schema、tool_choice、
  max_tokens 必填默认常量；SSE message_start/content_block_start/content_block_delta(text/thinking/input_json)/
  content_block_stop/message_delta(stop_reason,usage)/message_stop 映射到 ProviderEvent；
  错误分类（rate_limit/overloaded/authentication/invalid_request）与有界重试退避同 openai 适配器口径。【单元 fixture+真实】
- PC-02 档案协议字段：ModelProfile.protocol 'openai'|'anthropic' 缺省 openai（旧档案兼容）；
  runtime 按协议选适配器；凭据 host 绑定不复用不变。【单元】
- PC-03 模型管理预设与验证：供应商步骤增 Anthropic 兼容预设（DeepSeek api.deepseek.com/anthropic、
  GLM open.bigmodel.cn/api/anthropic、Kimi api.kimi.com/coding、MiniMax api.minimaxi.com/anthropic）
  与 Custom 协议选择；probe 按协议验证；错误 endpoint/凭据/不支持工具能力明确反馈。【UI+单元+真实】
- PC-04 运行行为 fixture：流式碎片/中断、多工具调用、错误参数、上下文上限、限流/网络错误、重试、取消
  双协议各有 fixture；不无界重试、不静默换模型。【单元+真实】
- PC-05 错误参数自纠：工具入参 JSON 非法或 schema 校验失败→<tool_use_error>InputValidationError: …</tool_use_error>
  is_error tool_result 回灌模型自纠，循环不中断（双协议）。【单元+功能】
- PC-06 重试纪律：重试上限常量、retry-after 优先、401 静态 key 不重试；上下文超限错误明确呈现
  （MODEL_PROPOSED：按参考正则提数降 max_tokens 重试一次为可选增强，不静默截断历史）。【单元】
- PC-07 真实模型能力矩阵：scripts/testing/live-provider 扩展双协议（流式对话+工具回合+取消），
  预算/请求上限/脱敏沿用；缺凭据记 UNVERIFIED+恢复条件。【真实】
- PC-08 配置快照：会话固定配置快照；切换模型/协议不误用旧凭据（回归+协议切换新用例）。【单元+功能】

## R4 多模态上下文（MM）

参考事实：src/keybindings/defaultBindings.ts:13-15,87（Windows alt+v/其他 ctrl+v）、src/utils/imagePaste.ts、
src/constants/apiLimits.ts（5MB base64/3.75MB raw/8000px/100 media）、src/utils/imageResizer.ts、
src/utils/attachments.ts:1058-1125、src/utils/imageStore.ts、src/components/messages/UserImageMessage.tsx（[Image #N]）、
src/services/api/errors.ts:431-471（错误驱动降级）、src/utils/messages.ts:2004-2082（剥离图片块） 。
**缩放不引入 sharp/native 依赖：PNG 纯 JS（node:zlib）降采样，非 PNG 超限明确拒绝**（偏离登记见设计）。

- MM-01 图片粘贴键位：Windows alt+v、其他平台 ctrl+v→chat:imagePaste；键位注册表+保留键校验通过。【单元+UI】
- MM-02 剪贴板读取：Windows PowerShell Get-Clipboard -Format Image→PNG 临时文件，用后清理；
  无图明确提示；Linux xclip/wl-paste、macOS osascript 尽力而为（本机 Windows 验证，其他平台 UNVERIFIED）。【功能】
- MM-03 路径附件：拖拽/输入图片路径（png|jpe?g|gif|webp）识别；去外层引号+还原 shell 反斜杠转义；
  读失败明确报错不假装已读。【单元+功能】
- MM-04 尺寸控制：base64 长度上限 5MB；PNG 超限→纯 JS 降采样级联（目标 raw 3.75MB，尺寸 8000→2048→1568）；
  非 PNG 超限明确拒绝并给缩小建议；尺寸>8000 拒绝。【单元】
- MM-05 附件状态与显示：pastedContents{id,base64,mediaType,dimensions}；输入区 [Image #N] 占位；
  提交→user 消息图片块；转录显 [Image #N]（终端支持超链接时 file:// 可点击）；不做终端像素渲染。【UI+单元】
- MM-06 图片磁盘缓存：~/.budingx/image-cache/{sessionId}/{id}.{ext}；内存映射上限 200 逐旧淘汰；私有权限。【单元】
- MM-07 协议映射：openai→user content 数组 image_url data URI；anthropic→{type:'image',source:{type:'base64',media_type,data}}；
  已知纯文本能力（档案标记）→前置明确拒绝；normalizeForApi 扩展不破坏纯文本旧路径。【单元】
- MM-08 错误驱动降级：供应商拒图错误（image+not support/unsupported/vision/multimodal/modality 等特征或
  image_url schema 拒绝）→分类 IMAGE_UNSUPPORTED→剥离最近 user 消息图片块→无图继续本回合+可见提示；后续轮无图。【单元+功能】
- MM-09 媒体数量上限：单请求≤100 媒体，超出丢最旧并可见提示（参考静默丢弃，本仓按矩阵「明确」纪律加提示，偏离登记）。【单元】
- MM-10 不支持格式拒绝：非图片二进制/不支持扩展名→明确拒绝消息，不假装已读、不提升授权。【单元+功能】

## R5 评估回归（ER）

来源：矩阵「基线与任务集」；SP001 O5=B（自有能力测量，不对照原产品）；docs/iteration-plan.md:94-99 统计纪律。

- ER-01 评估 runner：scripts/eval/ 固定任务快照（fixture 仓）+指令+可自动断言预期+允许修改范围+
  时间/token/请求预算+失败分类；确定性保护用例离线可跑；模型任务 opt-in 真实。【单元+功能】
- ER-02 基线任务集：≥12 版本化任务覆盖本轮失败类别（供应商错误恢复/错误参数/拒图降级/子代理权限取消冲突/
  MCP 失败边界/诊断准确性）＋编码回归子集（沿用 SP001 inventory）；≥3 盲测保留不参与调优。【功能】
- ER-03 评分纪律：以测试/差异正确性评分，不以模型自报评分；逐任务 pass/fail+失败类别；
  报告总体+分组，禁只选成功案例；预算上限强制。【单元+功能】
- ER-04 真实评估运行：.env.e2e.local 预算/请求帽/脱敏；summary JSON+markdown 报告入 artifacts/；
  不可用记 UNVERIFIED+恢复条件，不以 mock 冒充。【真实】
- ER-05 未测能力清单：明列未覆盖能力（团队/浏览器/CU/调度/多端等），不用功能菜单数量替代成功率。【文档+单元检查】
- ER-06 回归接线：保护用例接入 npm test 既有 glob；真实评估 opt-in 不进默认 npm test。【单元】

## R6 失败边界与宿主契约（FB）

- FB-01 联网失败不越权：WebSearch/WebFetch 失败→错误结果、权限不变、无重试风暴；页面指令不改授权（回归）。【单元+功能】
- FB-02 Hooks 失败边界：超时/崩溃/非零按 SP006 策略；禁用无隐式执行；递归/重复事件防护（回归）。【单元+功能】
- FB-03 MCP 失败边界：断线/超时/取消/输出上限→工具错误可见不越权；断连延迟工具公告移除（回归+新用例）。【单元+功能】
- FB-04 宿主契约稳定：headless stream-json 事件/终态/退出码不劣化；npm pack dry-run 产物符合性；
  不新增运行时依赖；TUI 构建通过。【单元+功能】

## 验收纪律

每条 AC 至少各一例单元+功能用例（先 RED 后 GREEN）；真实模型/进程/UI/安装证据分层记录互不冒充；
缺凭据/平台能力记 UNVERIFIED+恢复条件；bug 立即修复复测直至无 bug；门禁 GREEN 后推送功能分支，不合入 master。
MODEL_PROPOSED 项（SA-05 常量、RD-03 落点、PC-06 增强、MM-09 提示）实施前在设计固化，不静默变更已确认范围。
