# Codex Usage View

**A local-first, read-only token usage analytics dashboard for OpenAI Codex.**

[简体中文](README.md) · [Changelog](CHANGELOG.md) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md) · [MIT License](LICENSE)

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
| Dates | Attribute usage to the event's local calendar date, or to individual hours for single-day charts |
| Date ranges | Today, last 7/30/90/365 days, all time, or a custom inclusive start/end date |
| Sessions | Search and inspect individual conversations, with per-model/date breakdown |
| API-equivalent cost | Separate input, cached-input and output rates; a color-coded cost trend and explicit warnings for unknown prices |
| Pricing | Bundled OpenAI Standard API prices for selected model IDs, optional LiteLLM sync, manual overrides |
| Large JSONL logs | Streaming reader, no blanket 48 MiB file-size cutoff |
| Incremental index | Reuse unchanged file summaries, resume append-only logs and reparse changed/truncated ones |
| Export | Local CSV export suitable for Excel |
| Usage and cost trends | Side-by-side charts with hover zoom, linked-model highlighting, detailed floating inspector and hourly detail |
| Local-first UI | Simple browser dashboard served from `127.0.0.1`; no frontend build toolchain |

## Quick start

**Requirements:** Node.js **22.15.0 or later**, a current browser, and existing Codex JSONL session files. The project uses Node.js built-in modules only; **no `npm install` or API key is required.**

### Windows

