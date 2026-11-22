---
name: Bug report / 故障反馈
about: Report incorrect token counts, UI issues, or log parsing bugs using sanitized examples
title: "[Bug] "
labels: bug
assignees: ""
---

## 环境 / Environment

- OS:
- Node.js version (`node -v`):
- Codex App / CLI version (if known):
- Codex Usage View commit/version:

## 问题 / Problem

简述实际表现、预期表现和复现步骤。

## 统计上下文 / Context

- 是否为超大 JSONL 文件：
- 是否出现「未定价」：
- 日志格式：JSONL / 其他

## 最小复现 / Minimal reproduction

请**只附人工构造或完整脱敏**的最小 JSONL 示例，勿上传真实会话文件。

## 测试结果 / Diagnostics

- `npm run check`：
- `npm test`：

> **Privacy warning:** Do not post unredacted conversations, local home directories, project source code, `auth.json`, API keys or access tokens. 切勿在公开 Issue 上传未脱敏的真实日志、认证凭据或私人项目。
