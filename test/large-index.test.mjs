import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, appendFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSession, scanCodex, priceReport } from "../src/core.mjs";

const time = "2026-11-20T11:08:06.406Z";
const json = (type, payload, timestamp = time) => JSON.stringify({ timestamp, type, payload }) + "\n";
function usage(totalInput, lastInput, cached, output) {
  return json("event_msg", { type: "token_count", info: {
    total_token_usage: { input_tokens: totalInput, cached_input_tokens: cached, output_tokens: output },
    last_token_usage: { input_tokens: lastInput, cached_input_tokens: Math.min(lastInput, cached), output_tokens: 10 },
  } });
}
async function sandbox(fn) {
  const root = await mkdtemp(join(tmpdir(), "codex-large-index-"));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test("large JSONL (>48 MiB; 9 MiB individual lines) is scanned, indexed, and append-resumed", () => sandbox(async root => {
  const sessionsDir = join(root, "sessions", "2026", "11", "20");
  const indexFile = join(root, "derived-stats.json");
  await mkdir(sessionsDir, { recursive: true });
  const file = join(sessionsDir, "rollout-test-big.jsonl");
  await writeFile(file,
    json("session_meta", { id: "test-large", cwd: "C:\\work\\robot", source: "vscode" }) +
    json("turn_context", { model: "gpt-6.2-astra" }) +
    json("response_item", { type: "message", role: "user", content: [
      { type: "input_text", text: "Big session one" },
    ] }) +
    usage(100, 100, 60, 10));
  const longToolOutput = json("response_item", { type: "custom_tool_call_output", output: "X".repeat(9 * 1024 * 1024) });
  for (let i = 0; i < 6; i++) await appendFile(file, longToolOutput);
  await appendFile(file,
    json("response_item", { type: "message", role: "user", content: [
      { type: "input_text", text: "Big session two" },
    ] }) +
    usage(140, 40, 80, 20));
  const opts = { indexFile, showTitles: true };
  const first = await scanCodex(root, opts);
  assert.equal(first.fullScans, 1);
  assert.equal(first.resumedFiles, 0);
  assert.equal(first.filesParsed, 1);
  assert.ok(first.indexedBytes > 48 * 1024 * 1024);
  assert.equal(first.sessions[0].turns, 2);
  assert.equal(first.sessions[0].title, "Big session one");
  assert.equal(first.sessions[0].usage.input, 140);
  assert.equal(first.sessions[0].usage.output, 20);
  assert.ok(!first.warnings.some(s => s.includes("跳过超大文件")));
  const indexText = await readFile(indexFile, "utf8");
  assert.ok(indexText.length < 20000, "cache should contain only small derived rollups");
  assert.doesNotMatch(indexText, /XXXXX/);
  const warm = await scanCodex(root, opts);
  assert.equal(warm.cacheHits, 1);
  assert.equal(warm.fullScans, 0);
  assert.equal(warm.indexedBytes, 0);
  assert.equal(warm.sessions[0].usage.input, first.sessions[0].usage.input);
  await appendFile(file,
    json("response_item", { type: "message", role: "user", content: [
      { type: "input_text", text: "Third turn" },
    ] }) +
    usage(180, 40, 100, 30));
  const appended = await scanCodex(root, opts);
  assert.equal(appended.resumedFiles, 1);
  assert.equal(appended.fullScans, 0);
  assert.ok(appended.indexedBytes < 4000);
  assert.equal(appended.sessions[0].turns, 3);
  assert.equal(appended.sessions[0].usage.input, 180);
  assert.equal(appended.sessions[0].usage.output, 30);
  const repeated = await scanCodex(root, opts);
  assert.equal(repeated.cacheHits, 1);
  assert.equal(repeated.sessions[0].usage.input, 180);

  // Rewriting/truncating an indexed file must invalidate its saved snapshot.
  await writeFile(file,
    json("session_meta", { id: "test-large", cwd: "C:\\work\\robot" }) +
    json("turn_context", { model: "gpt-6.2-astra" }) +
    json("event_msg", { type: "token_count", info: {
      total_token_usage: { input_tokens: 5, cached_input_tokens: 0, output_tokens: 1 },
    } }));
  const rewritten = await scanCodex(root, opts);
  assert.equal(rewritten.fullScans, 1);
  // A replaced source must not silently erase previously observed history.
  assert.equal(rewritten.sessions[0].usage.input, 180);
  assert.equal(rewritten.sessions[0]._historical, true);
  assert.match(rewritten.warnings.join(" "), /用量减少/);
  // Explicitly resetting history restores the source-only view.
  const sourceOnly = await scanCodex(root, { ...opts, keepMissing: false });
  assert.equal(sourceOnly.sessions[0].usage.input, 5);
  assert.equal(sourceOnly.historicalSessions, 0);
}));

test("a partial final JSON line is resumed once it becomes complete", () => sandbox(async root => {
  const dir = join(root, "sessions");
  await mkdir(dir);
  const file = join(dir, "partial.jsonl");
  const indexFile = join(root, "index.json");
  await writeFile(file,
    json("turn_context", { model: "gpt-test" }) +
    json("event_msg", { type: "token_count", info: {
      total_token_usage: { input_tokens: 100, output_tokens: 10, cached_input_tokens: 80 },
    } }) +
    '{"timestamp":"2026-11-20T11:10:00.000Z","type":"event_msg","payload":');
  const first = await scanCodex(root, { indexFile });
  assert.equal(first.sessions[0].usage.input, 100);
  await appendFile(file,
    '{"type":"token_count","info":{"total_token_usage":{"input_tokens":150,"cached_input_tokens":100,"output_tokens":15}}}}\n');
  const second = await scanCodex(root, { indexFile });
  assert.equal(second.resumedFiles, 1);
  assert.equal(second.sessions[0].usage.input, 150);
  assert.equal(second.sessions[0].usage.output, 15);
  const third = await scanCodex(root, { indexFile });
  assert.equal(third.cacheHits, 1);
  assert.equal(third.sessions[0].usage.input, 150);
}));

test("legacy and new user message formats do not double-count the same turns", () => sandbox(async root => {
  const file = join(root, "mixed.jsonl");
  await writeFile(file,
    json("event_msg", { type: "user_message", message: "first prompt" }) +
    json("response_item", { type: "message", role: "user", content: [{ type: "input_text", text: "first prompt" }] }) +
    json("response_item", { type: "message", role: "user", content: [{ type: "input_text", text: "second prompt" }] }) +
    json("response_item", { type: "message", role: "assistant", content: [{ type: "output_text", text: "not a user turn" }] }));
  const session = await parseSession(file, { showTitles: true });
  assert.equal(session.turns, 2);
  assert.equal(session.title, "first prompt");
}));

test("overlong individual lines are skipped with a warning but surrounding usage survives", () => sandbox(async root => {
  const dir = join(root, "sessions");
  await mkdir(dir);
  const file = join(dir, "oversize-line.jsonl");
  await writeFile(file,
    json("turn_context", { model: "gpt-test" }) +
    json("response_item", { type: "custom_tool_call_output", output: "Z".repeat(6000) }) +
    json("event_msg", { type: "token_count", info: {
      total_token_usage: { input_tokens: 40, cached_input_tokens: 12, output_tokens: 10 },
    } }));
  const parsed = await scanCodex(root, { maxLineBytes: 1024, indexFile: join(root, "idx.json") });
  assert.equal(parsed.sessions[0].usage.input, 40);
  assert.ok(parsed.warnings.some(s => s.includes("超长记录")));
  const output = priceReport(parsed, {});
  assert.equal(output.sessions[0].usage.input, 40);
}));
