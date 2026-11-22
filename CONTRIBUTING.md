# 参与贡献 / Contributing

感谢对 Codex Usage View 的关注。本项目希望保持**本地优先、只读、轻量、可审计**的设计目标。

Thank you for contributing. Please preserve the project's **local-first, read-only, lightweight and auditable** design.

## 开始之前 / Before contributing

- 在最新 `main` 分支上复现问题，并确认使用 **Node.js 22+**。
- 查阅 [README.md](README.md)、[README_EN.md](README_EN.md) 和 [SECURITY.md](SECURITY.md)。
- 提交 Issue 时写清：操作系统、Node 版本、Codex 客户端及版本（如已知）、复现步骤、预期与实际行为。
- **请勿上传未经脱敏的 JSONL 会话、auth.json、访问令牌、API Key、私人项目源码、项目路径或聊天截图**。
- Do not attach unredacted conversation logs, credentials, private project paths, or source code to public issues.

## 如何本地验证 / Run checks

~~~bash
npm run check
npm test
~~~

当前运行时没有第三方 npm 包，不需要执行 `npm install`。测试必须可在无 OpenAI 登录信息和无私人日志的情况下运行。

There are no third-party runtime npm dependencies. Tests must not require real Codex credentials or personal logs.

## 提供最小复现样例 / Minimal reproduction

请构造**人工合成**的 JSONL 行，而不是复制真实对话内容：

~~~json
{"timestamp":"2026-01-01T12:00:00Z","type":"turn_context","payload":{"model":"example-model"}}
{"timestamp":"2026-01-01T12:01:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":60,"output_tokens":20}}}}
~~~

提交 Token 算法修复时，请特别测试：重复快照、切换模型、计数器重置、断行追加、长单行、日志截断和缺失价格。

## 开发原则 / Design principles

1. **只读 Codex 原始日志**：不得编辑、删除或移动用户的 Codex 会话文件。
2. **不接触认证凭据**：不得增加对 `auth.json`、登录 Cookie、API Key 或刷新令牌的访问。
3. **网络访问可控**：不能默认上传项目路径、会话内容或会话 ID；任何新增联网功能都需要明确说明，并优先选择显式用户操作。
4. **不夸大安全性**：准确记录本地缓存可能含有的私人元数据。
5. **统计必须可验证**：新增解析或费率逻辑请补充合成测试。
6. **缺失信息不伪造**：未知模型费率应显示未定价，不能假装为零。
7. **减少依赖**：如果新增第三方依赖，请说明其必要性和安全影响。

## Pull Request 建议

- PR 主题明确，描述改动动机、影响范围和测试结果。
- 涉及用户界面时，附上**不包含个人会话或路径信息**的截图（可用合成数据）。
- 涉及隐私、文件保存或网络请求时，同步更新 `SECURITY.md` 与 README。
- 如果改变扫描口径或成本公式，请给出前后结果与复现测试，避免静默改变历史统计。

## 安全问题 / Security reports

若发现可利用的安全漏洞，请优先通过非公开渠道联系维护者，**不要**在公开 Issue 中发布攻击细节、凭据或私人日志。详细边界参见 [SECURITY.md](SECURITY.md)。

## License

提交代码即表示你同意以本仓库的 **MIT License** 发布该贡献。请确认你有权贡献所有提交内容。
