import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, appendFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanCodex, parseSession, priceReport } from "../src/core.mjs";
import { loadIndex } from "../src/usage-index.mjs";

const parent = "11111111-1111-4111-8111-111111111111";
const fork = "22222222-2222-4222-8222-222222222222";
const another = "33333333-3333-4333-8333-333333333333";
const day = "2026-11-20";
const ts = time => day + "T" + time + "Z";
const line = (type, payload, stamp = ts("10:00:00.000")) =>
  JSON.stringify({ timestamp: stamp, type, payload }) + "\n";
function token(at, input, cached, output) {
  return line("event_msg", {
    type: "token_count", info: {
      total_token_usage: {
        input_tokens: input, cached_input_tokens: cached, output_tokens: output,
      },
      last_token_usage: {
        input_tokens: input, cached_input_tokens: cached, output_tokens: output,
      },
    },
  }, ts(at));
}
function log(id, calls, { copiedHeader = "", model = "gpt-fork-test" } = {}) {
  return line("session_meta", { id, cwd: "/work/robots", timestamp: ts("09:00:00.000") }) +
    (copiedHeader ? line("session_meta", {
      id: copiedHeader, cwd: "/work/original-parent", timestamp: ts("08:00:00.000"),
    }) : "") +
    line("turn_context", { model }) +
    calls.map(([stamp, input, cached, output]) => token(stamp, input, cached, output)).join("");
}
async function sandbox(fn) {
  const root = await mkdtemp(join(tmpdir(), "codex-identity-merge-"));
  try {
    await mkdir(join(root, "sessions"));
    await mkdir(join(root, "archived_sessions"));
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const opts = root => ({ indexFile: join(root, "audit-index-v3.json") });

test("first session_meta identifies fork; later copied parent header cannot override ID or cwd", () =>
  sandbox(async root => {
    const dir = join(root, "sessions");
    const parentFile = join(dir, "rollout-" + parent + ".jsonl");
    const forkFile = join(dir, "rollout-" + fork + ".jsonl");
    await writeFile(parentFile, log(parent, [["09:45:00.000", 70, 20, 0]]));
    await writeFile(forkFile, log(fork, [["11:00:00.000", 130, 90, 0]], { copiedHeader: parent }));
    const parsed = await parseSession(forkFile);
    assert.equal(parsed.id, fork);
    assert.equal(parsed.projectPath, "/work/robots");
    assert.equal(parsed._checkpoint.copiedParentIds[0], parent);
    const report = await scanCodex(root, opts(root));
    assert.equal(report.sessions.length, 2);
    assert.deepEqual(new Set(report.sessions.map(s => s.id)), new Set([parent, fork]));
    assert.equal(report.currentTotalTokens, 200);
    assert.equal(report.sessions.find(s => s.id === fork).usage.input, 130);
    const warm = await scanCodex(root, opts(root));
    assert.equal(warm.cacheHits, 2);
    assert.equal(warm.currentTotalTokens, 200);
  }));

test("disjoint same-ID segments are both counted; a copied/prefix source is deduplicated event by event", () =>
  sandbox(async root => {
    const a = log(parent, [
      ["09:00:00.000", 100, 80, 10],
      ["09:05:00.000", 150, 110, 15],
    ]);
    const b = log(parent, [
      ["18:00:00.000", 40, 20, 5],
      ["18:05:00.000", 70, 40, 6],
    ]);
    const sessions = join(root, "sessions"), archived = join(root, "archived_sessions");
    await writeFile(join(sessions, "rollout-a-" + parent + ".jsonl"), a);
    await writeFile(join(archived, "rollout-b-" + parent + ".jsonl"), b);
    await writeFile(join(archived, "rollout-copy-" + parent + ".jsonl"), a);
    let result = await scanCodex(root, opts(root));
    assert.equal(result.sessions.length, 1);
    assert.equal(result.sessions[0].usage.input, 360);
    assert.equal(result.sessions[0].usage.output, 36);
    assert.equal(result.sessions[0].sourceFiles, 3);
    assert.equal(result.sessions[0].segmentsMerged, 1);
    assert.equal(result.mergedSegments, 1);
    assert.equal(result.duplicateEventsRemoved, 2);
    assert.equal(result.currentTotalTokens, 396);
    // Stats are consistent across cold and cached reads.
    result = await scanCodex(root, opts(root));
    assert.equal(result.cacheHits, 3);
    assert.equal(result.currentTotalTokens, 396);
    const priced = priceReport(result, {
      "gpt-fork-test": { inputPerMillion: 2, cachedPerMillion: 1, outputPerMillion: 4 },
    });
    assert.equal(priced.sessions[0].buckets[0].usage.input, 360);
    assert.equal(priced.sessions[0].buckets[0].usage.output, 36);
    assert.equal(priced.sessions[0].hours.reduce((sum, item) => sum + item.usage.input, 0), 360);
  }));

test("overlap without matching event fingerprints is flagged instead of blindly double-counted", () =>
  sandbox(async root => {
    const dir = join(root, "sessions");
    const bigger = log(parent, [
      ["09:00:00.000", 800, 300, 50],
      ["10:00:00.000", 100, 30, 10],
    ]);
    const ambiguous = log(parent, [
      ["09:30:00.000", 500, 220, 40],
    ]);
    await writeFile(join(dir, "rollout-main-" + parent + ".jsonl"), bigger);
    await writeFile(join(dir, "rollout-ambiguous-" + parent + ".jsonl"), ambiguous);
    const snapshot = await scanCodex(root, opts(root));
    assert.equal(snapshot.sessions.length, 1);
    assert.equal(snapshot.currentTotalTokens, 960);
    assert.equal(snapshot.conflictingSources, 1);
    assert.match(snapshot.warnings.join(" "), /冲突的重叠日志/);
  }));

test("same-file appended metadata does not change the selected fork ID; index supports warm and resume", () =>
  sandbox(async root => {
    const file = join(root, "sessions", "rollout-" + fork + ".jsonl");
    await writeFile(file, log(fork, [["09:01:00.000", 20, 5, 2]]));
    const before = await scanCodex(root, opts(root));
    assert.equal(before.sessions[0].id, fork);
    await appendFile(file, line("session_meta", { id: parent, cwd: "/work/parent" }));
    await appendFile(file, token("09:40:00.000", 50, 30, 6));
    const after = await scanCodex(root, opts(root));
    assert.equal(after.resumedFiles, 1);
    assert.equal(after.sessions[0].id, fork);
    assert.equal(after.sessions[0].projectPath, "/work/robots");
    assert.equal(after.currentTotalTokens, 78);
  }));

test("v2 cache with corrupted identities is rejected rather than imported into v3", () =>
  sandbox(async root => {
    const file = join(root, "sessions", "rollout-" + fork + ".jsonl");
    const indexFile = join(root, "audit-index-v3.json");
    await writeFile(file, log(fork, [["09:01:00.000", 100, 30, 10]], { copiedHeader: parent }));
    await writeFile(indexFile, JSON.stringify({
      version: 2, root, showTitles: false,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      entries: { [file]: { session: { id: parent, usage: { input: 999999 } } } },
    }));
    const previous = await loadIndex(indexFile, {
      root, showTitles: false, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    assert.deepEqual(previous, {});
    const current = await scanCodex(root, { indexFile });
    assert.equal(current.fullScans, 1);
    assert.equal(current.sessions.length, 1);
    assert.equal(current.sessions[0].id, fork);
    assert.equal(current.currentTotalTokens, 110);
    assert.equal(JSON.parse(await readFile(indexFile, "utf8")).version, 3);
  }));
