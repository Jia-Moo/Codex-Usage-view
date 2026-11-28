/**
 * Read-only Codex session analyzer. Supports large files and append-only
 * resumption without retaining full prompts, tool output, or source code.
 */
import { opendir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { readJsonl } from "./jsonl-reader.mjs";
import { defaultIndexFile, fingerprint, loadIndex, saveIndex } from "./usage-index.mjs";

const METRICS = ["input", "cached", "output", "reasoning"];
const ZERO = () => ({ input: 0, cached: 0, output: 0, reasoning: 0 });
const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
const safeNum = n => Number.isFinite(Number(n)) && Number(n) >= 0 ? Math.floor(Number(n)) : 0;
const iso = s => { const d = new Date(s); return Number.isFinite(d.getTime()) ? d.toISOString() : null; };
const dayOf = s => {
  const d = s ? new Date(s) : null;
  if (!d || !Number.isFinite(d.getTime())) return null;
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
};
export function normalizeUsage(value) {
  if (!isObj(value)) return null;
  const input = safeNum(value.input_tokens ?? value.input ?? 0);
  const output = safeNum(value.output_tokens ?? value.output ?? 0);
  return {
    input, cached: Math.min(input, safeNum(value.cached_input_tokens ?? value.cached ?? 0)),
    output, reasoning: Math.min(output, safeNum(value.reasoning_output_tokens ?? value.reasoning ?? 0)),
  };
}
export function addUsage(a, b) { return Object.fromEntries(METRICS.map(k => [k, (a?.[k] || 0) + (b?.[k] || 0)])); }
export function totalTokens(u) { return (u?.input || 0) + (u?.output || 0); }
export function hitRate(u) { return u?.input ? u.cached / u.input : 0; }

function deltaFrom(previous, current) {
  if (!previous) return current;
  const reset = current.input < previous.input || current.output < previous.output || current.cached < previous.cached;
  if (reset) return current;
  return Object.fromEntries(METRICS.map(k => [k, Math.max(0, current[k] - previous[k])]));
}
function sessionIdFromFile(path) {
  return basename(path).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl(?:\.zst)?$/i)?.[1]
    || basename(path).replace(/\.jsonl(?:\.zst)?$/i, "");
}
function projectLabel(path) {
  if (!path) return "未知项目";
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
}
function cleanTitle(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 110) : "";
}
function responseUserTitle(payload) {
  if (!Array.isArray(payload.content)) return "";
  for (const item of payload.content) {
    if (isObj(item) && item.type === "input_text") {
      const title = cleanTitle(item.text);
      if (title) return title;
    }
  }
  return "";
}
function freshSession(filePath) {
  return {
    id: sessionIdFromFile(filePath), file: filePath, projectPath: "", project: "未知项目",
    title: "", started: null, lastSeen: null, turns: 0, source: "",
    buckets: [], hours: [], usage: ZERO(), warnings: 0,
    _checkpoint: {
      cursor: 0, previous: null, activeModel: "未知模型", firstTimestamp: null,
      lastTimestamp: null, eventUsers: 0, responseUsers: 0, titleFromUser: false,
    },
  };
}

