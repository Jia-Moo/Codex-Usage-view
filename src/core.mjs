/**
 * Codex JSONL reader. Read-only: only sessions/ and archived_sessions/ are traversed.
 * Raw prompts, tool output and credentials are never persisted or sent to a server.
 */
import { createReadStream } from "node:fs";
import { opendir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline";

const METRICS = ["input", "cached", "output", "reasoning"];
const ZERO = () => ({ input: 0, cached: 0, output: 0, reasoning: 0 });
const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
const safeNum = n => Number.isFinite(Number(n)) && Number(n) >= 0 ? Math.floor(Number(n)) : 0;
const iso = s => { const date = new Date(s); return Number.isFinite(date.getTime()) ? date.toISOString() : null; };
const dayOf = s => {
  const date = s ? new Date(s) : null;
  if (!date || !Number.isFinite(date.getTime())) return null;
  const y = date.getFullYear(), m = String(date.getMonth() + 1).padStart(2, "0"), d = String(date.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
};

export function normalizeUsage(value) {
  if (!isObj(value)) return null;
  const input = safeNum(value.input_tokens ?? value.input ?? 0);
  return {
    input,
    cached: Math.min(input, safeNum(value.cached_input_tokens ?? value.cached ?? 0)),
    output: safeNum(value.output_tokens ?? value.output ?? 0),
    reasoning: Math.min(safeNum(value.output_tokens ?? value.output ?? 0), safeNum(value.reasoning_output_tokens ?? value.reasoning ?? 0)),
  };
}
export function addUsage(a, b) { return Object.fromEntries(METRICS.map(k => [k, (a?.[k] || 0) + (b?.[k] || 0)])); }
export function totalTokens(u) { return (u?.input || 0) + (u?.output || 0); }
export function hitRate(u) { return u?.input ? u.cached / u.input : 0; }

function deltaFrom(previous, current) {
  if (!previous) return current;
  // Some Codex versions reset the cumulative counters on compact/restart.
  // A lower counter is treated as a new segment rather than negative usage.
  const reset = current.input < previous.input || current.output < previous.output || current.cached < previous.cached;
  if (reset) return current;
  return Object.fromEntries(METRICS.map(k => [k, Math.max(0, current[k] - previous[k])]));
}
function sessionIdFromFile(path) {
  return basename(path).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i)?.[1] || basename(path, ".jsonl");
}
function projectLabel(path) {
  if (!path) return "未知项目";
  const value = path.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
  return value || path;
}
function cleanTitle(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, 110);
}

/**
 * Handles cumulative total_token_usage snapshots, avoids duplicated snapshots,
 * and attributes each delta to the active model and the event's local date.
 */
export async function parseSession(filePath, { showTitles = false } = {}) {
  const summary = {
    id: sessionIdFromFile(filePath), file: filePath, projectPath: "", project: "未知项目",
    title: "", started: null, lastSeen: null, turns: 0, source: "",
    buckets: [], usage: ZERO(), warnings: 0,
  };
  let previous = null;
  let activeModel = "未知模型";
  let timestamp = null;
  let firstTimestamp = null;
  let lastTimestamp = null;
  const buckets = new Map();
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      let evt;
      try { evt = JSON.parse(line); } catch { summary.warnings++; continue; }
      if (!isObj(evt)) continue;
      timestamp = iso(evt.timestamp);
      if (timestamp) {
        firstTimestamp ||= timestamp;
        lastTimestamp = timestamp;
      }
      const p = evt.payload;
      if (!isObj(p)) continue;
      if (evt.type === "session_meta") {
        if (typeof p.id === "string" && p.id.length <= 128) summary.id = p.id;
        if (typeof p.cwd === "string") summary.projectPath = p.cwd;
        summary.started = iso(p.timestamp) || summary.started;
        summary.source = typeof p.source === "string" ? p.source : summary.source;
        continue;
      }
      if (evt.type === "turn_context") {
        if (typeof p.model === "string" && p.model) activeModel = p.model;
        if (typeof p.cwd === "string" && p.cwd) summary.projectPath = p.cwd;
        continue;
      }
      if (evt.type !== "event_msg") continue;
      if (p.type === "user_message") {
        summary.turns++;
        if (showTitles && !summary.title) summary.title = cleanTitle(p.message);
      }
      if (p.type !== "token_count" || !isObj(p.info)) continue;
      const current = normalizeUsage(p.info.total_token_usage);
      const last = normalizeUsage(p.info.last_token_usage);
      let delta = null;
      if (current) {
        // last_token_usage is the per-call figure emitted by Codex itself.
        // The total snapshot protects against duplicate log events.
        const unchanged = previous && METRICS.every(k => previous[k] === current[k]);
        delta = unchanged ? ZERO() : (last || deltaFrom(previous, current));
        previous = current;
      } else if (last) {
        // Legacy snapshots can omit totals. This is best-effort and indicated in docs.
        delta = last;
        previous = null;
      }
      if (!delta || totalTokens(delta) === 0) continue;
      const model = [p.info.model, p.model, p.info.model_name, p.info.modelName, activeModel]
        .find(value => typeof value === "string" && value.length) || "未知模型";
      const date = dayOf(timestamp || summary.started);
      if (!date) { summary.warnings++; continue; }
      const key = JSON.stringify([model, date]);
      const old = buckets.get(key) || { model, date, usage: ZERO() };
      old.usage = addUsage(old.usage, delta);
      buckets.set(key, old);
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  summary.started ||= firstTimestamp || lastTimestamp;
  summary.lastSeen = lastTimestamp || summary.started;
  summary.project = projectLabel(summary.projectPath);
  summary.title ||= "会话 " + summary.id.slice(0, 8);
  summary.buckets = [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
  summary.usage = summary.buckets.reduce((sum, b) => addUsage(sum, b.usage), ZERO());
  return summary;
}

async function* sessionFiles(path, maxDepth = 5) {
  if (maxDepth < 0) return;
  let dir;
  try { dir = await opendir(path); } catch { return; }
  for await (const entry of dir) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) yield* sessionFiles(full, maxDepth - 1);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) yield full;
    // Never follow symlinks or parse arbitrary files, including auth.json.
  }
}

