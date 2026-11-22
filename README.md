# Codex Usage View

**本地优先、只读、安全、零 npm 依赖的 Codex Token 用量分析仪表盘。**

这是一个独立实现，并非 Codex Usage Desktop 的代码拷贝。借鉴了按会话、项目、模型分析的产品思路，但不使用其源码，不读取或管理登录凭据，也不提供自动更新器。

## 功能

- **总体用量**：输入、缓存输入、非缓存输入、输出、其中的推理 Token 和总 Token。
- **缓存命中率**：缓存输入 ÷ 总输入；基于 API 分级价格估算缓存节省。
- **项目分析**：按会话工作目录（cwd）分组，同名不同路径的项目不混淆；支持点击进入查看按模型、日期与对话拆分的项目用量。
- **模型分析**：每次 token_count 增量归属于当时的模型，多模型会话正确拆分。
- **日期分析**：按 Token 事件实际发生的本地日期汇总，而不是会话开始日期。
- **会话明细**：搜索会话，点击查看单个对话按模型及日期的用量详情。
- **API 等效成本**：内置常用模型的官方 Standard API 单价，按普通输入、缓存输入和输出的不同单价计价；未定价模型清晰标注。
- **可选价格同步**：只有点击按钮时才会下载 [LiteLLM 公共定价目录](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)。支持手动覆盖模型价格。
- **CSV 导出**：将当前筛选的明细导出为 Excel 可读取的 CSV，包含价格、缓存命中率。
- **自动刷新**：浏览器页面在前台时每分钟重新扫描本机日志。
- **隐藏标题**：支持隐私模式，不在界面展示第一条用户消息摘要。

## Windows 11 安装与使用

第一版是 **Node.js 标准库本机服务 + 浏览器可视化仪表盘**，不需要 Electron、Tauri 或第三方 npm 依赖。不需要联网安装 npm 包。它不是云端网站：所有统计都在你的电脑完成。

