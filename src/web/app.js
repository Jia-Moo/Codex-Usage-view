const token = document.querySelector('meta[name="local-token"]').content;
const $ = id => document.getElementById(id);
const state = { report: null, prices: null, page: "overview", days: "30", customStart: "", customEnd: "", project: "all", model: "all", search: "", projectDetail: null, loading: false };
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
function money(n) {
  const value = Number(n || 0);
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "$0.00";
  if (value < 0.00000001) return "<$0.00000001";
  const digits = value >= 1 ? 3 : value >= 0.01 ? 4 : value >= 0.0001 ? 6 : 8;
  return "$" + value.toFixed(digits);
}
function percent(n) { return (100 * Number(n || 0)).toFixed(1) + "%"; }
function localDate(date) {
  const d = new Date(date), pad = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}
function shiftLocalDays(offset) {
  // Use local calendar arithmetic at noon to avoid DST midnight transitions.
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return localDate(date);
}
function validLocalDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const check = new Date(year, month - 1, day, 12);
  return check.getFullYear() === year && check.getMonth() + 1 === month && check.getDate() === day;
}
function dateBounds() {
  if (state.days === "all") return { start: "", end: "" };
  if (state.days === "today") {
    const today = localDate(new Date());
    return { start: today, end: today };
  }
  if (state.days === "custom") {
    if (!validLocalDate(state.customStart) || !validLocalDate(state.customEnd)) {
      return { invalid: true, message: "请选择有效的开始日期和结束日期。" };
    }
    if (state.customStart > state.customEnd) {
      return { invalid: true, message: "开始日期不能晚于结束日期。" };
    }
    return { start: state.customStart, end: state.customEnd };
  }
  const days = Number(state.days);
  if (!Number.isInteger(days) || days < 1) return { invalid: true, message: "时间范围无效。" };
  return { start: shiftLocalDays(1 - days), end: localDate(new Date()) };
}
function syncDateControls() {
  const custom = state.days === "custom";
  $("custom-range").classList.toggle("hidden", !custom);
  $("date-start").value = state.customStart;
  $("date-end").value = state.customEnd;
  const bounds = dateBounds();
  const hint = $("range-hint");
  hint.textContent = bounds.invalid ? bounds.message : "包含起止两天，按计算机本地日期统计。";
  hint.classList.toggle("invalid", !!bounds.invalid);
  $("export").disabled = !!bounds.invalid;
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
  const rows = [], bounds = dateBounds(), search = state.search.toLowerCase();
  if (bounds.invalid) return rows;
  for (const session of state.report?.sessions || []) {
    if (state.project !== "all" && session.projectPath !== state.project) continue;
    if (search && ![session.title, session.project, session.projectPath, session.id, ...session.buckets.map(b => b.model)].some(s => String(s || "").toLowerCase().includes(search))) continue;
    if (state.page === "projects" && state.projectDetail && (session.projectPath || "未知项目") !== state.projectDetail) continue;
    for (const bucket of session.buckets) {
      if ((bounds.start && bucket.date < bounds.start) ||
          (bounds.end && bucket.date > bounds.end)) continue;
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
  if (!agg.priced && agg.missing) return "未定价";
  return (agg.missing ? "≥ " : "") + money(agg.usd);
}
function renderMetrics(rows) {
  const a = aggregate(rows);
  const uncached = Math.max(0, a.usage.input - a.usage.cached);
  $("metrics").innerHTML = [
    metric("总 Token 消耗", short(count(a.usage)), fmt(a.usage.input) + " 输入 · " + fmt(a.usage.output) + " 输出", "accent"),
    metric("输入缓存命中率", percent(a.usage.input ? a.usage.cached / a.usage.input : 0), fmt(a.usage.cached) + " 缓存 · " + fmt(uncached) + " 非缓存", "aqua"),
    metric("API 等效成本", priceText(a), a.missing ? "有 " + a.missing + " 组未定价；已知成本仅为下限" : "按 Standard API 单价估算 · 非实际账单", "green"),
    metric("缓存节省成本", a.priced ? (a.missing ? "≥ " : "") + money(a.savedUSD) : (a.missing ? "未定价" : "$0.00"), fmt(a.sessions) + " 个会话 · 推理输出 " + fmt(a.usage.reasoning), "amber"),
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
    '<div class="stat-row"><span>缓存节省（API 等效）</span><span class="num highlight">' + (a.priced ? (a.missing ? "≥ " : "") + money(a.savedUSD) : "未定价") + '</span></div>';
}
function renderOverview(rows) {
  const popular = grouped(rows, r => r.model).slice(0, 6);
  const html = '<div class="split">' +
    section("Token 使用趋势", "按本地日历日期汇总，展示最近最多 24 个有用量的日期", barChart(rows)) +
    section("缓存效率", "缓存输入仍计入总输入，但通常具有更低的 API 单价", cachePanel(rows)) +
    "</div>" +
    section("主要模型", "按 Token 用量排序。费用显示“≥”说明部分模型未定价", table(defaultColumns(), popular.map(g =>
      '<tr><td class="primary-cell"><span class="chip">' + escapeHTML(g.key) + "</span></td>" + metricCellsRich(g) + "</tr>").join(""))) +
    renderSessionTable(rows, 8);
  return html;
}
function renderProjectTable(rows) {
  const groups = grouped(rows, r => r.session.projectPath || "未知项目");
  const body = groups.map(g => {
    const s = g.rows[0].session;
    return '<tr><td class="primary-cell"><button type="button" class="project-link" data-project-open="' + escapeHTML(g.key) + '">' +
      '<span>' + escapeHTML(s.project) + '</span><span aria-hidden="true" class="project-arrow">↗</span></button>' +
      '<div class="secondary-cell" title="' + escapeHTML(g.key) + '">' + escapeHTML(g.key) +
      '</div><div class="secondary-cell">' + fmt(g.sessions) + " 个会话 · " + fmt(g.rows.length) + " 个用量记录</div></td>" + metricCellsRich(g) + "</tr>";
  }).join("");
  return section("项目清单", "点击项目名称，查看该项目各个模型的 Token、缓存命中率及 API 等效成本", table(defaultColumns(), body));
}
function renderProjectDetail(rows) {
  const first = rows[0]?.session;
  const name = first?.project || state.projectDetail?.split(/[\\/]/).pop() || "未知项目";
  const total = aggregate(rows);
  const groups = grouped(rows, r => r.model);
  const tokenTotal = Math.max(1, count(total.usage));
  const breakdown = groups.map(g => {
    const share = 100 * count(g.usage) / tokenTotal;
    return '<tr><td class="primary-cell"><span class="chip">' + escapeHTML(g.key) +
      '</span><div class="secondary-cell">' + fmt(g.sessions) + ' 个会话</div></td>' +
      metricCellsRich(g) +
      '<td class="num"><div class="ratio"><span>' + share.toFixed(1) + '%</span><div class="progress tiny"><div class="progress-fill" style="width:' + share.toFixed(2) + '%"></div></div></div></td></tr>';
  }).join("");
  const heading = '<div class="breadcrumb"><button type="button" class="back-link" data-project-back="1">← 返回项目列表</button>' +
    '<span>/</span><strong>' + escapeHTML(name) + '</strong></div>' +
    '<div class="project-heading"><div><h2>' + escapeHTML(name) + '</h2>' +
    '<div class="codeish">' + escapeHTML(state.projectDetail) + '</div></div>' +
    '<div class="project-summary"><span>' + fmt(groups.length) + ' 个模型</span><span>' + fmt(total.sessions) + ' 个会话</span><strong>' +
    escapeHTML(priceText(total)) + '</strong></div></div>';
  return heading +
    section("模型消耗明细", "本项目按模型分组的真实 Token 数据；点击下方会话可继续查看单个对话", table(
      [...defaultColumns(), { text: "Token 占比", right: true }], breakdown)) +
    renderDateTable(rows) +
    renderSessionTable(rows);
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
    const key = model.toLowerCase().trim().replace(/^openai[/.]/, "");
    const rate = rates[model] || rates[key] || rates["openai/" + key];
    const cells = rate
      ? numTd(money(rate.inputPerMillion)) + numTd(money(rate.cachedPerMillion)) + numTd(money(rate.outputPerMillion))
      : '<td colspan="3" class="price-unknown">未定价（不计入成本估算）</td>';
    return '<tr><td class="primary-cell"><span class="chip">' + escapeHTML(model) + "</span></td>" + cells + "</tr>";
  }).join("");
  const missing = models.filter(model => {
    const key = model.toLowerCase().trim().replace(/^openai[/.]/, "");
    return !rates[model] && !rates[key] && !rates["openai/" + key];
  });
  const source = "费用基于 OpenAI 官方 Standard API 单价 · 内置价格核对于 " + (state.prices?.officialCheckedAt || "2026-11-22") +
    " · " + (state.prices?.source || "官方内置") + (state.prices?.updatedAt ? " · 外部同步于 " + new Date(state.prices.updatedAt).toLocaleString("zh-CN") : "");
  const warning = missing.length
    ? '<div class="notice inline-notice"><strong>' + missing.length + ' 个模型没有对应价格</strong><p>无法给这些模型计算等效成本：' +
      missing.map(escapeHTML).join('、') + '。可尝试同步或在下方手动指定其 API 费率。</p></div>'
    : '<p class="helper">当前日志中的模型均有可用价格；若使用了非 Standard 计费档位，请手动调整。</p>';
  return section("同步公开 API 单价", source,
      warning + '<p class="helper">内置模型价格无需联网即可估算。点击同步会从 LiteLLM 获取缺失模型的价格，不发送 Codex 日志、项目路径或认证数据。官方内置价格优先于第三方目录；手动设置优先于两者。<a href="https://developers.openai.com/api/docs/pricing" target="_blank" rel="noopener noreferrer">查看官方 API 价格</a></p>' +
      '<button id="sync-prices" class="button primary" type="button">同步其他模型价格</button>') +
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
  $("page-title").textContent = state.page === "projects" && state.projectDetail ? "项目明细" : heading[state.page];
  document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.page === state.page));
  syncDateControls();
  if (!state.report) return;
  const rows = filtered();
  const active = aggregate(rows);
  const meta = state.report.meta || {};
  $("subtitle").textContent = fmt(active.sessions) + " 个会话 · " + fmt(rows.length) +
    " 组模型/日期用量 · 本次扫描：" + fmt(meta.fullScans || 0) + " 完整，" +
    fmt(meta.resumedFiles || 0) + " 续读，" + fmt(meta.cacheHits || 0) + " 缓存";
  renderMetrics(rows);
  let html;
  if (state.page === "overview") html = renderOverview(rows);
  else if (state.page === "projects") html = state.projectDetail ? renderProjectDetail(rows) : renderProjectTable(rows) + renderDateTable(rows);
  else if (state.page === "models") html = renderModelTable(rows) + renderDateTable(rows);
  else if (state.page === "sessions") html = renderSessionTable(rows);
  else html = renderPricing(rows);
  if (!rows.length && state.page !== "pricing") {
    html = (state.page === "projects" && state.projectDetail ? '<div class="breadcrumb"><button type="button" class="back-link" data-project-back="1">← 返回项目列表</button></div>' : "") +
      '<div class="panel empty"><strong>' + (dateBounds().invalid ? "日期范围无效" : "当前筛选范围没有日志用量") +
      '</strong>' + (dateBounds().invalid ? escapeHTML(dateBounds().message) : "请检查 Codex 会话目录、日期和模型筛选。") + '</div>';
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
document.querySelectorAll("[data-page]").forEach(button => button.addEventListener("click", () => {
  state.page = button.dataset.page;
  state.projectDetail = null;
  render();
}));
$("days").addEventListener("change", e => {
  state.days = e.target.value;
  if (state.days === "custom" && !state.customStart && !state.customEnd) {
    state.customStart = shiftLocalDays(-29);
    state.customEnd = localDate(new Date());
  }
  render();
});
for (const [id, key] of [["date-start", "customStart"], ["date-end", "customEnd"]]) {
  $("" + id).addEventListener("change", e => { state[key] = e.target.value; render(); });
}
$("project").addEventListener("change", e => { state.project = e.target.value; render(); });
$("model").addEventListener("change", e => { state.model = e.target.value; render(); });
$("search").addEventListener("input", e => { state.search = e.target.value.trim(); render(); });
$("refresh").addEventListener("click", () => loadReport(true));
$("export").addEventListener("click", downloadCSV);
$("close-details").addEventListener("click", () => $("details").close());
$("content").addEventListener("click", e => {
  const project = e.target.closest("[data-project-open]");
  if (project) {
    state.page = "projects";
    state.projectDetail = project.dataset.projectOpen;
    render();
    window.scrollTo({ top: 0, behavior: "instant" });
    return;
  }
  if (e.target.closest("[data-project-back]")) {
    state.projectDetail = null;
    render();
    window.scrollTo({ top: 0, behavior: "instant" });
    return;
  }
  const row = e.target.closest("[data-session]");
  if (row) showSession(row.dataset.session);
});
loadReport(true);
setInterval(() => { if (!document.hidden && $("details").open === false) loadReport(false); }, 60_000);
