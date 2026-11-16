# 简易 TUI 与首个 npm 发布

USER_CONFIRMED：MIT；OpenAI 兼容 API、配置和流式对话；验证后发布 budingx；不启动规划中高级功能开发。本轮仅此局部授权，不开展全套 SDD。

采用 Node >=22.18、TypeScript 编译为 ESM，产品单元 src/tui；无运行时第三方依赖。会话只驻留内存，不自动读写用户配置/历史；配置来自显式参数与 BUDINGX_* 环境变量，不扫描其他工具凭据。依次实现配置校验/流式客户端、终端入口，再版本准备/打包发布。root private 维护包和产品包分开。

验收：help/version；缺模型/密钥/坏 URL 可诊断；显式本机 HTTP 可调试但非本机凭据只发 HTTPS；SSE 中文/跨块、异常/截断、取消和请求超时正确；多轮只记录成功回答，失败/取消不伪造完成；/help /config /model /endpoint /clear /exit 可用；无工具执行/持久化/共享功能声明。真实测试 HTTP fixture→CLI→隔离安装 tarball 通过，真实外部 Provider 未授权凭据时单独标未验证。发布前 MIT/白名单/秘密扫描/测试与制品验证，发布后核对 npm integrity 与重新安装。

版本 0.1.0；用户已授权 npm 发布，Git 提交/推送未授权。产品目录及公开协议独立编写，不复制旧源码或提示词。
