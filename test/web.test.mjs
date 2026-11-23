import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createContext, runInContext } from "node:vm";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function element(initialValue = "") {
  const callbacks = new Map();
  const classes = new Set();
  const el = {
    value: initialValue, dataset: {}, className: "", textContent: "", innerHTML: "",
    disabled: false, callbacks, attributes: {}, style: {},
    classList: {
      toggle(name, force) { if (force ?? !classes.has(name)) classes.add(name); else classes.delete(name); },
      add(name) { classes.add(name); }, remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(type, cb) { callbacks.set(type, cb); },
    get options() {
      return [...this.innerHTML.matchAll(/<option value="([^"]*)"/g)]
        .map(match => ({ value: match[1] }));
    },
  };
  return el;
}

test("project row opens individual model breakdown and back returns to project list", async () => {
  const ids = ["refresh", "export", "notice", "metrics", "content", "subtitle",
    "refresh-stamp", "project", "model", "days", "search", "page-title", "details"];
  const els = Object.fromEntries(ids.map(id => [id, element()]));
  els.project.value = "all"; els.model.value = "all"; els.days.value = "all";
  els.details.open = false;
  const nav = ["overview", "projects", "models", "sessions", "pricing"].map(page => {
    const el = element();
    el.dataset.page = page;
    return el;
  });
  const report = {
    meta: { scannedAt: "2026-11-22T12:00:00Z", warnings: [], malformedLines: 0 },
    sessions: [
      {
        id: "session-a", title: "A session", project: "Robot", projectPath: "C:\\workspace\\Robot",
        started: "2026-11-22T10:00:00Z", lastSeen: "2026-11-22T11:00:00Z", turns: 1,
        buckets: [
          { model: "gpt-6.2-sol", date: "2026-11-22",
            usage: { input: 100000, cached: 80000, output: 10000, reasoning: 2000 },
            pricing: { known: true, usd: 0.14, savedUSD: 0.152 } },
          { model: "gpt-6-luna", date: "2026-11-22",
            usage: { input: 10000, cached: 5000, output: 1000, reasoning: 0 },
            pricing: { known: true, usd: 0.00105, savedUSD: 0.00045 } },
        ],
      },
      {
        id: "session-b", title: "B session", project: "Another", projectPath: "C:\\workspace\\Another",
        started: "2026-11-22T10:00:00Z", lastSeen: "2026-11-22T10:00:00Z", turns: 1,
        buckets: [{ model: "gpt-unrelated", date: "2026-11-22",
          usage: { input: 100000, cached: 0, output: 20000, reasoning: 0 },
          pricing: { known: false, usd: null, savedUSD: null } }],
      },
    ],
  };
  const source = await readFile(join(root, "src", "web", "app.js"), "utf8");
  const context = createContext({
    document: {
      hidden: true,
      querySelector: () => ({ content: "test-token" }),
      querySelectorAll: () => nav,
      addEventListener() {},
      getElementById: id => {
        if (!els[id]) els[id] = element();
        return els[id];
      },
    },
    window: { scrollTo() {} },
    fetch: async url => ({ ok: true, json: async () => url.includes("api/prices") ? {
      source: "OpenAI 官方内置价格", models: {}, officialCheckedAt: "2026-11-22",
    } : report }),
    setInterval: () => 1,
    console,
  });
  runInContext(source, context, { filename: "app.js" });
  // The app invokes its initial asynchronous load itself.
  await new Promise(resolve => setImmediate(resolve));
  assert.match(els.metrics.innerHTML, /≥/);
  assert.match(els.metrics.innerHTML, /0\.1411/);
  runInContext('state.page = "projects"; render();', context);
  assert.match(els.content.innerHTML, /data-project-open/);
  assert.match(els.content.innerHTML, /Robot/);
  assert.match(els.content.innerHTML, /Another/);
  const onClick = els.content.callbacks.get("click");
  assert.equal(typeof onClick, "function");
  onClick({ target: {
    closest(selector) {
      return selector === "[data-project-open]" ? { dataset: { projectOpen: "C:\\workspace\\Robot" } } : null;
    }
  } });
  assert.match(els.content.innerHTML, /模型消耗明细/);
  assert.match(els.content.innerHTML, /gpt-6\.2-sol/);
  assert.match(els.content.innerHTML, /gpt-6-luna/);
  assert.doesNotMatch(els.content.innerHTML, /gpt-unrelated/);
  assert.match(els.content.innerHTML, /Token 占比/);
  assert.match(els.content.innerHTML, /日期明细/);
  assert.match(els.content.innerHTML, /单独会话/);
  onClick({ target: {
    closest(selector) {
      return selector === "[data-project-back]" ? { dataset: { projectBack: "1" } } : null;
    }
  } });
  assert.match(els.content.innerHTML, /data-project-open/);
  assert.match(els.content.innerHTML, /Another/);
  assert.equal(runInContext('priceText({usd:0,priced:0,missing:2})', context), "未定价");
  assert.equal(runInContext('priceText({usd:0.2,priced:1,missing:2})', context), "≥ $0.2000");

  // "Today" always resolves in the viewer's current local timezone.
  els.days.callbacks.get("change")({ target: { value: "today" } });
  const today = runInContext('localDate(new Date())', context);
  assert.equal(runInContext("dateBounds().start", context), today);
  assert.equal(runInContext("dateBounds().end", context), today);
  assert.equal(runInContext("filtered().every(row => row.date === dateBounds().start)", context), true);

  // First switch to custom pre-fills a useful valid 30-day period.
  els.days.callbacks.get("change")({ target: { value: "custom" } });
  assert.equal(runInContext('state.customEnd', context), today);
  assert.ok(runInContext('validLocalDate(state.customStart)', context));
  assert.equal(runInContext('dateBounds().invalid', context), undefined);

  // Both endpoints are inclusive and the filter applies to every view.
  els["date-start"].callbacks.get("change")({ target: { value: "2026-11-22" } });
  els["date-end"].callbacks.get("change")({ target: { value: "2026-11-22" } });
  assert.equal(runInContext("filtered().length", context), 3);
  assert.equal(els.export.disabled, false);
  assert.equal(runInContext("dateBounds().start", context), "2026-11-22");
  assert.equal(runInContext("dateBounds().end", context), "2026-11-22");

  // Invalid and reversed dates must never silently expand to all-time usage.
  els["date-start"].callbacks.get("change")({ target: { value: "2026-11-23" } });
  assert.equal(runInContext("filtered().length", context), 0);
  assert.equal(els.export.disabled, true);
  assert.match(els["range-hint"].textContent, /不能晚于/);
  els["date-start"].callbacks.get("change")({ target: { value: "" } });
  assert.equal(runInContext("filtered().length", context), 0);
  assert.equal(els.export.disabled, true);
  assert.match(els["range-hint"].textContent, /有效的开始日期/);
  assert.equal(runInContext('validLocalDate("2024-02-29")', context), true);
  assert.equal(runInContext('validLocalDate("2025-02-29")', context), false);

  // Cross-year custom date boundaries and date scoping are both respected.
  report.sessions[0].buckets.push({
    model: "gpt-6.2-sol", date: "2025-12-31",
    usage: { input: 500, cached: 250, output: 25, reasoning: 3 },
    pricing: { known: true, usd: 0.002, savedUSD: 0.001 },
  });
  els["date-start"].callbacks.get("change")({ target: { value: "2025-12-31" } });
  els["date-end"].callbacks.get("change")({ target: { value: "2026-01-01" } });
  assert.equal(runInContext("filtered().length", context), 1);
  assert.equal(runInContext("filtered()[0].date", context), "2025-12-31");
  assert.equal(els.export.disabled, false);
  els.days.callbacks.get("change")({ target: { value: "all" } });
  assert.equal(runInContext("filtered().length", context), 4);
});
