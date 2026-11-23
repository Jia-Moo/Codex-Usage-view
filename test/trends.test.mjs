import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createContext, runInContext } from "node:vm";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const localDate = date => {
  const d = new Date(date);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
};
function element(value = "") {
  const callbacks = new Map();
  return {
    value, callbacks, innerHTML: "", textContent: "", disabled: false, open: false, dataset: {},
    classList: { toggle() {}, add() {}, remove() {} },
    addEventListener(type, callback) { callbacks.set(type, callback); },
    get options() {
      return [...this.innerHTML.matchAll(/<option value="([^"]*)"/g)].map(x => ({ value: x[1] }));
    },
  };
}
function record(model, date, hour, input, cached, output, cost, known = true) {
  return {
    model, date, hour,
    usage: { input, cached, output, reasoning: 0 },
    pricing: { known, usd: known ? cost : null, savedUSD: known ? 0 : null },
  };
}
async function boot() {
  const today = localDate(new Date());
  const date = new Date();
  date.setDate(date.getDate() - 1);
  const yesterday = localDate(date);
  const hours = [
    record("model-a", today, 0, 100, 70, 10, 0.2),
    record("model-a", today, 12, 200, 130, 20, 0.6),
    record("model-b", today, 12, 90, 50, 10, 0.5),
    record("model-c", today, 23, 20, 0, 0, 0, false),
    record("model-a", yesterday, 8, 80, 60, 10, 0.05),
  ];
  const bucketsMap = new Map();
  for (const h of hours) {
    const key = JSON.stringify([h.model, h.date]);
    const old = bucketsMap.get(key) || record(h.model, h.date, 0, 0, 0, 0, 0, h.pricing.known);
    old.usage.input += h.usage.input;
    old.usage.cached += h.usage.cached;
    old.usage.output += h.usage.output;
    if (h.pricing.known) old.pricing.usd += h.pricing.usd;
    bucketsMap.set(key, old);
  }
  const report = {
    meta: { scannedAt: new Date().toISOString(), warnings: [], malformedLines: 0 },
    sessions: [{
      id: "test-session", title: "Synthetic chart session", project: "charts", projectPath: "/work/charts",
      started: new Date().toISOString(), lastSeen: new Date().toISOString(), turns: 2,
      hours, buckets: [...bucketsMap.values()],
    }],
  };
  const ids = ["refresh", "export", "notice", "metrics", "content", "subtitle", "refresh-stamp",
    "project", "model", "days", "search", "page-title", "details", "custom-range", "date-start", "date-end", "range-hint"];
  const els = Object.fromEntries(ids.map(id => [id, element()]));
  els.project.value = "all"; els.model.value = "all"; els.days.value = "30";
  const nav = ["overview", "projects", "models", "sessions", "pricing"].map(page => {
    const el = element();
    el.dataset.page = page;
    return el;
  });
  const context = createContext({
    document: {
      hidden: true,
      querySelector: () => ({ content: "test-token" }),
      querySelectorAll: () => nav,
      getElementById: id => els[id] || (els[id] = element()),
    },
    window: { scrollTo() {} },
    fetch: async url => ({
      ok: true, json: async () => url.includes("api/prices")
        ? { models: {}, source: "test" } : report,
    }),
    setInterval: () => 1, console,
  });
  const source = await readFile(join(root, "src", "web", "app.js"), "utf8");
  runInContext(source, context, { filename: "app.js" });
  await new Promise(resolve => setImmediate(resolve));
  return { els, context, today, yesterday };
}

test("single-day today has exactly 24 hourly bins with correctly stacked per-model token and cost bars", async () => {
  const { els, context, today } = await boot();
  els.days.callbacks.get("change")({ target: { value: "today" } });
  assert.equal(runInContext("timeline(filtered()).singleDay", context), true);
  assert.equal(runInContext("timeline(filtered()).granularity", context), "hour");
  assert.equal(runInContext("timeline(filtered()).buckets.length", context), 24);
  assert.equal(runInContext("timeline(filtered()).buckets[0].tokens", context), 110);
  assert.equal(runInContext("timeline(filtered()).buckets[12].tokens", context), 320);
  assert.ok(Math.abs(runInContext("timeline(filtered()).buckets[12].usd", context) - 1.1) < 1e-10);
  assert.equal(runInContext("timeline(filtered()).buckets[12].models.size", context), 2);
  assert.equal(runInContext("timeline(filtered()).buckets[23].unpriced", context), 1);
  assert.equal(runInContext("timeline(filtered()).buckets[7].tokens", context), 0);
  const tokenHTML = runInContext('stackedTrend(timeline(filtered()),"tokens")', context);
  const costHTML = runInContext('stackedTrend(timeline(filtered()),"usd")', context);
  assert.match(tokenHTML, /00:00/);
  assert.match(tokenHTML, /model-a/);
  assert.match(tokenHTML, /model-b/);
  assert.match(tokenHTML, /model-c/);
  assert.match(costHTML, /model-a/);
  assert.match(costHTML, /model-b/);
  assert.doesNotMatch(costHTML, /data-model="model-c"/);
  assert.match(costHTML, /部分模型未定价/);
  assert.match(els.content.innerHTML, /逐小时明细/);
  assert.match(els.content.innerHTML, /API 等效费用趋势/);
  assert.match(els.content.innerHTML, /模型颜色说明/);
  assert.equal(runInContext('colorForModel("model-a")', context), runInContext('colorForModel("model-a")', context));
  assert.equal(runInContext("dateBounds().start", context), today);
});

test("custom one-day filters render hourly but multi-day periods aggregate daily/weekly/monthly", async () => {
  const { els, context, today, yesterday } = await boot();
  els.days.callbacks.get("change")({ target: { value: "custom" } });
  els["date-start"].callbacks.get("change")({ target: { value: today } });
  els["date-end"].callbacks.get("change")({ target: { value: today } });
  assert.equal(runInContext("timeline(filtered()).granularity", context), "hour");
  assert.equal(runInContext("timeline(filtered()).buckets.length", context), 24);
  els["date-start"].callbacks.get("change")({ target: { value: yesterday } });
  assert.equal(runInContext("timeline(filtered()).granularity", context), "day");
  assert.equal(runInContext("timeline(filtered()).buckets.length", context), 2);
  assert.equal(runInContext("timeline(filtered()).buckets.reduce((sum, b)=>sum+b.tokens,0)", context),
    runInContext("filtered().reduce((sum, r)=>sum+count(r.usage),0)", context));
  els.days.callbacks.get("change")({ target: { value: "90" } });
  assert.equal(runInContext("timeline(filtered()).granularity", context), "week");
  els.days.callbacks.get("change")({ target: { value: "365" } });
  assert.equal(runInContext("timeline(filtered()).granularity", context), "month");
});

test("unpriced-only model costs explain missing prices instead of displaying fake zero bars", async () => {
  const { els, context } = await boot();
  els.days.callbacks.get("change")({ target: { value: "today" } });
  els.model.callbacks.get("change")({ target: { value: "model-c" } });
  const result = runInContext('stackedTrend(timeline(filtered()),"usd")', context);
  assert.match(result, /无法计算等效费用/);
  assert.match(result, /缺少价格/);
  const tokenHTML = runInContext('stackedTrend(timeline(filtered()),"tokens")', context);
  assert.match(tokenHTML, /data-model="model-c"/);
  assert.doesNotMatch(tokenHTML, /data-model="model-a"/);
});