1. 安装 [Node.js 22 或更新版本](https://nodejs.org/)。可在 Windows 终端执行以下命令，之后重新启动终端：

       winget install OpenJS.NodeJS.LTS

2. 在本仓库右上角选择 **Code → Download ZIP** 并解压，或执行：

       git clone https://github.com/Jia-Moo/Codex-Usage-view.git

3. 在解压后的目录打开终端，执行：

       npm start

4. 浏览器自动打开本地界面。按 Ctrl+C 停止本机服务。

**Windows 还可直接双击根目录的 start_windows.cmd 启动**，或双击 start_private.cmd 使用隐藏标题模式（仍需预先安装 Node.js 22+）。

无需执行 npm install。

### 自定义日志位置

默认读取当前账户 CODEX_HOME 环境变量指定的目录，否则读取用户主目录下的 .codex。

Windows 显式指定：

    node src/server.mjs --root "C:\Users\YourName\.codex"

从 Windows 读取 WSL 的示例：

    node src/server.mjs --root "\\wsl.localhost\Ubuntu\home\user\.codex"

隐藏对话标题：

    npm run start:private

自定义端口且不自动打开浏览器：

    node src/server.mjs --port 18788 --no-browser

日志应位于所选目录的 sessions/ 或 archived_sessions/ 下。Codex App 和 CLI 是否共用 CODEX_HOME 取决于你的配置。

## v0.2.0：费用自动显示与项目详情

- **已解决首次运行费用为 0 的问题**：内置 2026-11-22 核查的 OpenAI 官方 Standard API 模型价格，包括 \`gpt-5.1/5.2/5.3-codex\`、\`gpt-6.1-sol\`、\`gpt-6.1-terra\`、\`gpt-6-luna\`、\`gpt-6.2-sol\` 与 \`gpt-6.2-astra\`。常见模型的等效价格不用点击同步便可计算。
- **未知模型绝不被当作 0 美元**：显示“未定价”，若部分模型价格已知，则显示“≥ 已知成本”，并在 API 价格页列出未识别模型供补全。
- **手动价格 > 已验证内置官方价格 > LiteLLM 同步价格**；手动覆盖不会因再次同步被清除。
- **项目详情**：在“项目分析”里点击项目名称，即可查看该项目按模型拆分的输入、缓存、输出、命中率、成本、Token 占比，继续下钻到日期和会话。
- **视觉更新**：由紫色渐变深色界面调整为素雅的浅色中性数据工具风格。
- 等效费用始终只是按 **Standard API 文本 Token 单价** 估算，不含不同计费服务层、长上下文溢价、缓存写入附加费、工具调用费，也不是 Codex 会员实际扣费。某些模型如果没有官方可用单价，会继续显示未定价。

内置费率可在以下 [OpenAI 官方定价页面](https://developers.openai.com/api/docs/pricing) 核查；首次运行不联网，同步缺失价格仍是可选操作。


## 数据统计口径

| 项目 | 计算方式 |
|---|---|
| 输入 Token | 普通输入 + 缓存输入 |
| 总 Token | 输入 + 输出 |
| Reasoning Token | **已经计入输出**，不能重复相加 |
| 缓存命中率 | 缓存输入 / 输入 |
| API 等效成本 | (非缓存输入 × 输入单价 + 缓存输入 × 缓存单价 + 输出 × 输出单价) / 1000000 |
| 缓存节省 | 所有输入按普通输入计价 - 实际分级计价 |

价格均为 USD / 百万 Token。没有价格的模型不会假装免费：标记为未定价，已知成本属于**不完整的部分合计**。

首次运行不会联网，内置的已核实官方价格会立即生效；打开 **API 价格 → 同步其他模型价格** 后才下载第三方定价 JSON。LiteLLM 可能滞后，遇到差异以 [OpenAI 官方 API 定价](https://openai.com/api/pricing/) 为准。

**等效成本不是 ChatGPT Plus / Pro 会员的实际账单、会员配额消耗或 Codex Credits。** 本工具不会访问账户额度 API。

### Token 差分逻辑

读取 Codex 的 event_msg.token_count.info.total_token_usage 累计快照，逐次求非负差分；累计相同的快照不会重复计数。若计数器发生下降，视为开启新段；有 last_token_usage 时优先使用其单次用量并依靠累计值去重。若缺少累计快照，则尽力使用 last_token_usage。模型归属取对应 turn_context 中的 model。

Codex 日志格式会随版本更新而变化。如果本机日志没有 token_count 或模型信息，本工具无法推断丢失的数据。

## 隐私与安全

- **不会读取 auth.json、API Key、Refresh Token 或任何登录凭据**。
- 只遍历指定 Codex 根目录的 sessions/**/*.jsonl 和 archived_sessions/**/*.jsonl，不跟随符号链接。
- 本机服务仅绑定 127.0.0.1，并校验 Host；统计 API 使用进程级随机令牌。
- 资源全部本机加载；无云数据库、遥测、第三方脚本或自动更新服务器。
- 同步定价时只向固定的 GitHub Raw URL 发起请求，不附加本机模型、项目、聊天内容或凭据。
- 仅在用户主目录下的 .codex-usage-view/prices.json 保存价格配置，不保存会话原文。
- 默认在本机界面显示第一条用户消息的前 110 字作为会话标题；可使用 --hide-titles 禁用。
- 导出文件在用户当前浏览器本地生成，不发送到服务器。

见 [SECURITY.md](SECURITY.md)。

## 开发与测试

需要 Node.js 22+：

    npm run check
    npm test

CI 使用 GitHub Actions 在 push 和 Pull Request 时运行上述检查。

## 当前限制

- 当前只解析 .jsonl；暂不解析压缩的 .jsonl.zst 归档。
- 子 Agent 如果拥有独立会话日志，会作为单独会话统计，暂未构建父子 Agent 归属树。
- 历史日志如果被删除或缺失，无法从会员后台恢复。
- 单价可能缺失或滞后，需要同步/手动输入后估算。
- **手动费率再次同步时可能被覆盖**（后续版本考虑单独保存覆盖表）。
- 会话非常多时刷新需要时间；当前尚未实现增量索引。
- 暂无独立 Windows EXE；此版本优先建立可审核的统计核心及界面。

## 许可

本项目采用 MIT License（[LICENSE](LICENSE)）。
