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
  const classes = new Set();
  return {
    value, callbacks, innerHTML: "", textContent: "", disabled: false, open: false, dataset: {},
    attributes: {}, style: {}, offsetWidth: 330, offsetHeight: 320,
    classList: {
      toggle(name, force) { if (force ?? !classes.has(name)) classes.add(name); else classes.delete(name); },
      add(name) { classes.add(name); }, remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
    setAttribute(name, value) { this.attributes[name] = value; },
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
      addEventListener() {},
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


test("empty single-day selection keeps the 24-hour chart and detail table visible", async () => {
  const { els, context } = await boot();
  els.days.callbacks.get("change")({ target: { value: "today" } });
  els.search.callbacks.get("input")({ target: { value: "no-such-conversation" } });
  assert.equal(runInContext("filtered().length", context), 0);
  assert.equal(runInContext("timeline(filtered()).buckets.length", context), 24);
  assert.match(els.content.innerHTML, /逐小时明细/);
  assert.match(els.content.innerHTML, /API 等效费用趋势/);
  assert.doesNotMatch(els.content.innerHTML, /当前筛选范围没有日志用量/);
});


test("dashboard places two charts in one layout, each with an upper-right model legend", async () => {
  const { els, context } = await boot();
  els.days.callbacks.get("change")({ target: { value: "today" } });
  const html = els.content.innerHTML;
  const trendStart = html.indexOf('class="trend-dual"');
  const firstTitle = html.indexOf("Token 使用趋势", trendStart);
  const firstLegend = html.indexOf('class="trend-legend"', firstTitle);
  const costTitle = html.indexOf("API 等效费用趋势", firstLegend);
  const secondLegend = html.indexOf('class="trend-legend"', costTitle);
  assert.ok(trendStart >= 0, "charts should be in a shared trend-dual layout");
  assert.ok(firstTitle > trendStart && firstLegend > firstTitle);
  assert.ok(costTitle > firstLegend && secondLegend > costTitle);
  assert.equal((html.match(/class="trend-panel-header"/g) || []).length, 2);
  assert.equal((html.match(/class="trend-legend"/g) || []).length, 2);
  assert.equal((html.match(/class="trend-chart"/g) || []).length, 2);
  assert.ok(!html.includes("<h2>模型颜色说明</h2>"), "no standalone oversized legend section");
  assert.match(html, /Token 占比/);
  assert.match(html, /费用占比/);
  assert.match(html, /model-a/);
  assert.match(html, /model-b/);
  assert.match(html, /model-c/);
  const left = html.slice(firstLegend, costTitle);
  const right = html.slice(secondLegend, html.indexOf("逐小时明细"));
  const swatchA = runInContext('colorForModel("model-a")', context);
  assert.ok(left.includes(swatchA) && right.includes(swatchA),
    "same model must share identical colors on both cards");
  assert.match(right, /未定价/, "unpriced model must be labeled in the cost legend");
});

test("model legends remain readable with many models and do not expand the chart header indefinitely", async () => {
  const { context } = await boot();
  const data = Array.from({ length: 10 }, (_, i) => ({
    model: "model-" + i,
    date: localDate(new Date()),
    session: { id: "many-" + i },
    usage: { input: 1000 + i, cached: 300, output: 50, reasoning: 0 },
    pricing: { known: true, usd: 0.001 * (i + 1), savedUSD: 0 },
  }));
  context.values = data;
  const markup = runInContext("modelLegend(null, values, 'tokens')", context);
  assert.equal((markup.match(/class="trend-legend-item"/g) || []).length, 10);
  assert.match(markup, /class="trend-legend-more"/);
  assert.match(markup, /还有 4 个模型/);
});


test("hover tooltip shows detailed token accounting, cache efficiency, pricing and share", async () => {
  const { els, context, today } = await boot();
  els.days.callbacks.get("change")({ target: { value: "today" } });
  const markup = runInContext('trendTooltipHTML(state.trendData,"tokens","12","model-a")', context);
  assert.match(markup, new RegExp(today));
  assert.match(markup, /model-a/);
  for (const label of ["当前模型", "时段占比", "输入 Token", "缓存输入", "非缓存输入",
      "输出 Token", "其中推理输出", "缓存命中率", "API 等效费用", "缓存节省估算"]) {
    assert.ok(markup.includes(label), "missing metric " + label);
  }
  assert.match(markup, /220 Token/);
  assert.match(markup, /65\.0%/);
  assert.match(markup, /\$0\.6000/);
  assert.match(markup, /68\.8%/);
  const missing = runInContext('trendTooltipHTML(state.trendData,"tokens","23","model-c")', context);
  assert.match(missing, /未定价/);
  assert.match(missing, /未定价用量/);
  const html = els.content.innerHTML;
  assert.match(html, /data-period="12"/);
  assert.match(html, /data-metric="tokens"/);
  assert.match(html, /aria-describedby="trend-tooltip"/);
  assert.match(html, /tabindex="0"/);
});

test("pointer hover follows cursor and updates between hours of the same model", async () => {
  const { els, context } = await boot();
  els.days.callbacks.get("change")({ target: { value: "today" } });
  context.window.innerWidth = 400;
  context.window.innerHeight = 380;
  const fakeSegment = period => ({
    dataset: { model: "model-a", metric: "tokens", period },
    classList: { contains(name) { return name === "trend-segment"; } },
    closest(query) { return query.includes(".trend-segment") ? this : null; },
    getBoundingClientRect() { return { left: 300, top: 300, width: 16, height: 20 }; },
  });
  const element12 = fakeSegment("12");
  const tooltip = els["trend-tooltip"] || (els["trend-tooltip"] = element());
  els.content.callbacks.get("pointerover")({
    target: element12, clientX: 378, clientY: 355,
  });
  assert.equal(tooltip.classList.contains("is-visible"), true);
  assert.equal(tooltip.attributes["aria-hidden"], "false");
  assert.match(tooltip.innerHTML, /12:00–12:59/);
  assert.match(tooltip.innerHTML, /220 Token/);
  assert.ok(parseInt(tooltip.style.left, 10) >= 12);
  assert.ok(parseInt(tooltip.style.left, 10) <= 400 - tooltip.offsetWidth);
  assert.ok(parseInt(tooltip.style.top, 10) >= 12);
  assert.ok(parseInt(tooltip.style.top, 10) <= 380 - tooltip.offsetHeight);

  const element00 = fakeSegment("00");
  els.content.callbacks.get("pointermove")({
    target: element00, clientX: 200, clientY: 120,
  });
  assert.match(tooltip.innerHTML, /00:00–00:59/);
  assert.match(tooltip.innerHTML, /110 Token/);
  els.content.callbacks.get("pointerout")({ target: element00, relatedTarget: null });
  assert.equal(tooltip.classList.contains("is-visible"), false);
  assert.equal(tooltip.attributes["aria-hidden"], "true");

  // Touch/click can pin a tooltip, and a second click dismisses it.
  els.content.callbacks.get("click")({ target: element12, clientX: 130, clientY: 120 });
  assert.equal(tooltip.classList.contains("is-visible"), true);
  els.content.callbacks.get("pointerout")({ target: element12, relatedTarget: null });
  assert.equal(tooltip.classList.contains("is-visible"), true);
  els.content.callbacks.get("click")({ target: element12, clientX: 130, clientY: 120 });
  assert.equal(tooltip.classList.contains("is-visible"), false);
});

test("the same model is highlighted from its legend, and rich tooltip escapes model text", async () => {
  const { els, context } = await boot();
  els.days.callbacks.get("change")({ target: { value: "today" } });
  const legend = {
    dataset: { model: "model-b" },
    classList: { contains(name) { return name === "trend-legend-item"; } },
    closest(query) { return query.includes(".trend-legend-item") ? this : null; },
  };
  els.content.callbacks.get("pointerover")({ target: legend });
  assert.equal(runInContext('state.trendActiveModel', context), "model-b");
  els.content.callbacks.get("pointerout")({ target: legend, relatedTarget: null });
  assert.equal(runInContext('state.trendActiveModel', context), null);
  const unknown = { model: '<img src=x onerror="alert(1)">', tokens: 12,
    usage: { input: 10, cached: 4, output: 2, reasoning: 1 },
    usd: 0, savedUSD: 0, known: 0, missing: 1 };
  context.sampleBucket = { key: "12", models: new Map([[unknown.model, unknown]]), tokens: 12, usd: 0 };
  const tooltip = runInContext('trendTooltipHTML({granularity:"hour",start:"2026-11-23",buckets:[sampleBucket]},"tokens","12",sampleBucket.models.keys().next().value)', context);
  assert.match(tooltip, /&lt;img/);
  assert.doesNotMatch(tooltip, /<img src=x/);
});
