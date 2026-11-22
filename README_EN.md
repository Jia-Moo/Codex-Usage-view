# Codex Usage View

**A local-first, read-only token usage analytics dashboard for OpenAI Codex.**

[简体中文](README.md) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md) · [MIT License](LICENSE)

![Tests](https://github.com/Jia-Moo/Codex-Usage-view/actions/workflows/ci.yml/badge.svg)

> Explore **tokens, cache hits, project/model/session breakdowns, and API-equivalent costs** from your local Codex JSONL logs. No API key, account switching, cloud database, telemetry, or upload of conversation logs. The optional public model-price sync only runs when you explicitly request it.

**Independent community project — not affiliated with or endorsed by OpenAI.** This is an original implementation, not a fork or source-code copy of Codex Usage Desktop.

## Why use it?

Codex sessions may generate large amounts of input tokens, most of which can be cached. If you use Codex across multiple repositories, models, and agent sessions, aggregate numbers alone do not tell you:

- Which project or individual conversation consumed those tokens?
- How many were cached, and what was the cache-hit ratio?
- Which models were used within a single session?
- What would that token volume cost **at public API text-token prices**?
- Did a long-running agent session get excluded because its log was too large?

Codex Usage View answers these questions by parsing the logs already stored on your computer.

## Features

| Feature | Details |
| --- | --- |
| Overview | Input, cached input, uncached input, output, reasoning output and total tokens |
| Cache efficiency | Cache-hit ratio and estimated savings compared to uncached input |
| Projects | Group by Codex working directory (`cwd`); click a project to drill into models, dates and sessions |
| Models | Separate usage and cost by model, including sessions with model changes |
| Dates | Attribute usage to the local calendar date of its token event |
| Sessions | Search and inspect individual conversations, with per-model/date breakdown |
| API-equivalent cost | Separate input, cached-input and output rates; explicitly flag unknown prices |
| Pricing | Bundled OpenAI Standard API prices for selected model IDs, optional LiteLLM sync, manual overrides |
| Large JSONL logs | Streaming reader, no blanket 48 MiB file-size cutoff |
| Incremental index | Reuse unchanged file summaries, resume append-only logs and reparse changed/truncated ones |
| Export | Local CSV export suitable for Excel |
| Local-first UI | Simple browser dashboard served from `127.0.0.1`; no frontend build toolchain |

## Quick start

**Requirements:** Node.js **22 or later**, a current browser, and existing Codex JSONL session files. The project uses Node.js built-in modules only; **no `npm install` or API key is required.**

### Windows

1. Install [Node.js 22+](https://nodejs.org/) if it is not already present. Check with `node -v`.
2. Click **Code → Download ZIP** on this repository and extract it.
3. Double-click **`start_windows.cmd`** to launch the local dashboard.
4. Press Ctrl+C in the command window to stop the app.

For privacy-sensitive use, double-click `start_private.cmd`, which suppresses conversation title extraction.

### Git / command line (Windows, macOS, Linux)

~~~bash
git clone https://github.com/Jia-Moo/Codex-Usage-view.git
cd Codex-Usage-view
npm start
~~~

Or:

~~~bash
node src/server.mjs
~~~

The application binds to a random port on **127.0.0.1** and attempts to open the dashboard in your browser. It does not expose a hosted public service.

### Choose your Codex log directory

By default the app uses `CODEX_HOME`, or `~/.codex` if that environment variable is not defined. It scans the `sessions/` and `archived_sessions/` directories recursively for `.jsonl` logs.

~~~powershell
node src/server.mjs --root "C:\Users\YourName\.codex"
~~~

~~~bash
node src/server.mjs --port 18788 --no-browser
node src/server.mjs --hide-titles
~~~

If Codex CLI, Codex App, and/or WSL use different data directories, point the scanner to the actual directory you want to analyze.

## Cost and token methodology

The following relationships apply to each token record:

- **Uncached input** = input tokens − cached input tokens.
- **Cache-hit ratio** = cached input / input tokens, or 0 when input is zero.
- **Total tokens** = input tokens + output tokens.
- **Reasoning output** is **already part of output tokens**; it is not added a second time.
- **API-equivalent cost (USD)** = (uncached input × input price + cached input × cached-input price + output × output price) / 1,000,000.
- **Estimated savings from caching** = cost if all input were priced at the normal input rate − cache-aware cost.

The parser prefers per-call `last_token_usage` values and deduplicates identical cumulative `total_token_usage` snapshots. When per-call usage is missing, it uses cumulative deltas. Records are associated with the model active at that time, rather than the model most recently used by the session.

**Missing price does not mean zero cost.** When all relevant model prices are absent, the UI says *unpriced*. When some are missing, the visible sum is marked **≥** as a lower bound. Manual prices override bundled prices, which take precedence over optional third-party price data.

> **API-equivalent cost is not your ChatGPT Plus/Pro subscription bill, membership quota, or actual Codex Credits usage.** Pricing can change and may differ by service tier or include additional billable features. Consult the [official OpenAI API pricing](https://developers.openai.com/api/docs/pricing).

## Large logs and incremental scanning

Unlike early versions that skipped files larger than 48 MiB, the current version:

1. Reads JSONL as a stream without loading entire files into memory.
2. Limits each **individual line** to 32 MiB by default. Oversized lines are skipped with a warning.
3. Stores compact derived usage summaries and resume checkpoints locally.
4. Resumes from the last completed record when logs grow.
5. Invalidates the cached summary if the underlying file is rewritten or truncated.

The first scan must still read all historical data. Subsequent scans are faster when files are unchanged or append-only. Current support covers **plain `.jsonl` only**, not compressed `.jsonl.zst` archives.

## Security and privacy

The app is deliberately narrow in scope:

- Only Codex `sessions/**/*.jsonl` and `archived_sessions/**/*.jsonl` are read; log files are not modified.
- It does **not** open `auth.json`, `config.toml`, account credentials or browser cookies.
- The HTTP server binds only to **127.0.0.1**; API requests require a per-process random token. Host validation and restrictive browser headers are enabled.
- The frontend is served locally with **no third-party JavaScript, CDN, external fonts or telemetry SDK**.
- **No chat logs or project source code are transmitted.** The only optional outbound request retrieves a fixed public LiteLLM price JSON after you click the sync control.
- The local price file and derived usage index live under `~/.codex-usage-view/`.

**Privacy detail:** the local index may contain project paths, source log paths, session IDs, model usage and up to **110 characters of the first recognized user message** as a title. Use `--hide-titles` to avoid extracting that text. Do not share the index or unredacted raw logs in public bug reports.

Local-first software is **not automatically risk-free**; a compromised local account or operating system may access files independently of this app. Do not port-forward or publicly expose the local server. See [SECURITY.md](SECURITY.md) for the threat model.

## Project structure

~~~text
src/
  core.mjs             Session parsing, aggregation and cost calculation
  jsonl-reader.mjs      Bounded streaming JSONL reader
  usage-index.mjs       Local incremental index and file signatures
  pricing.mjs           Built-in, optional imported and manual pricing
  server.mjs            Loopback-only HTTP server
  web/                  Dashboard HTML, JavaScript and CSS
test/                   Parsing, pricing, large-file, HTTP and UI tests
start_windows.cmd       Windows launcher
start_private.cmd       Windows launcher with hidden message titles
~~~

## Developing and testing

~~~bash
npm run check
npm test
~~~

GitHub Actions runs the checks on pushes and pull requests. Tests use **synthetic JSONL fixtures** rather than exposing genuine private conversations. The large-file regression suite generates logs exceeding the former 48 MiB threshold and checks full scans, cache hits, append-resume behavior and rebuilds after file replacement.

## FAQ

**Can it show my actual Plus/Pro usage limit?**  
No. It reads token usage in available local sessions and estimates an API-equivalent value; it does not access subscription account usage endpoints.

**Why are some model costs unpriced?**  
The model ID may not have a matching rate. Check the **API Prices** page, optionally sync the public catalog or provide a manual rate.

**Are my Codex prompts uploaded?**  
No. Prompts are parsed locally to obtain an optional short session title. No conversation content is sent to a remote service.

**Can I analyze 100+ MiB JSONL files?**  
Yes. There is no blanket file-size cutoff. A single record longer than the configured 32 MiB limit is skipped with a warning.

**Do subagents count?**  
An agent with its own JSONL log is counted as a separate session. A full parent-child attribution tree has not yet been implemented.

**How do I update?**  
Stop the app, run `git pull origin main`, and start it again. ZIP users can download the current archive.

## Roadmap / Known limitations

- [ ] Compressed `.jsonl.zst` support
- [ ] Parent/child agent attribution
- [ ] Further hardening of indexing under concurrent log writes
- [ ] Better pricing provenance/version tracking
- [ ] Signed Windows native installer
- [ ] Optional dark theme and localization

The project is at **v0.3.0 (early release)**. It should not be treated as a financial accounting system or a definitive subscription usage record.

## Contributing, license, credits

Contributions, bug reports, performance improvements and security reviews are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md), and **never include unredacted conversation logs, tokens, credentials or private source code** in Issues or PRs.

Copyright © 2026 **Jia-Moo**. Licensed under the [MIT License](LICENSE).

This independent community project is not officially affiliated with or endorsed by OpenAI. OpenAI, ChatGPT and Codex are trademarks or product names of their respective owners. Thanks to the Node.js ecosystem and the optional [LiteLLM](https://github.com/BerriAI/litellm) public pricing catalog.
