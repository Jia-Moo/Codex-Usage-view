import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, utimes, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSession, scanCodex, normalizeUsage, calculateCost, priceReport } from "../src/core.mjs";
import { cleanPrices, loadPrices, saveManualPrice, syncPrices } from "../src/pricing.mjs";

function row(timestamp, type, payload) { return JSON.stringify({ timestamp, type, payload }); }
const time = "2026-11-22T10:00:00.000Z";
function token(timestamp, input, cached, output, reasoning = 0) {
  return row(timestamp, "event_msg", { type: "token_count", info: { total_token_usage: {
    input_tokens: input, cached_input_tokens: cached, output_tokens: output, reasoning_output_tokens: reasoning
  } } });
}
function fixture(id = "11111111-1111-4111-8111-111111111111") {
  return [
    row(time, "session_meta", { id, cwd: "C:\\projects\\robot", timestamp: time, source: "cli" }),
    row(time, "turn_context", { model: "gpt-sample-a" }),
    row(time, "event_msg", { type: "user_message", message: '<script>alert("test")</script> Build a robot' }),
    token(time, 100, 40, 20, 5),
    token(time, 100, 40, 20, 5),
    token("2026-11-23T01:00:00.000Z", 160, 80, 28, 7),
    row("2026-11-23T01:00:00.000Z", "turn_context", { model: "gpt-sample-b" }),
    token("2026-11-23T02:00:00.000Z", 200, 100, 38, 11),
    "{bad-json",
  ].join("\n") + "\n";
}
async function sandbox(fn) {
  const root = await mkdtemp(join(tmpdir(), "codex-usage-view-test-"));
  try { return await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test("normalizeUsage clamps cached and reasoning to their parents", () => {
  assert.deepEqual(normalizeUsage({ input_tokens: 5, cached_input_tokens: 999, output_tokens: 3, reasoning_output_tokens: 99 }),
    { input: 5, cached: 5, output: 3, reasoning: 3 });
  assert.equal(normalizeUsage(null), null);
});

test("parseSession uses cumulative deltas, no duplicate counting, correct model buckets", () => sandbox(async root => {
  const file = join(root, "rollout-11111111-1111-4111-8111-111111111111.jsonl");
  await writeFile(file, fixture());
  const s = await parseSession(file, { showTitles: true });
  assert.equal(s.id, "11111111-1111-4111-8111-111111111111");
  assert.equal(s.project, "robot");
  assert.equal(s.turns, 1);
  assert.equal(s.buckets.length, 3);
  assert.deepEqual(s.usage, { input: 200, cached: 100, output: 38, reasoning: 11 });
  assert.equal(s.warnings, 1);
  assert.equal(s.buckets.filter(b => b.model === "gpt-sample-b")[0].usage.input, 40);
  assert.match(s.title, /Build a robot/);
  const safe = await parseSession(file, { showTitles: false });
  assert.equal(safe.title, "会话 11111111");
}));

test("zero and reset counters do not create negative token values", () => sandbox(async root => {
  const file = join(root, "reset.jsonl");
  await writeFile(file, [
    row(time, "turn_context", { model: "model" }),
    token(time, 100, 20, 10),
    token("2026-11-23T01:00:00.000Z", 5, 2, 1),
  ].join("\n"));
  const s = await parseSession(file);
  assert.equal(s.usage.input, 105);
  assert.equal(s.usage.cached, 22);
  assert.equal(s.usage.output, 11);
}));

test("scanner reads ONLY session JSONL, ignores auth.json, de-duplicates archived sessions", () => sandbox(async root => {
  const folder = join(root, "sessions"), archived = join(root, "archived_sessions");
  await mkdir(folder); await mkdir(archived);
  const filename = "rollout-11111111-1111-4111-8111-111111111111.jsonl";
  await writeFile(join(root, "auth.json"), '{ "tokens": "SECRET SHOULD NOT LEAK" }');
  await writeFile(join(folder, filename), fixture());
  await writeFile(join(archived, filename), fixture());
  await utimes(join(archived, filename), new Date("2020-01-01"), new Date("2020-01-01"));
  const s = await scanCodex(root, { showTitles: false });
  assert.equal(s.filesSeen, 2);
  assert.equal(s.sessions.length, 1);
  assert.equal(s.sessions[0].usage.input, 200);
  const view = JSON.stringify(priceReport(s, {}));
  assert.doesNotMatch(view, /SECRET SHOULD NOT LEAK/);
  assert.doesNotMatch(view, /rollout-11111111-1111-4111-8111-111111111111.jsonl/);
}));

test("price uses uncached input and cached input separately; reasoning is not double-counted", () => {
  const usage = { input: 2000000, cached: 1500000, output: 1000000, reasoning: 200000 };
  const rates = { "gpt-sample": { inputPerMillion: 2, cachedPerMillion: 0.5, outputPerMillion: 8 } };
  const priced = calculateCost(usage, "gpt-sample", rates);
  assert.equal(priced.known, true);
  assert.equal(priced.usd, 9.75);
  assert.equal(priced.savedUSD, 2.25);
  assert.equal(calculateCost(usage, "unknown", rates).usd, null);
});

test("price catalog can save manual rates without reading Codex files", () => sandbox(async root => {
  const file = join(root, "settings", "prices.json");
  const result = await saveManualPrice("gpt-test", { inputPerMillion: 2, cachedPerMillion: 1, outputPerMillion: 9 }, file);
  assert.equal(result.models["gpt-test"].cachedPerMillion, 1);
  assert.equal((await loadPrices(file)).models["gpt-test"].outputPerMillion, 9);
  assert.deepEqual(cleanPrices({ valid: { inputPerMillion: 1, cachedPerMillion: 0, outputPerMillion: 2 }, bad: { inputPerMillion: -3 } }),
    { valid: { inputPerMillion: 1, cachedPerMillion: 0, outputPerMillion: 2 } });
  assert.match(await readFile(file, "utf8"), /gpt-test/);
}));

test("remote price sync only requests static LiteLLM URL; no auth or local data leaves process", () => sandbox(async root => {
  const before = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url, init });
    return { ok: true, headers: new Headers(), text: async () => JSON.stringify({
      "gpt-unit": { litellm_provider: "openai", input_cost_per_token: 0.000002, cache_read_input_token_cost: 0.000001, output_cost_per_token: 0.000008 },
      "other": { litellm_provider: "anthropic", input_cost_per_token: 0.1, output_cost_per_token: 0.1 }
    }) };
  };
  try {
    const file = join(root, "prices.json");
    const result = await syncPrices(file);
    assert.equal(result.count, 1);
    assert.equal(result.models["gpt-unit"].inputPerMillion, 2);
    assert.equal(result.models["gpt-unit"].cachedPerMillion, 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json");
    assert.equal(sent[0].init.headers.Authorization, undefined);
  } finally { globalThis.fetch = before; }
}));
