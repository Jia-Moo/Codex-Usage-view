# 安全说明 / Security

## 信任边界

Codex Usage View 是本地 Codex JSONL 文件的**只读分析器**。默认不发起任何对外 HTTP 请求，不提供登录、账户管理或自动更新功能。

### 读取数据

只读取用户选定 Codex 根目录中的 sessions 与 archived_sessions 子目录下的 .jsonl 文件。

不读取 auth.json、config.toml、浏览器 Cookie、环境变量中的 API Key、工作区源代码。仅通过 CODEX_HOME 环境变量定位根目录。

不会删除、改写或上传任何 Codex 会话文件。会话文本只用于在内存中选取本地显示的会话标题（可禁用）。

### 本地服务器

只监听 127.0.0.1；拒绝不符合 localhost/127.0.0.1 的 Host；所有 /api 路由要求 X-Local-Token 随机密钥；不提供 CORS 许可。

页面启用严格 Content Security Policy、禁止嵌入和第三方脚本。不支持任意 URL 打开器、Shell 命令接口。

### 联网行为

唯一主动联网操作是点击“同步公开价格”时下载固定的 LiteLLM GitHub Raw JSON。网络请求不会发送本机会话 ID、模型清单、项目目录、用户提示词或认证 Token。IP 等常规连接元数据仍可能被对方获知。

### 本地存储

~/.codex-usage-view/prices.json 仅保存用户修改或同步的价格数字。不会把 Codex 会话内容保存到应用数据库。

### 剩余风险

本机被恶意程序控制时，本应用无法保护已经能被本机账户直接读取的 Codex 文件。请在可信的系统、Node.js 安装环境中运行软件。它也无法证明上游 JSONL 记录永远完整或计算出真实的 ChatGPT 会员账单。
