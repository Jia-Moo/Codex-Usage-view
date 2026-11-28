import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rename, unlink, appendFile, stat, utimes, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdCompressSync } from "node:zlib";
import { scanCodex } from "../src/core.mjs";

const id = "deca0000-0000-4000-8000-000000000123";
const stamp = "2026-11-20T11:22:33.000Z";
const line = (type, payload) => JSON.stringify({ timestamp: stamp, type, payload }) + "\n";
function rollout(input, cached = 0, output = 10, sessionId = id) {
  return line("session_meta", { id: sessionId, cwd: "/work/demo" }) +
    line("turn_context", { model: "gpt-sample" }) +
    line("event_msg", { type: "token_count", info: {
      total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output },
    } });
}
async function sandbox(run) {
  const root = await mkdtemp(join(tmpdir(), "codex-history-audit-"));
  await mkdir(join(root, "sessions"));
  await mkdir(join(root, "archived_sessions"));
  try { await run(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}
const options = root => ({ indexFile: join(root, "stat-cache.json") });

test("stream a .jsonl.zst archive with accurate token, model, and hour rollups", () => sandbox(async root => {
  const path = join(root, "archived_sessions", "rollout-" + id + ".jsonl.zst");
  const original = rollout(1234, 900, 78);
  await writeFile(path, zstdCompressSync(Buffer.from(original)));
  const result = await scanCodex(root, options(root));
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].usage.input, 1234);
  assert.equal(result.sessions[0].usage.cached, 900);
  assert.equal(result.sessions[0].usage.output, 78);
  assert.equal(result.sessions[0].buckets[0].model, "gpt-sample");
  assert.equal(result.sessions[0].hours.length, 1);
  assert.equal(result.compressedFiles, 1);
  const second = await scanCodex(root, options(root));
  assert.equal(second.cacheHits, 1);
  assert.equal(second.sessions[0].usage.input, 1234);
  assert.equal(second.historicalSessions, 0);
}));

test("compressing and moving a session does not make all-time usage shrink or double-count", () => sandbox(async root => {
  const input = join(root, "sessions", "rollout-" + id + ".jsonl");
  const archive = join(root, "archived_sessions", "rollout-" + id + ".jsonl.zst");
  const body = rollout(2000, 1600, 80);
  await writeFile(input, body);
  const first = await scanCodex(root, options(root));
  assert.equal(first.sessions[0].usage.input, 2000);
  await writeFile(archive, zstdCompressSync(Buffer.from(body)));
  await unlink(input);
  const after = await scanCodex(root, options(root));
  assert.equal(after.sessions.length, 1);
  assert.equal(after.sessions[0].usage.input, 2000);
  assert.equal(after.sessions[0].historical, undefined);
  assert.equal(after.historicalSessions, 0);
  assert.equal(after.compressedFiles, 1);
  const still = await scanCodex(root, options(root));
  assert.equal(still.sessions[0].usage.input, 2000);
  assert.equal(still.cacheHits, 1);
}));

test("missing-source summaries remain locally with an explicit warning and may be cleared", () => sandbox(async root => {
  const file = join(root, "sessions", "rollout-" + id + ".jsonl");
  const moved = join(root, "backup.jsonl");
  await writeFile(file, rollout(501, 451, 75));
  const first = await scanCodex(root, options(root));
  assert.equal(first.sessions[0].usage.input, 501);
  await rename(file, moved);
  const second = await scanCodex(root, options(root));
  assert.equal(second.sessions.length, 1);
  assert.equal(second.sessions[0].usage.input, 501);
  assert.equal(second.sessions[0]._historical, true);
  assert.equal(second.historicalSessions, 1);
  assert.equal(second.previousTotalTokens, 576);
  assert.equal(second.currentTotalTokens, 576);
  assert.match(second.warnings.join(" "), /历史会话/);
  const cached = await scanCodex(root, options(root));
  assert.equal(cached.sessions[0].usage.input, 501);
  assert.equal(cached.historicalSessions, 1);
  // Explicitly purge missing records; should not damage original Codex files.
  const onlyPresent = await scanCodex(root, { ...options(root), keepMissing: false });
  assert.equal(onlyPresent.sessions.length, 0);
  assert.equal(onlyPresent.historicalSessions, 0);
  assert.equal(onlyPresent.previousTotalTokens, 576);
  assert.equal(onlyPresent.currentTotalTokens, 0);
  assert.match(onlyPresent.warnings.join(" "), /总 Token 比上次本机索引减少/);
  assert.equal(Object.keys(JSON.parse(await readFile(join(root, "stat-cache.json"), "utf8")).entries).length, 0);
  await rename(moved, file);
  const restored = await scanCodex(root, options(root));
  assert.equal(restored.sessions[0].usage.input, 501);
  assert.equal(restored.historicalSessions, 0);
}));

test("duplicate rollout files with one session ID select the most complete copy, not the newest mtime", () => sandbox(async root => {
  const active = join(root, "sessions", "rollout-" + id + ".jsonl");
  const archive = join(root, "archived_sessions", "rollout-" + id + ".jsonl");
  await writeFile(active, rollout(950, 300, 55));
  await writeFile(archive, rollout(120, 30, 11));
  await utimes(archive, new Date("2026-11-28"), new Date("2026-11-28"));
  const first = await scanCodex(root, options(root));
  assert.equal(first.sessions.length, 1);
  assert.equal(first.sessions[0].usage.input, 950);
  await unlink(archive);
  const second = await scanCodex(root, options(root));
  assert.equal(second.sessions.length, 1);
  assert.equal(second.sessions[0].usage.input, 950);
  assert.equal(second.historicalSessions, 0);
}));

test("truncated/replaced same-path rollout keeps prior total flagged as historical until it catches up", () => sandbox(async root => {
  const file = join(root, "sessions", "rollout-" + id + ".jsonl");
  await writeFile(file, rollout(1100, 300, 90));
  const first = await scanCodex(root, options(root));
  assert.equal(first.sessions[0].usage.input, 1100);
  await writeFile(file, rollout(101, 51, 20));
  const second = await scanCodex(root, options(root));
  assert.equal(second.sessions[0].usage.input, 1100);
  assert.equal(second.historicalSessions, 1);
  assert.match(second.warnings.join(" "), /用量减少/);
  // Cache the current file separately while retaining the high watermark.
  const third = await scanCodex(root, options(root));
  assert.equal(third.sessions[0].usage.input, 1100);
  assert.equal(third.historicalSessions, 1);
  await appendFile(file, line("event_msg", { type: "token_count", info: {
    total_token_usage: { input_tokens: 1300, cached_input_tokens: 400, output_tokens: 120 },
  } }));
  const recovered = await scanCodex(root, options(root));
  assert.equal(recovered.sessions[0].usage.input, 1300);
  assert.equal(recovered.historicalSessions, 0);
}));