export async function scanCodex(root, { showTitles = false, maxFiles = 60000, maxBytes = 48 * 1024 * 1024 } = {}) {
  root = resolve(root);
  const folders = [join(root, "sessions"), join(root, "archived_sessions")];
  const sessions = new Map();
  const warnings = [];
  let filesSeen = 0, filesParsed = 0, malformedLines = 0;
  for (const folder of folders) {
    for await (const file of sessionFiles(folder)) {
      filesSeen++;
      if (filesSeen > maxFiles) { warnings.push("文件数量超过安全扫描上限，其余文件未扫描"); break; }
      let meta;
      try { meta = await stat(file); } catch { continue; }
      if (meta.size > maxBytes) { warnings.push("跳过超大文件：" + basename(file)); continue; }
      try {
        const entry = await parseSession(file, { showTitles });
        entry.file = file;
        entry.mtime = meta.mtimeMs;
        filesParsed++;
        malformedLines += entry.warnings;
        const old = sessions.get(entry.id);
        if (!old || old.mtime < entry.mtime) sessions.set(entry.id, entry);
      } catch (error) {
        warnings.push("无法读取 " + basename(file) + "：" + String(error.message || error));
      }
    }
  }
  const sorted = [...sessions.values()].sort((a, b) => (b.lastSeen || "").localeCompare(a.lastSeen || ""));
  return {
    root, scannedAt: new Date().toISOString(), filesSeen, filesParsed,
    malformedLines, warnings: warnings.slice(0, 40),
    sessions: sorted,
  };
}

export function priceForModel(model, prices) {
  if (!isObj(prices)) return null;
  const candidates = [
    model, model.replace(/^openai\//, ""),
    "openai/" + model.replace(/^openai\//, ""),
  ];
  for (const name of candidates) {
    const p = prices[name];
    if (p && [p.inputPerMillion, p.cachedPerMillion, p.outputPerMillion].every(v => typeof v === "number" && Number.isFinite(v) && v >= 0)) return p;
  }
  return null;
}

export function calculateCost(usage, model, prices) {
  const price = priceForModel(model, prices);
  if (!price) return { known: false, usd: null, savedUSD: null };
  const uncached = Math.max(0, usage.input - usage.cached);
  const usd = (uncached * price.inputPerMillion + usage.cached * price.cachedPerMillion + usage.output * price.outputPerMillion) / 1e6;
  const noCache = (usage.input * price.inputPerMillion + usage.output * price.outputPerMillion) / 1e6;
  return { known: true, usd, savedUSD: noCache - usd };
}

export function priceReport(snapshot, prices) {
  const available = new Set(Object.keys(prices || {}));
  const sessions = snapshot.sessions.map(entry => ({
    id: entry.id, title: entry.title, projectPath: entry.projectPath, project: entry.project,
    started: entry.started, lastSeen: entry.lastSeen, turns: entry.turns,
    source: entry.source, usage: entry.usage, warnings: entry.warnings,
    buckets: entry.buckets.map(bucket => ({
      ...bucket, pricing: calculateCost(bucket.usage, bucket.model, prices),
    })),
  }));
  return {
    meta: {
      scannedAt: snapshot.scannedAt, root: snapshot.root, filesSeen: snapshot.filesSeen,
      filesParsed: snapshot.filesParsed, malformedLines: snapshot.malformedLines,
      warnings: snapshot.warnings, priceModels: available.size,
    }, sessions,
  };
}