/** Resume from a saved, derived checkpoint; do not use cumulative totals as per-file usage. */
export async function parseSession(filePath, { showTitles = false, maxLineBytes = 32 * 1024 * 1024, resume = null } = {}) {
  const session = resume ? structuredClone(resume) : freshSession(filePath);
  const checkpoint = session._checkpoint;
  if (!checkpoint || !Number.isSafeInteger(checkpoint.cursor) || checkpoint.cursor < 0) throw new Error("Invalid saved cursor");
  session.file = filePath;
  const buckets = new Map((session.buckets || []).map(b => [JSON.stringify([b.model, b.date]), b]));
  const hours = new Map((session.hours || []).map(b => [JSON.stringify([b.model, b.date, b.hour]), b]));
  const result = await readJsonl(filePath, {
    start: checkpoint.cursor, compressed: filePath.endsWith(".jsonl.zst"), maxLineBytes,
    onRecord(evt) {
      if (!isObj(evt)) return;
      const stamp = iso(evt.timestamp);
      if (stamp) {
        checkpoint.firstTimestamp ||= stamp;
        checkpoint.lastTimestamp = stamp;
      }
      const p = evt.payload;
      if (!isObj(p)) return;
      if (evt.type === "session_meta") {
        if (typeof p.id === "string" && p.id.length <= 128) session.id = p.id;
        if (typeof p.cwd === "string") session.projectPath = p.cwd;
        session.started = iso(p.timestamp) || session.started;
        session.source = typeof p.source === "string" ? p.source : session.source;
        return;
      }
      if (evt.type === "turn_context") {
        if (typeof p.model === "string" && p.model) checkpoint.activeModel = p.model;
        if (typeof p.cwd === "string" && p.cwd) session.projectPath = p.cwd;
        return;
      }
      if (evt.type === "response_item" && p.type === "message" && p.role === "user") {
        checkpoint.responseUsers++;
        if (showTitles && !checkpoint.titleFromUser) {
          const title = responseUserTitle(p);
          if (title) { session.title = title; checkpoint.titleFromUser = true; }
        }
        return;
      }
      if (evt.type !== "event_msg") return;
      if (p.type === "user_message") {
        checkpoint.eventUsers++;
        if (showTitles && !checkpoint.titleFromUser) {
          const title = cleanTitle(p.message);
          if (title) { session.title = title; checkpoint.titleFromUser = true; }
        }
      }
      if (p.type !== "token_count" || !isObj(p.info)) return;
      const current = normalizeUsage(p.info.total_token_usage);
      const last = normalizeUsage(p.info.last_token_usage);
      let delta = null;
      if (current) {
        const unchanged = checkpoint.previous && METRICS.every(k => checkpoint.previous[k] === current[k]);
        delta = unchanged ? ZERO() : (last || deltaFrom(checkpoint.previous, current));
        checkpoint.previous = current;
      } else if (last) {
        delta = last;
        checkpoint.previous = null;
      }
      if (!delta || totalTokens(delta) === 0) return;
      const model = [p.info.model, p.model, p.info.model_name, p.info.modelName, checkpoint.activeModel]
        .find(value => typeof value === "string" && value.length) || "未知模型";
      const date = dayOf(stamp || session.started);
      if (!date) { session.warnings++; return; }
      const key = JSON.stringify([model, date]);
      const bucket = buckets.get(key) || { model, date, usage: ZERO() };
      bucket.usage = addUsage(bucket.usage, delta);
      buckets.set(key, bucket);
      // Keep a small derived 24-hour index for accurate per-hour charts.
      // The original event body is never persisted to the usage index.
      const hour = new Date(stamp || session.started).getHours();
      const hourKey = JSON.stringify([model, date, hour]);
      const hourly = hours.get(hourKey) || { model, date, hour, usage: ZERO() };
      hourly.usage = addUsage(hourly.usage, delta);
      hours.set(hourKey, hourly);
    },
  });
  checkpoint.cursor = result.cursor;
  session.warnings += result.malformedLines + result.skippedLongLines;
  session.started ||= checkpoint.firstTimestamp || checkpoint.lastTimestamp;
  session.lastSeen = checkpoint.lastTimestamp || session.started;
  session.project = projectLabel(session.projectPath);
  session.turns = Math.max(checkpoint.eventUsers, checkpoint.responseUsers);
  session.title ||= "会话 " + session.id.slice(0, 8);
  session.buckets = [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
  session.hours = [...hours.values()].sort((a, b) =>
    a.date.localeCompare(b.date) || a.hour - b.hour || a.model.localeCompare(b.model));
  session.usage = session.buckets.reduce((sum, b) => addUsage(sum, b.usage), ZERO());
  session._lineWarnings = result.skippedLongLines;
  return session;
}

async function* sessionFiles(path, maxDepth = 5, onError = () => {}) {
  if (maxDepth < 0) return;
  let dir;
  try { dir = await opendir(path); }
  catch (error) {
    if (error.code !== "ENOENT") onError("无法打开目录：" + path + "（" + error.message + "）");
    return;
  }
  for await (const entry of dir) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) yield* sessionFiles(full, maxDepth - 1, onError);
    else if (entry.isFile() && (entry.name.endsWith(".jsonl") || entry.name.endsWith(".jsonl.zst"))) {
      yield full;
    }
    // Symlinks are never followed.
  }
}
function preferSession(current, candidate) {
  if (!current) return candidate;
  const oldTotal = totalTokens(current.usage);
  const newTotal = totalTokens(candidate.usage);
  // Multiple rollout/archived copies may share the same session ID.
  // Never prefer a newer but incomplete copy solely by its filesystem mtime.
  if (oldTotal !== newTotal) return newTotal > oldTotal ? candidate : current;
  if (!!current._historical !== !!candidate._historical)
    return candidate._historical ? current : candidate;
  const oldSeen = Date.parse(current.lastSeen || "") || 0;
  const newSeen = Date.parse(candidate.lastSeen || "") || 0;
  if (oldSeen !== newSeen) return newSeen > oldSeen ? candidate : current;
  return (candidate.mtime || 0) > (current.mtime || 0) ? candidate : current;
}

/**
 * Scans available Codex JSONL and compressed JSONL archives.
 *
 * A historical session is not silently deleted when a source file becomes
 * unavailable. Derived usage is retained locally, *flagged as historical*,
 * and exposed in the report for audit. Pass keepMissing=false to intentionally
 * drop unavailable-source summaries from the local index.
 */