1. Install [Node.js 22.15+](https://nodejs.org/) if it is not already present. Check with `node -v`.
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

By default the app uses `CODEX_HOME`, or `~/.codex` if that environment variable is not defined. It scans the `sessions/` and `archived_sessions/` directories recursively for `.jsonl` and `.jsonl.zst` logs.

~~~powershell
node src/server.mjs --root "C:\Users\YourName\.codex"
~~~

~~~bash
node src/server.mjs --port 18788 --no-browser
node src/server.mjs --hide-titles
~~~

If Codex CLI, Codex App, and/or WSL use different data directories, point the scanner to the actual directory you want to analyze.

## v0.5.4: Fix shrinking all-time usage totals

**Root causes:** previous versions only scanned plain `.jsonl` and silently dropped sessions when their source files disappeared or became inaccessible. When several rollouts shared one session ID, the newest file modification time could select a less complete copy.

- **Read archived `.jsonl.zst` files** using Node.js built-in Zstandard streaming decompression, alongside `.jsonl` in both active and archived session directories. Compressed files are reused from the derived index when unchanged and fully reparsed when changed.
- **Retain disappeared-source history locally** and mark it as **historical cache**, rather than silently subtracting it from all-time totals. A reappearing or complete compressed copy can replace this cache.
- **Prefer the more complete duplicate** when several files share one session ID; do not add duplicate copies together.
- **Flag truncation or replacement** when a file's recomputed usage is lower than its prior cached value. Retain the last-known higher total with a warning until new data overtakes it.
- **Surface diagnostics** for inaccessible directories and files, compressed archive counts, historical cached sessions, and unexpected drops versus the previous indexed all-time token total.
- **Explicitly forget missing history** by stopping the app and running `node src/server.mjs --drop-missing`. This removes derived summaries whose original files are absent (and historical high-water values for replaced files) without touching Codex's original logs.

**Privacy:** local `~/.codex-usage-view/usage-index-v2-*.json` files can retain historical statistics, project paths, session IDs and optional short user-message titles *after the original rollout is deleted*. Delete the local index files to erase this derived history and force a full rescan. These files are never uploaded by this app.

**Requirement:** Node.js **22.15.0+** (Node 24 recommended). The built-in Zstandard API is still marked experimental in the Node 22 documentation. Actual ChatGPT subscriber charges cannot be derived from these statistics.


## v0.5.3: Show the latest timeline periods by default

- **Latest first on entry:** both the Token usage and API-equivalent cost charts automatically scroll to their respective **rightmost positions** when the overview first opens.
- **Independent scroll positions:** each chart is positioned according to its own content width.
- **Respect manual history browsing:** after dragging a chart back to earlier dates or hours, an automatic refresh preserves that chart's position. A chart that was already at the right edge follows newly appended data.
- **Reset on filter or navigation changes:** date range, project, model, and search changes default back to the latest period, as does re-entering the overview page.
- **No-overflow behavior:** a chart narrower than its viewport remains at scroll offset zero.

This is a frontend-only change: **no updates to token accounting, cost formulas, local logs, or derived-index schemas**.

## v0.5.2: Interactive model segments and rich hover inspector

- **Tactile hover**: chart segments subtly enlarge, brighten and cast a soft shadow when hovered; the animation respects the operating system's reduced-motion preference.
- **Linked highlighting**: hovering a chart segment or its in-card legend highlights the same model across both Token and API-cost charts, dimming unrelated models.
- **Follow-the-pointer inspector**: replaces the native one-line `title` tooltip with a floating detailed card that flips/clamps near viewport edges and is not clipped by horizontally scrolling charts.
- **Detailed metrics**: full model name, local time period, metric value, share of the current period, input, cached/uncached input, output, reasoning output, cache hit rate, API-equivalent cost and estimated savings.
- **Correct intra-model navigation**: moving between different hours of the same model updates the inspector immediately.
- **Keyboard/touch support**: segments can receive Tab focus; click/tap pins the card and another click or Escape dismisses it.
- **No additional data collection**: all inspector data comes from existing local usage rollups; no external requests, dependencies, accounting changes or cache migration.


## v0.5.1: Side-by-side trends and compact in-card legends

- **Side-by-side on desktop:** Token usage is shown on the left and API-equivalent cost on the right, enabling direct comparison without vertical scrolling.
- **Legend in the top-right of each card:** Every chart has its own compact model legend with color swatches, model names (hover for full names when truncated), and percentages. The old standalone legend card is removed.
- **Clear share denominators:** The token chart shows each model's share of selected tokens; the cost chart shows its share of **known API-equivalent cost**. Model colors are identical across charts. Models with no usable price show **unpriced**, not an invented zero-cost percentage.
- **Compact at six or more models:** The legend displays up to six models directly in two columns and offers an expandable **N more models** list when needed.
- **Responsive:** The two charts stack vertically on narrower screens, with their legends remaining inside each panel. Dense hourly bars can still scroll horizontally.
- **Presentation-only update:** Token accounting, day/hour aggregation, and equivalent-cost calculations are unchanged.

## v0.5.0: Model-stacked usage and cost trends, with hourly detail

- **24-hour view for a single local day**: selecting **Today** or a custom range with identical start/end dates switches both trend charts to 24 hourly bins (00:00–23:00), using actual token-event timestamps rather than evenly distributing daily totals.
- **Color-coded model stacks**: each column is a stack of model-specific color segments. Token and cost charts share a deterministic model palette and legend. Hover a segment to inspect the amount and percentage contributed by that model in the period.
- **API-equivalent cost trend**: the second chart calculates estimated USD equivalents by time period and model using separate uncached-input, cached-input and output rates. Unknown prices are **not silently interpreted as zero**; partial or completely unavailable prices are clearly indicated.
- **Hourly detail table**: on a single day, a 24-row table also displays input, cached input, output, total tokens, cache-hit ratios, estimated costs and model names, including empty hours.
- **Multi-day range aggregation**: 2–31 days use daily bars, 32–180 days use weekly bars, and longer ranges use monthly bars. The trend covers the entire selected period.
- **Local index schema v2**: hourly aggregates require a one-time local rescan after upgrading to v0.5.0. Old Codex session JSONL files remain untouched, no raw logs are uploaded, and subsequent scans still benefit from append-only caching.
- **CSV remains date-level**: the single-day hourly detail is currently displayed in the dashboard, while the existing CSV export retains its date/model/session granularity.

**The displayed prices are API-equivalent estimates using the currently configured model rates, not actual ChatGPT subscription billing.** Reasoning tokens remain a subset of output tokens.


## v0.4.0: Today and custom date ranges

Use the **Time range** dropdown to choose **Today**, the last 7/30/90/365 days, **All time**, or **Custom date range**.

For a custom range, select a start and end date using the two native date pickers. They are prefilled with the last 30 days on first use. Both boundary days are **included**; ranges spanning months or years are supported. The app interprets token-event timestamps using the computer's **local calendar date** rather than the conversation creation date.

The same date filter applies to the overview metrics, cache statistics, project and model breakdowns, individual session summaries, and exported CSV files. Invalid, missing or reversed dates display a validation message and disable export; they never silently include all history.

Single-day ranges now show 24 local-hour bars and an hourly table. Multi-day charts aggregate daily, weekly or monthly depending on the selected span, covering the **entire** range.

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

The first scan must still read all historical data. Subsequent scans are faster when files are unchanged or append-only. Both plain `.jsonl` and Zstandard-compressed `.jsonl.zst` are supported. Compressed files are fully reparsed when changed but cached when unchanged.

## Security and privacy

The app is deliberately narrow in scope:

- Only Codex `.jsonl` and `.jsonl.zst` session logs in `sessions/` and `archived_sessions/` are read; log files are not modified.
- It does **not** open `auth.json`, `config.toml`, account credentials or browser cookies.
- The HTTP server binds only to **127.0.0.1**; API requests require a per-process random token. Host validation and restrictive browser headers are enabled.
- The frontend is served locally with **no third-party JavaScript, CDN, external fonts or telemetry SDK**.
- **No chat logs or project source code are transmitted.** The only optional outbound request retrieves a fixed public LiteLLM price JSON after you click the sync control.
- The local price file and derived usage index live under `~/.codex-usage-view/`. Statistics from files no longer available may remain in that index until explicitly cleared.

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

The project is at **v0.5.4 (early release)**. It should not be treated as a financial accounting system or a definitive subscription usage record.

## Contributing, license, credits

Contributions, bug reports, performance improvements and security reviews are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md), and **never include unredacted conversation logs, tokens, credentials or private source code** in Issues or PRs.

Copyright © 2026 **Jia-Moo**. Licensed under the [MIT License](LICENSE).

This independent community project is not officially affiliated with or endorsed by OpenAI. OpenAI, ChatGPT and Codex are trademarks or product names of their respective owners. Thanks to the Node.js ecosystem and the optional [LiteLLM](https://github.com/BerriAI/litellm) public pricing catalog.
