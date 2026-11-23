# Changelog / 更新日志

All notable changes are documented here. Versions follow the version in `package.json`.

## [0.5.3] — 2026-11-23

### Changed / 优化

- Both usage and API cost charts start horizontally scrolled to the rightmost (newest) time period.
- Preserve manually selected historical positions during automatic refresh; charts already at the right edge continue following new data.
- Reset both charts to newest on filter changes or when returning to the overview.
- Added regression tests for independent chart positioning, refresh behavior, and non-overflow cases.
- No new dependencies, network behavior, or local index migration.

## [0.5.2] — 2026-11-23

### Added / 新增

- Smooth hover expansion, brightness and shadow feedback on stacked model chart segments.
- Model-linked highlighting across both charts and their legend swatches.
- Cursor-following, viewport-constrained floating tooltip with per-period model breakdown: tokens, cached/uncached input, output and reasoning tokens, cache hit ratio, API-equivalent USD cost, estimated cache savings, and share of the period.
- Keyboard focus and click/tap-to-pin interaction with Escape dismissal.
- Reduced-motion CSS behavior for accessibility.
- Tests for precise hover updates, missing-price messaging, tooltip escaping and interaction behavior.

### Notes / 说明

- Presentation-only change; **no modified token accounting, pricing, local index or outbound networking**.
- User-supplied model text is HTML-escaped before display.


## [0.5.1] — 2026-11-23

### Changed / 布局改进

- Place the two usage trends **side by side** on desktop (Token on the left, API-equivalent cost on the right).
- Move the model color guide to the **top-right inside each chart card**, replacing the oversized separate legend card.
- Use compact two-column legend labels with model color, name and metric-specific percentage.
- Preserve the same model colors across charts while distinguishing Token share from known-cost share.
- Provide expandable additional-model entries and responsive one-column layout on smaller displays.
- Reduce horizontal chart padding and unnecessary hour labels to improve side-by-side readability.
- Updated Chinese/English READMEs and layout regression tests; no token-accounting or pricing changes.

## [0.5.0] — 2026-11-23

### Added / 新增

- Token trend chart with stacked, consistently colored segments for each model.
- API-equivalent cost trend chart with matching model colors, independent cost axis and tooltips.
- Hourly charts (24 bins) when selecting **Today** or a custom date range with the same start/end date.
- An hourly table showing input, cached input, output, total tokens, cache-hit ratio, estimated costs and models.
- Time-aware grouping: daily (2–31 days), weekly (32–180 days), monthly (longer).

### Changed / 调整

- Local usage-index schema upgraded from v1 to v2 to store per-model hourly derived usage.
- Existing users get a **one-time complete rescan** on first launch of v0.5.0; source Codex JSONL logs are not modified.
- Both charts clearly flag missing model prices rather than treating unknown prices as zero.
- Model colors are consistent across both charts and legend.
- Updated Chinese and English READMEs, project description, and version metadata.

### Notes / 说明

- Hourly data is derived from **local timestamps of actual token events**, not approximated from day totals.
- Hourly details currently appear in the UI. CSV export remains grouped by date/model/session.
- Cost is an **API-equivalent estimate**, not actual ChatGPT subscription charges.

## [0.4.0] — 2026-11-23

- Today and custom inclusive date ranges, with local-calendar filtering and validation.

## [0.3.0] — 2026-11-22

- Streaming large JSONL logs, append-only resume and local derived-statistics index.
- Improved user-message compatibility and scan-status diagnostics.

## [0.2.0] — 2026-11-22

- Built-in Standard API-equivalent pricing, explicit unknown-price handling, project model drill-down.
- Neutral light UI design.

## [0.1.0] — 2026-11-22

- Initial local-only Codex usage dashboard, project/model/session/date breakdowns and CSV export.