export async function scanCodex(root, {
  showTitles = false, maxFiles = 60000, maxLineBytes = 32 * 1024 * 1024,
  indexFile = undefined, keepMissing = true,
} = {}) {
  root = resolve(root);
  if (indexFile === undefined) indexFile = defaultIndexFile(root);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let oldIndex = {};
  const warnings = [];
  try { if (indexFile) oldIndex = await loadIndex(indexFile, { root, showTitles, timeZone }); }
  catch (error) {
    warnings.push("无法读取本地统计索引，将重新扫描：" + String(error.message || error));
  }
  const nextIndex = {};
  const folders = [join(root, "sessions"), join(root, "archived_sessions")];
  const sessions = new Map();
  let filesSeen = 0, filesParsed = 0, malformedLines = 0;
  let cacheHits = 0, resumedFiles = 0, fullScans = 0, indexedBytes = 0, compressedFiles = 0;
  let reachedLimit = false;
  for (const folder of folders) {
    if (reachedLimit) break;
    for await (const file of sessionFiles(folder, 5, msg => warnings.push(msg))) {
      filesSeen++;
      if (filesSeen > maxFiles) {
        warnings.push("文件数量超过扫描上限，使用上次保留的历史摘要补全未扫描文件");
        reachedLimit = true;
        break;
      }
      let meta;
      try { meta = await stat(file); }
      catch (error) {
        warnings.push("无法获取日志信息：" + basename(file) + "（" + error.message + "）");
        continue;
      }
      const compressed = file.endsWith(".jsonl.zst");
      const previous = oldIndex[file];
      let entry, mode = "full";
      try {
        if (previous && previous.size === meta.size && previous.mtimeMs === meta.mtimeMs &&
          previous.session?._checkpoint && Number.isSafeInteger(previous.session._checkpoint.cursor)) {
          entry = structuredClone(previous.session);
          mode = "cache";
        } else if (!compressed && previous && previous.size < meta.size && previous.size >= 0 &&
          previous.session?._checkpoint &&
          previous.session._checkpoint.cursor <= previous.size &&
          previous.fingerprint === await fingerprint(file, previous.size)) {
          entry = await parseSession(file, { showTitles, maxLineBytes, resume: previous.session });
          mode = "resume";
          indexedBytes += meta.size - previous.session._checkpoint.cursor;
        } else {
          entry = await parseSession(file, { showTitles, maxLineBytes });
          indexedBytes += meta.size;
        }
        const now = await stat(file);
        // A file can still change during scanning. Do not persist a cursor for
        // an unstable file; the next scan will perform a complete reparse.
        if (now.size !== meta.size || now.mtimeMs !== meta.mtimeMs) {
          warnings.push("日志扫描过程中发生变化，下次将重新校验：" + basename(file));
          // Preserve the previous stable entry if one exists.
          if (previous?.session) {
            entry = structuredClone(previous.session);
            mode = "cache";
          }
          // Force a complete reparse on the next scan, even when an older
          // stable snapshot was used for this response.
          entry._unstable = true;
        }
        entry.file = file;
        entry.mtime = now.mtimeMs;
        delete entry._historical;
        const signature = mode === "cache" && previous && now.size === previous.size &&
          now.mtimeMs === previous.mtimeMs
          ? previous.fingerprint : await fingerprint(file, now.size);
        // Unstable new files are counted in this view, but must be reparsed
        // next time. The cache stores an invalid mtime to force that.
        let displayEntry = entry;
        const historicalCeiling = keepMissing
          ? (previous?.highWaterSession || previous?.session) : null;
        const oldVolume = historicalCeiling ? totalTokens(historicalCeiling.usage) : 0;
        if (historicalCeiling && totalTokens(entry.usage) < oldVolume) {
          displayEntry = structuredClone(historicalCeiling);
          displayEntry._historical = true;
          warnings.push("会话源日志相较上次用量减少，暂保留旧摘要：" + basename(file) +
            "。请检查是否发生日志截断、覆盖或解析差异。");
        }
        nextIndex[file] = {
          size: now.size, mtimeMs: entry._unstable ? -1 : now.mtimeMs,
          fingerprint: signature, session: entry,
          ...(displayEntry !== entry ? { highWaterSession: displayEntry } : {}),
        };
        filesParsed++;
        if (compressed) compressedFiles++;
        if (mode === "cache") cacheHits++;
        else if (mode === "resume") resumedFiles++;
        else fullScans++;
        malformedLines += entry.warnings;
        if (entry._lineWarnings) warnings.push(
          "跳过 " + entry._lineWarnings + " 行超过 " + Math.round(maxLineBytes / (1024 * 1024)) +
          " MiB 的超长记录：" + basename(file));
        sessions.set(displayEntry.id, preferSession(sessions.get(displayEntry.id), displayEntry));
      } catch (error) {
        warnings.push("无法读取 " + basename(file) + "：" + String(error.message || error));
      }
    }
  }

  let missingFiles = 0, missingSessions = 0;
  if (keepMissing) {
    for (const [file, cached] of Object.entries(oldIndex)) {
      if (nextIndex[file] || !cached?.session) continue;
      missingFiles++;
      const historical = structuredClone(cached.highWaterSession || cached.session);
      historical._historical = true;
      historical.file = file;
      // This can be a moved/archived duplicate. Reuse the more complete
      // session but do not double-count both copies.
      const live = sessions.get(historical.id);
      if (live && !live._historical &&
        totalTokens(live.usage) >= totalTokens(historical.usage)) {
        continue;
      }
      nextIndex[file] = { ...cached, session: historical, missing: true };
      const winner = preferSession(live, historical);
      sessions.set(historical.id, winner);
      if (winner === historical && (!live || !live._historical)) missingSessions++;
    }
  }
  if (missingSessions) warnings.push(
    "有 " + missingSessions + " 个历史会话的原始日志当前不可访问，使用本机旧统计摘要保留用量。"
    + "如果这是主动删除的日志，可使用 --drop-missing 清除其缓存统计。");
  if (indexFile && !reachedLimit) {
    try { await saveIndex(indexFile, { root, showTitles, timeZone, entries: nextIndex }); }
    catch (error) { warnings.push("无法保存本地统计索引：" + String(error.message || error)); }
  }
  const sorted = [...sessions.values()].sort((a, b) => (b.lastSeen || "").localeCompare(a.lastSeen || ""));
  const previousBySession = new Map();
  for (const cached of Object.values(oldIndex)) {
    const session = cached?.highWaterSession || cached?.session;
    if (session?.id) previousBySession.set(session.id,
      preferSession(previousBySession.get(session.id), session));
  }
  const previousTotalTokens = [...previousBySession.values()].reduce(
    (sum, session) => sum + totalTokens(session.usage), 0);
  const currentTotalTokens = sorted.reduce(
    (sum, session) => sum + totalTokens(session.usage), 0);
  if (previousTotalTokens && currentTotalTokens < previousTotalTokens) {
    warnings.push("完整时间范围总 Token 比上次本机索引减少 " +
      (previousTotalTokens - currentTotalTokens).toLocaleString("zh-CN") +
      "，请检查是否主动清理历史缓存、切换数据目录或出现解析错误。");
  }
  if (!filesSeen && !sorted.length) warnings.push(
    "未找到可统计的 Codex 会话日志。请检查 CODEX_HOME、sessions/ 和 archived_sessions/ 路径。");
  return {
    root, scannedAt: new Date().toISOString(), filesSeen, filesParsed,
    previousTotalTokens, currentTotalTokens,
    malformedLines, warnings: warnings.slice(0, 40),
    cacheHits, resumedFiles, fullScans, indexedBytes, compressedFiles,
    missingFiles, historicalSessions: sorted.filter(s => s._historical).length,
    sessions: sorted,
  };
}

