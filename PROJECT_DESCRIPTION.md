# Project description / GitHub About 文案

GitHub 仓库的 **About → Description**、README 和项目介绍建议使用以下文案。

## GitHub Description（推荐，英文）

Local-first, read-only Codex token analytics. Track usage, cache hit rates, projects, models, sessions, and API-equivalent costs. No credentials or telemetry.

## GitHub 简介（中文）

本地优先、只读的 Codex Token 用量分析工具，支持项目、模型、日期和单会话统计、缓存命中率及 API 等效成本估算。不读取登录凭据，不上传聊天记录。

## 一段话介绍（中文）

**Codex Usage View** 是一款面向 OpenAI Codex App 与 Codex CLI 用户的开源本地用量分析工具。它直接读取电脑上的 JSONL 会话日志，将输入 Token、缓存输入、输出及推理 Token 按项目、模型、日期与单独会话汇总，并结合公开 API 单价估算成本和缓存节省。项目采用 Node.js 标准库实现，提供清爽的浏览器仪表盘、左右并排的 Token/费用双趋势图、交互式色块高亮及详细悬浮数据卡、单日逐小时明细、CSV 导出、超大日志流式读取和本地增量索引。不需要 API Key，也不接管 Codex 登录；仅在用户主动请求时联网获取公开模型定价。

## One-paragraph description (English)

**Codex Usage View** is an open-source, local-first usage dashboard for Codex App and Codex CLI. It reads locally stored JSONL sessions, summarizes input, cached input, output and reasoning tokens by project, model, date and individual conversation, and estimates API-equivalent costs and cache savings. Built with Node.js standard modules, it includes a clean browser dashboard, side-by-side color-coded token and API-cost trends with interactive model highlighting and rich hover details, hourly detail for single-day ranges, CSV export, streaming support for large logs and an incremental local index. No account credentials or hosted backend are required; optional public price sync is opt-in.

## GitHub Topics（可直接添加）

`codex`, `openai`, `token-usage`, `usage-analytics`, `cache-hit-rate`, `cost-estimation`, `local-first`, `privacy`, `nodejs`, `dashboard`

## 建议 Homepage

https://github.com/Jia-Moo/Codex-Usage-view

## 发布时注意

- GitHub **Settings → General → Danger Zone → Change repository visibility** 需要仓库管理员执行；文档提交并不会自动将仓库改成 Public。
- `package.json` 的 `private: true` 是阻止意外发布到 npm 的保护选项，与 GitHub 仓库 Public / Private 无关。
- 等效成本不是 ChatGPT 会员真实扣费，不要在简介中宣称可查看订阅实际余额。
- “默认不上传聊天记录”比“绝对安全、完全断网”更准确，因为价格同步功能允许用户手动进行公开网络请求。
