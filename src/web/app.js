const token = document.querySelector('meta[name="local-token"]').content;
const $ = id => document.getElementById(id);
const state = { report: null, prices: null, page: "overview", days: "30", project: "all", model: "all", search: "", selected: null, loading: false };
const heading = { overview: "使用情况总览", projects: "项目分析", models: "模型分析", sessions: "会话明细", pricing: "API 等效价格" };
const fields = ["input", "cached", "output", "reasoning"];

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function emptyUsage() { return { input: 0, cached: 0, output: 0, reasoning: 0 }; }
function addUsage(a, b) { fields.forEach(k => { a[k] += b?.[k] || 0; }); return a; }
function count(u) { return u.input + u.output; }
function fmt(n) { return Intl.NumberFormat("zh-CN").format(Math.round(n || 0)); }
function short(n) {
  n = Number(n || 0);
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return fmt(n);
}
function money(n) { return "$" + Number(n || 0).toFixed(Number(n || 0) < 0.1 ? 5 : 3); }
function percent(n) { return (100 * Number(n || 0)).toFixed(1) + "%"; }
function localDate(date) {
  const d = new Date(date), pad = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}
function beginning() {
  if (state.days === "all") return "";
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - Number(state.days) + 1);
  return localDate(d);
}
function notify(message, error = false) {
  const el = $("notice");
  if (!message) { el.classList.add("hidden"); return; }
  el.textContent = message;
  el.className = "notice" + (error ? " error" : "");
}
async function request(url, init = {}) {
  const headers = { "X-Local-Token": token, ...(init.body ? { "Content-Type": "application/json" } : {}) };
  const res = await fetch(url, { ...init, headers, cache: "no-store" });
  const json = await res.json();
  if (!res.ok) throw Error(json.error || res.statusText);
  return json;
}
async function loadReport(force = false) {
  if (state.loading) return;
  state.loading = true;
  $("refresh").disabled = true;
  $("refresh").textContent = "正在扫描…";
  try {
    const [report, prices] = await Promise.all([request("/api/report" + (force ? "?refresh=1" : "")), request("/api/prices")]);
    state.report = report; state.prices = prices;
    $("refresh-stamp").textContent = "更新于 " + new Date(report.meta.scannedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    fillFilters();
    render();
    const countIssues = report.meta.warnings?.length || 0;
    if (countIssues) notify("扫描提醒：" + report.meta.warnings.join("；"));
    else if (report.meta.malformedLines) notify("已忽略 " + fmt(report.meta.malformedLines) + " 行格式无效的日志。其他数据仍可查看。");
    else notify("");
  } catch (e) { notify("读取失败：" + e.message, true); }
  finally { state.loading = false; $("refresh").disabled = false; $("refresh").textContent = "↻ 刷新日志"; }
}
function fillFilters() {
  const sessions = state.report?.sessions || [];
  const projects = [...new Map(sessions.filter(s => s.projectPath).map(s => [s.projectPath, s.project])).entries()].sort((a, b) => a[1].localeCompare(b[1], "zh-CN"));
  const models = [...new Set(sessions.flatMap(s => s.buckets.map(b => b.model)))].sort();
  const project = $("project"), model = $("model");
  project.innerHTML = '<option value="all">所有项目</option>' + projects.map(([key, name]) => '<option value="' + escapeHTML(key) + '">' + escapeHTML(name) + "</option>").join("");
  model.innerHTML = '<option value="all">所有模型</option>' + models.map(m => '<option value="' + escapeHTML(m) + '">' + escapeHTML(m) + "</option>").join("");
  if ([...project.options].some(o => o.value === state.project)) project.value = state.project;
  else state.project = project.value = "all";
  if ([...model.options].some(o => o.value === state.model)) model.value = state.model;
  else state.model = model.value = "all";
}

function filtered() {
  const rows = [], start = beginning(), search = state.search.toLowerCase();
  for (const session of state.report?.sessions || []) {
    if (state.project !== "all" && session.projectPath !== state.project) continue;
    if (search && ![session.title, session.project, session.projectPath, session.id, ...session.buckets.map(b => b.model)].some(s => String(s || "").toLowerCase().includes(search))) continue;
    for (const bucket of session.buckets) {
      if (start && bucket.date < start) continue;
      if (state.model !== "all" && state.model !== bucket.model) continue;
      rows.push({ ...bucket, session });
    }
  }
  return rows;
}
function aggregate(rows) {
  const usage = emptyUsage();
  let usd = 0, savedUSD = 0, missing = 0, priced = 0;
  rows.forEach(row => {
    addUsage(usage, row.usage);
    if (row.pricing?.known) { usd += row.pricing.usd; savedUSD += row.pricing.savedUSD; priced++; }
    else if (count(row.usage)) missing++;
  });
  return { usage, usd, savedUSD, missing, priced, sessions: new Set(rows.map(r => r.session.id)).size };
}
function metric(label, value, hint, tone) {
  return '<div class="metric"><div class="label">' + escapeHTML(label) + '</div><div class="value ' + (tone || "") + '">' + escapeHTML(value) + '</div><div class="hint">' + escapeHTML(hint) + "</div></div>";
}
function priceText(agg) {
  return money(agg.usd) + (agg.missing ? " *" : "");
}
function renderMetrics(rows) {
  const a = aggregate(rows);
  const uncached = Math.max(0, a.usage.input - a.usage.cached);
  $("metrics").innerHTML = [
    metric("总 Token 消耗", short(count(a.usage)), fmt(a.usage.input) + " 输入 · " + fmt(a.usage.output) + " 输出", "accent"),
    metric("输入缓存命中率", percent(a.usage.input ? a.usage.cached / a.usage.input : 0), fmt(a.usage.cached) + " 缓存 · " + fmt(uncached) + " 非缓存", "aqua"),
    metric("API 等效成本", priceText(a), a.missing ? a.missing + " 组模型用量未计价" : "覆盖全部已检测到的模型", "green"),
    metric("缓存节省成本", money(a.savedUSD), fmt(a.sessions) + " 个会话 · 推理输出 " + fmt(a.usage.reasoning), "amber"),
  ].join("");
}
function table(headers, body) {
  return '<div class="table-wrap"><table class="table"><thead><tr>' + headers.map(h => "<th" + (h.right ? ' class="num"' : "") + ">" + escapeHTML(h.text || h) + "</th>").join("") + "</tr></thead><tbody>" + body + "</tbody></table></div>";
}
function section(title, caption, html) {
  return '<section class="panel"><h2>' + escapeHTML(title) + '</h2><p class="caption">' + escapeHTML(caption || "") + "</p>" + html + "</section>";
}
function grouped(rows, group) {
  const map = new Map();
  for (const row of rows) {
    const key = group(row), value = map.get(key) || { key, rows: [] };
    value.rows.push(row);
    map.set(key, value);
  }
  return [...map.values()].map(v => ({ ...v, ...aggregate(v.rows) })).sort((a, b) => count(b.usage) - count(a.usage));
}
function numTd(value) { return '<td class="num">' + escapeHTML(value) + "</td>"; }
function defaultColumns() {
  return [{ text: "名称" }, { text: "输入", right: true }, { text: "缓存输入", right: true }, { text: "非缓存输入", right: true }, { text: "输出", right: true }, { text: "缓存命中率", right: true }, { text: "等效成本", right: true }];
}
function metricCells(g) {
  return numTd(short(g.usage.input)) + numTd(short(g.usage.cached)) +
    numTd(short(g.usage.input - g.usage.cached)) + numTd(short(g.usage.output)) +
    numTd(percent(g.usage.input ? g.usage.cached / g.usage.input : 0)) + numTd(g.missing ? '<缺失价格>' : money(g.usd));
}
function metricCellsRich(g) {
  return numTd(short(g.usage.input)) + numTd(short(g.usage.cached)) +
    numTd(short(g.usage.input - g.usage.cached)) + numTd(short(g.usage.output)) +
    numTd(percent(g.usage.input ? g.usage.cached / g.usage.input : 0)) +
    '<td class="num ' + (g.missing ? "price-unknown" : "") + '">' + escapeHTML(priceText(g)) + "</td>";
}
function barChart(rows) {
  const days = grouped(rows, r => r.date).sort((a, b) => a.key.localeCompare(b.key));
  const recent = days.slice(-Math.min(Number(state.days) || 24, 24));
  if (!recent.length) return '<div class="empty">这段时间没有 Token 记录</div>';
  const max = Math.max(1, ...recent.map(r => count(r.usage)));
  return '<div class="chart" aria-label="每日 Token 用量柱状图">' + recent.map(g => {
    const height = Math.max(2, Math.round(count(g.usage) / max * 100));
    return '<div class="chart-bar-wrap" title="' + escapeHTML(g.key + " · " + fmt(count(g.usage)) + " Token") + '"><div class="chart-column"><div class="chart-bar" style="height:' + height + '%"></div></div><div class="chart-day">' + escapeHTML(g.key.slice(5)) + "</div></div>";
  }).join("") + '</div><div class="legend"><span><i class="dot"></i> 每日真实 Token 用量</span><span>输入包含缓存 Token；推理输出包含在输出中</span></div>';
}
function cachePanel(rows) {
  const a = aggregate(rows), u = a.usage;
  const rate = u.input ? u.cached / u.input : 0;
  return '<div class="stat-row"><span>缓存输入 Token</span><span class="num">' + fmt(u.cached) + '</span></div>' +
    '<div class="progress"><div class="progress-fill" style="width:' + (rate * 100).toFixed(2) + '%"></div></div>' +
    '<div class="stat-row"><span>非缓存输入 Token</span><span class="num">' + fmt(Math.max(0, u.input - u.cached)) + '</span></div>' +
    '<div class="stat-row"><span>输出 Token（含推理）</span><span class="num">' + fmt(u.output) + '</span></div>' +
    '<div class="stat-row"><span>其中 Reasoning Token</span><span class="num">' + fmt(u.reasoning) + '</span></div>' +
    '<div class="stat-row"><span>缓存节省（API 等效）</span><span class="num highlight">' + money(a.savedUSD) + (a.missing ? " *" : "") + '</span></div>';
}
function renderOverview(rows) {
  const popular = grouped(rows, r => r.model).slice(0, 6);
  const html = '<div class="split">' +
    section("Token 使用趋势", "按本地日历日期汇总，展示最近最多 24 个有用量的日期", barChart(rows)) +
    section("缓存效率", "缓存输入仍计入总输入，但通常具有更低的 API 单价", cachePanel(rows)) +
    "</div>" +
    section("主要模型", "按 Token 用量排序；* 表示存在缺失价格", table(defaultColumns(), popular.map(g =>
      '<tr><td class="primary-cell"><span class="chip">' + escapeHTML(g.key) + "</span></td>" + metricCellsRich(g) + "</tr>").join(""))) +
    renderSessionTable(rows, 8);
  return html;
}
function renderProjectTable(rows) {
  const groups = grouped(rows, r => r.session.projectPath || "未知项目");
  const body = groups.map(g => {
    const s = g.rows[0].session;
    return '<tr><td class="primary-cell">' + escapeHTML(s.project) +
      '<div class="secondary-cell" title="' + escapeHTML(g.key) + '">' + escapeHTML(g.key) +
      '</div><div class="secondary-cell">' + fmt(g.sessions) + " 个会话</div></td>" + metricCellsRich(g) + "</tr>";
  }).join("");
  return section("项目成本与 Token", "统计按 Codex 日志记录的工作目录（cwd）分组，同名不同路径不会混淆", table(defaultColumns(), body));
}
function renderModelTable(rows) {
  const groups = grouped(rows, r => r.model);
  return section("模型使用情况", "输入缓存、非缓存输入和输出分开计价", table(defaultColumns(),
    groups.map(g => '<tr><td class="primary-cell"><span class="chip">' + escapeHTML(g.key) + "</span></td>" + metricCellsRich(g) + "</tr>").join("")));
}
function renderDateTable(rows) {
  const groups = grouped(rows, r => r.date).sort((a, b) => b.key.localeCompare(a.key));
  return section("日期明细", "按本地日期统计，而不是按会话开始时间粗略归类", table(defaultColumns(),
    groups.map(g => '<tr><td class="primary-cell">' + escapeHTML(g.key) + "</td>" + metricCellsRich(g) + "</tr>").join("")));
}
function renderSessionTable(rows, limit = Infinity) {
  const groups = grouped(rows, r => r.session.id).sort((a, b) => (b.rows[0].session.lastSeen || "").localeCompare(a.rows[0].session.lastSeen || ""));
  const selected = groups.slice(0, limit);
  const body = selected.map(g => {
    const s = g.rows[0].session;
    return '<tr class="clickable" data-session="' + escapeHTML(s.id) + '" title="点击查看单独会话">' +
      '<td class="primary-cell">' + escapeHTML(s.title) +
      '<div class="secondary-cell">' + escapeHTML(s.project + " · " + new Date(s.lastSeen).toLocaleString("zh-CN")) +
      '</div></td><td class="num">' + fmt(s.turns) + "</td>" + metricCellsRich(g) + "</tr>";
  }).join("");
  return section(limit === Infinity ? "单独会话" : "最近会话", "点击任何一行查看按模型、日期拆分的用量及成本", table([{ text: "会话" }, { text: "消息轮次", right: true }, ...defaultColumns().slice(1)], body));
}
function renderPricing(rows) {
  const models = [...new Set((state.report?.sessions || []).flatMap(s => s.buckets.map(b => b.model)))].sort();
  const rates = state.prices?.models || {};
  const options = models.map(m => '<option value="' + escapeHTML(m) + '">' + escapeHTML(m) + "</option>").join("");
  const current = models.map(model => {
    const rate = rates[model] || rates["openai/" + model];
    const cells = rate
      ? numTd(money(rate.inputPerMillion)) + numTd(money(rate.cachedPerMillion)) + numTd(money(rate.outputPerMillion))
      : '<td colspan="3" class="price-unknown">未定价（不计入成本估算）</td>';
    return '<tr><td class="primary-cell"><span class="chip">' + escapeHTML(model) + "</span></td>" + cells + "</tr>";
  }).join("");
  const source = "价格来源：" + (state.prices?.source || "尚未同步") + " · 更新于：" + (state.prices?.updatedAt ? new Date(state.prices.updatedAt).toLocaleString("zh-CN") : "从未同步");
  return section("同步公开 API 单价", source,
      '<p class="helper">只有点击下面的按钮后，才会向 GitHub 的 LiteLLM 公共定价 JSON 发起请求。不会携带任何 Codex 会话、提示词、项目路径或认证信息。价格是估算来源，必要时请以 OpenAI 官方定价页面为准。</p>' +
      '<button id="sync-prices" class="button primary" type="button">↻ 同步最新公开价格</button>') +
    section("手动覆盖模型价格", "单位 USD / 100 万 Token。手动保存只写入用户目录中的 prices.json。",
      '<form id="price-form" class="form-grid"><label>模型<input class="form-input" list="model-prices" name="model" placeholder="例如 gpt-5.1-codex" required><datalist id="model-prices">' + options +
      '</datalist></label><label>普通输入<input class="form-input" type="number" name="input" min="0" step="any" required></label>' +
      '<label>缓存输入<input class="form-input" type="number" name="cached" min="0" step="any" required></label>' +
      '<label>输出<input class="form-input" type="number" name="output" min="0" step="any" required></label>' +
      '<button type="submit" class="button">保存费率</button></form>') +
    section("已检测模型的单价表", "该表仅包含从本地会话日志中检测到的模型", table(
      [{ text: "模型" }, { text: "普通输入 / M", right: true }, { text: "缓存输入 / M", right: true }, { text: "输出 / M", right: true }], current));
}
function render() {
  $("page-title").textContent = heading[state.page];
  document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.page === state.page));
  if (!state.report) return;
  const rows = filtered();
  const active = aggregate(rows);
  $("subtitle").textContent = fmt(active.sessions) + " 个会话 · " + fmt(rows.length) + " 组模型/日期用量 · 仅本机数据";
  renderMetrics(rows);
  let html;
  if (state.page === "overview") html = renderOverview(rows);
  else if (state.page === "projects") html = renderProjectTable(rows) + renderDateTable(rows);
  else if (state.page === "models") html = renderModelTable(rows) + renderDateTable(rows);
  else if (state.page === "sessions") html = renderSessionTable(rows);
  else html = renderPricing(rows);
  if (!rows.length && state.page !== "pricing") {
    html = '<div class="panel empty"><strong>当前筛选范围没有日志用量</strong>请检查 Codex 会话目录、日期和模型筛选。打开 Codex 进行一次对话后，点击“刷新日志”即可重新扫描。</div>';
  }
  $("content").innerHTML = html;
  if (state.page === "pricing") wirePricing();
}
function showSession(id) {
  const s = state.report?.sessions.find(x => x.id === id);
  if (!s) return;
  $("details-title").textContent = s.title;
  const rows = s.buckets.map(b => ({ ...b, session: s }));
  const a = aggregate(rows);
  $("details-body").innerHTML =
    '<div class="helper">项目：' + escapeHTML(s.projectPath || s.project) + '</div>' +
    '<div class="helper">会话 ID：<span class="codeish">' + escapeHTML(s.id) + '</span></div>' +
    '<div class="helper">开始于：' + escapeHTML(s.started ? new Date(s.started).toLocaleString("zh-CN") : "未知") +
    ' · 最后活跃：' + escapeHTML(s.lastSeen ? new Date(s.lastSeen).toLocaleString("zh-CN") : "未知") + '</div>' +
    '<div class="details-grid">' +
    [
      ["输入 Token", fmt(a.usage.input)], ["缓存输入", fmt(a.usage.cached)],
      ["非缓存输入", fmt(a.usage.input - a.usage.cached)], ["输出 Token", fmt(a.usage.output)],
      ["推理 Token（含在输出中）", fmt(a.usage.reasoning)], ["API 等效成本", priceText(a)],
    ].map(([label, value]) => '<div class="details-cell"><small>' + escapeHTML(label) + '</small><strong>' + escapeHTML(value) + '</strong></div>').join("") +
    "</div>" +
    section("本会话按日期与模型拆分", "读取的是模型调用的增量 Token 快照", table(
      [{ text: "日期" }, { text: "模型" }, { text: "输入", right: true }, { text: "缓存", right: true }, { text: "输出", right: true }, { text: "成本", right: true }],
      rows.map(r => '<tr><td>' + escapeHTML(r.date) + '</td><td><span class="chip">' + escapeHTML(r.model) + "</span></td>" +
        numTd(fmt(r.usage.input)) + numTd(fmt(r.usage.cached)) + numTd(fmt(r.usage.output)) +
        numTd(r.pricing?.known ? money(r.pricing.usd) : "未定价") + "</tr>").join("")
    ));
  $("details").showModal();
}
function wirePricing() {
  $("sync-prices")?.addEventListener("click", async e => {
    const btn = e.currentTarget; btn.disabled = true; btn.textContent = "正在同步…";
    try { state.prices = await request("/api/prices/sync", { method: "POST" }); notify("已同步 " + Object.keys(state.prices.models || {}).length + " 个模型价格；这不是实际会员账单。"); await loadReport(); }
    catch (error) { notify("价格同步失败：" + error.message, true); btn.disabled = false; btn.textContent = "↻ 同步最新公开价格"; }
  });
  $("price-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const payload = { model: String(form.get("model")).trim(), rates: { inputPerMillion: Number(form.get("input")), cachedPerMillion: Number(form.get("cached")), outputPerMillion: Number(form.get("output")) } };
    try { state.prices = await request("/api/prices/manual", { method: "POST", body: JSON.stringify(payload) }); notify("模型费率已保存"); await loadReport(); }
    catch (error) { notify("保存失败：" + error.message, true); }
  });
}
function excelSafe(s) {
  const value = String(s ?? "");
  return /^[\s]*[=+\-@\t\r]/.test(value) ? "'" + value : value;
}
function csvValue(s) { return '"' + excelSafe(s).replaceAll('"', '""') + '"'; }
function downloadCSV() {
  const rows = filtered();
  const header = ["会话 ID", "会话标题", "项目", "项目路径", "模型", "日期", "输入 Token", "缓存输入", "非缓存输入", "输出 Token", "其中推理输出", "缓存命中率", "API 等效成本 USD", "缓存节省 USD", "价格已知"];
  const data = rows.map(r => {
    const u = r.usage, p = r.pricing || {};
    return [r.session.id, r.session.title, r.session.project, r.session.projectPath, r.model, r.date, u.input, u.cached, u.input - u.cached, u.output, u.reasoning,
      percent(u.input ? u.cached / u.input : 0), p.known ? p.usd.toFixed(8) : "", p.known ? p.savedUSD.toFixed(8) : "", p.known ? "是" : "否"];
  });
  const text = "\ufeff" + [header, ...data].map(line => line.map(csvValue).join(",")).join("\r\n");
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "codex-usage-" + localDate(new Date()) + ".csv"; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
document.querySelectorAll("[data-page]").forEach(button => button.addEventListener("click", () => { state.page = button.dataset.page; render(); }));
$("days").addEventListener("change", e => { state.days = e.target.value; render(); });
$("project").addEventListener("change", e => { state.project = e.target.value; render(); });
$("model").addEventListener("change", e => { state.model = e.target.value; render(); });
$("search").addEventListener("input", e => { state.search = e.target.value.trim(); render(); });
$("refresh").addEventListener("click", () => loadReport(true));
$("export").addEventListener("click", downloadCSV);
$("close-details").addEventListener("click", () => $("details").close());
$("content").addEventListener("click", e => {
  const row = e.target.closest("[data-session]");
  if (row) showSession(row.dataset.session);
});
loadReport(true);
setInterval(() => { if (!document.hidden && $("details").open === false) loadReport(false); }, 60_000);