export function priceForModel(model, prices) {
  if (!isObj(prices)) return null;
  const key = String(model || "").trim().toLowerCase();
  const clean = key.replace(/^openai[/.]/, "");
  const candidates = [key, clean, "openai/" + clean];
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
    historical: !!entry._historical,
    buckets: entry.buckets.map(bucket => ({
      ...bucket, pricing: calculateCost(bucket.usage, bucket.model, prices),
    })),
    hours: (entry.hours || []).map(bucket => ({
      ...bucket, pricing: calculateCost(bucket.usage, bucket.model, prices),
    })),
  }));
  return {
    meta: {
      scannedAt: snapshot.scannedAt, root: snapshot.root, filesSeen: snapshot.filesSeen,
      filesParsed: snapshot.filesParsed, malformedLines: snapshot.malformedLines,
      warnings: snapshot.warnings, priceModels: available.size,
      cacheHits: snapshot.cacheHits ?? 0, resumedFiles: snapshot.resumedFiles ?? 0,
      fullScans: snapshot.fullScans ?? 0, indexedBytes: snapshot.indexedBytes ?? 0,
      compressedFiles: snapshot.compressedFiles ?? 0,
      historicalSessions: snapshot.historicalSessions ?? 0,
      missingFiles: snapshot.missingFiles ?? 0,
      previousTotalTokens: snapshot.previousTotalTokens ?? null,
      currentTotalTokens: snapshot.currentTotalTokens ?? null,
    }, sessions,
  };
}
