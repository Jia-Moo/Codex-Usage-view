import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, appendFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSession, scanCodex, priceReport } from "../src/core.mjs";
import { loadIndex } from "../src/usage-index.mjs";

const stamp = (day, hour, minute) => new Date(2026, 10, day, hour, minute).toISOString();
const localDay = value => {
  const d = new Date(value);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
};
const line = (type, payload, timestamp) => JSON.stringify({ timestamp, type, payload }) + "\n";
const tokens = (timestamp, total, last) => line("event_msg", {
  type: "token_count", info: {
    total_token_usage: { input_tokens: total[0], cached_input_tokens: total[1], output_tokens: total[2] },
    last_token_usage: { input_tokens: last[0], cached_input_tokens: last[1], output_tokens: last[2] },
  },
}, timestamp);
const price = {
  "model-a": { inputPerMillion: 2, cachedPerMillion: 0.1, outputPerMillion: 10 },
  "model-b": { inputPerMillion: 5, cachedPerMillion: 1, outputPerMillion: 20 },
};
async function sandbox(fn) {
  const root = await mkdtemp(join(tmpdir(), "codex-hourly-"));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test("token deltas are grouped into local calendar hours by model without duplicating reasoning or snapshots", () => sandbox(async root => {
  const file = join(root, "rollout-hourly.jsonl");
  const t0 = stamp(20, 0, 10), t1 = stamp(20, 1, 15), t2 = stamp(20, 1, 40), t3 = stamp(21, 0, 5);
  const a = tokens(t0, [100, 80, 10], [100, 80, 10]);
  await writeFile(file, [
    line("session_meta", { cwd: "/work/hourly", id: "hourly-test" }, t0),
    line("turn_context", { model: "model-a" }, t0),
    a, a, // duplicated total snapshot must not count again
    tokens(t1, [250, 150, 30], [150, 70, 20]),
    line("turn_context", { model: "model-b" }, t2),
    tokens(t2, [320, 200, 50], [70, 50, 20]),
    tokens(t3, [360, 220, 60], [40, 20, 10]),
  ].join(""));
  const session = await parseSession(file);
  const day1 = localDay(t0), day2 = localDay(t3);
  assert.equal(session.buckets.length, 3);
  assert.equal(session.hours.length, 4);
  assert.deepEqual(session.usage, { input: 360, cached: 220, output: 60, reasoning: 0 });
  const getHour = (model, date, hour) => session.hours.find(x => x.model === model && x.date === date && x.hour === hour);
  assert.equal(getHour("model-a", day1, 0)?.usage.input, 100);
  assert.equal(getHour("model-a", day1, 1)?.usage.input, 150);
  assert.equal(getHour("model-b", day1, 1)?.usage.input, 70);
  assert.equal(getHour("model-b", day2, 0)?.usage.input, 40);
  const report = priceReport({ sessions: [session], scannedAt: t3, warnings: [] }, price);
  const hours = report.sessions[0].hours;
  assert.equal(hours.length, 4);
  assert.equal(hours[0].pricing.known, true);
  const dailyCost = report.sessions[0].buckets.reduce((sum, bucket) => sum + bucket.pricing.usd, 0);
  const hourlyCost = hours.reduce((sum, bucket) => sum + bucket.pricing.usd, 0);
  assert.ok(Math.abs(dailyCost - hourlyCost) < 1e-12);
  assert.equal(report.sessions[0].usage.input, hours.reduce((sum, bucket) => sum + bucket.usage.input, 0));
}));

test("v1 index is rejected and v2 hourly rollups survive cache hits and append-resume", () => sandbox(async root => {
  const dir = join(root, "sessions");
  await mkdir(dir);
  const file = join(dir, "rollout-hourly.jsonl");
  const indexFile = join(root, "usage-index.json");
  const t0 = stamp(20, 3, 12), t1 = stamp(20, 7, 45);
  await writeFile(file, line("turn_context", { model: "model-a" }, t0) +
    tokens(t0, [100, 80, 10], [100, 80, 10]));
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  await writeFile(indexFile, JSON.stringify({
    version: 1, root, showTitles: false, timeZone, entries: {
      [file]: { session: { usage: { input: 999999999 } } },
    },
  }));
  assert.deepEqual(await loadIndex(indexFile, { root, showTitles: false, timeZone }), {});
  const options = { showTitles: false, indexFile };
  const first = await scanCodex(root, options);
  assert.equal(first.fullScans, 1);
  assert.equal(first.sessions[0].hours.length, 1);
  assert.equal(first.sessions[0].usage.input, 100);
  assert.equal(JSON.parse(await readFile(indexFile, "utf8")).version, 3);
  const cached = await scanCodex(root, options);
  assert.equal(cached.cacheHits, 1);
  assert.equal(cached.sessions[0].hours.length, 1);
  await appendFile(file, tokens(t1, [160, 105, 20], [60, 25, 10]));
  const resumed = await scanCodex(root, options);
  assert.equal(resumed.resumedFiles, 1);
  assert.equal(resumed.sessions[0].hours.length, 2);
  assert.equal(resumed.sessions[0].usage.input, 160);
  const repeated = await scanCodex(root, options);
  assert.equal(repeated.cacheHits, 1);
  assert.equal(repeated.sessions[0].usage.input, 160);
}));
