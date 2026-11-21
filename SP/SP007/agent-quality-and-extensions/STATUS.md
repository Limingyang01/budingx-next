# STATUS — SP007 agent-quality-and-extensions

- 生命周期：ACTIVE（阶段1 需求已固化，进入设计）
- 更新：2026-11-21
- 分支：尚未创建（设计自审通过后从 master 4705232 拉 feature/SP007/agent-quality-and-extensions）
- 需求：requirements.md（60 AC：SA×16 / RD×16 / PC×8 / MM×10 / ER×6 / FB×4）
- 设计：design/design.zh.md（待写）；计划：design/plan.zh.md（待写）
- 验证：未开始；test-report.md 待建
- 参考：budingWorkerSpace b5c9be8（只读）；三份侦察报告已固化入需求（R1 子代理 / R2 诊断 / R3+R4 供应商与多模态）
- 关键决策：第二协议=Anthropic Messages 直连适配器；PNG 纯 JS 缩放（不引 sharp）；ToolSearch 客户端发现集；
  /doctor 警告式（修正 r5「Fix 屏」措辞）；单目录承载五工作流（沿用 SP006 先例）
- 用户指令：m00001 开发自测至无 bug→提交推送功能分支、**不合入 master**；m00014 像素级参考参考仓 TUI
- 阻塞：无（真实模型凭据 .env.e2e.local 在位；缺项将记 UNVERIFIED）
- 下一步：design.zh.md（含参考对照点与偏离登记）→自审→建分支→plan→实施
- 清理待办：工作区未跟踪侦察副产品 .recon-b1.md / .recon-b2.md / undefined/（本会话子代理产生，收尾删除，不提交）
