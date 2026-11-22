/**
 * Price catalog: the ONLY outbound HTTP request this application can make.
 * This request is opt-in, fixed to the public LiteLLM model-price JSON.
 * No session identifiers, prompts, paths, or authentication headers are sent.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const PRICING_SOURCE = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

/**
 * Verified OpenAI Standard text-token API rates (USD per million tokens),
 * checked 2026-11-22. Exact model IDs only; no invented prices for unknown aliases.
 * Source: https://developers.openai.com/api/docs/pricing
 * Individual references:
 * https://developers.openai.com/api/docs/models/gpt-5.1-codex
 * https://developers.openai.com/api/docs/models/gpt-5.2-codex
 * https://developers.openai.com/api/docs/models/gpt-5.3-codex
 * https://developers.openai.com/api/docs/models/gpt-6.1-sol
 * https://developers.openai.com/api/docs/models/gpt-6.1-terra
 * https://developers.openai.com/api/docs/models/gpt-6-luna
 * https://developers.openai.com/api/docs/models/gpt-6.2-sol
 * https://developers.openai.com/api/docs/models/gpt-6.2-astra
 */
export const BUILTIN_PRICES = Object.freeze({
  "gpt-5.1-codex": { inputPerMillion: 1.25, cachedPerMillion: 0.125, outputPerMillion: 10 },
  "gpt-5.2-codex": { inputPerMillion: 1.75, cachedPerMillion: 0.175, outputPerMillion: 14 },
  "gpt-5.3-codex": { inputPerMillion: 1.75, cachedPerMillion: 0.175, outputPerMillion: 14 },
  "gpt-6.1-sol": { inputPerMillion: 2, cachedPerMillion: 0.10, outputPerMillion: 10 },
  "gpt-6.1-terra": { inputPerMillion: 1, cachedPerMillion: 0.05, outputPerMillion: 5 },
  "gpt-6-luna": { inputPerMillion: 0.10, cachedPerMillion: 0.01, outputPerMillion: 0.50 },
  "gpt-6.2-sol": { inputPerMillion: 2, cachedPerMillion: 0.10, outputPerMillion: 10 },
  "gpt-6.2-astra": { inputPerMillion: 8, cachedPerMillion: 0.40, outputPerMillion: 40 },
});

function composeCatalog(saved = {}) {
  const syncedModels = cleanPrices(saved.models || {});
  const overrides = cleanPrices(saved.overrides || {});
  // Third-party pricing fills gaps; verified official Standard rates take priority.
  // User manual overrides are always highest priority.
  const models = { ...syncedModels, ...BUILTIN_PRICES, ...overrides };
  const hasSync = Object.keys(syncedModels).length > 0;
  return {
    source: hasSync ? "OpenAI 官方内置 + LiteLLM" : "OpenAI 官方内置价格",
    updatedAt: saved.updatedAt || null,
    officialCheckedAt: "2026-11-22",
    models, syncedModels, overrides,
  };
}

export const defaultPriceFile = () => join(homedir(), ".codex-usage-view", "prices.json");

export async function loadPrices(file = defaultPriceFile()) {
  try {
    const obj = JSON.parse(await readFile(file, "utf8"));
    return composeCatalog(obj);
  } catch (error) {
    if (error.code === "ENOENT") return composeCatalog();
    throw error;
  }
}

function validRate(n) {
  const v = Number(n);
  return Number.isFinite(v) && v >= 0 && v <= 1e7 ? v : null;
}
export function cleanPrices(models) {
  if (!models || typeof models !== "object" || Array.isArray(models)) throw new Error("模型费率必须是对象");
  const out = {};
  for (const [model, rates] of Object.entries(models).slice(0, 10000)) {
    if (!model || model.length > 150 || !rates || typeof rates !== "object") continue;
    const inputPerMillion = validRate(rates.inputPerMillion);
    const cachedPerMillion = validRate(rates.cachedPerMillion);
    const outputPerMillion = validRate(rates.outputPerMillion);
    if ([inputPerMillion, cachedPerMillion, outputPerMillion].some(v => v === null)) continue;
    out[model] = { inputPerMillion, cachedPerMillion, outputPerMillion };
  }
  return out;
}

async function persistPrices(data, file) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, JSON.stringify(data, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
}
export async function saveManualPrice(model, rates, file = defaultPriceFile()) {
  if (typeof model !== "string" || !model.trim() || model.length > 150) throw new Error("模型名称无效");
  const cleaned = cleanPrices({ [model.trim()]: rates });
  if (!cleaned[model.trim()]) throw new Error("费率无效（单位 USD / 100 万 Token）");
  const current = await loadPrices(file);
  const overrides = { ...(current.overrides || {}), ...cleaned };
  const data = {
    updatedAt: new Date().toISOString(),
    models: current.syncedModels,
    overrides,
  };
  await persistPrices(data, file);
  return composeCatalog(data);
}
export async function syncPrices(file = defaultPriceFile()) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  let response;
  try {
    response = await fetch(PRICING_SOURCE, { signal: controller.signal, redirect: "error", headers: { "User-Agent": "codex-usage-view/1" } });
  } finally { clearTimeout(timeout); }
  if (!response.ok) throw new Error("价格服务器返回 " + response.status);
  const length = Number(response.headers.get("content-length") || 0);
  if (length > 18 * 1024 * 1024) throw new Error("价格文件过大");
  const text = await response.text();
  if (text.length > 18 * 1024 * 1024) throw new Error("价格文件过大");
  const source = JSON.parse(text);
  const models = {};
  for (const [key, value] of Object.entries(source)) {
    if (!value || typeof value !== "object") continue;
    if (value.litellm_provider !== "openai" && !key.startsWith("openai/")) continue;
    const input = validRate((value.input_cost_per_token ?? NaN) * 1e6);
    const output = validRate((value.output_cost_per_token ?? NaN) * 1e6);
    const cached = validRate((value.cache_read_input_token_cost ?? value.input_cost_per_token ?? NaN) * 1e6);
    if (input === null || output === null || cached === null) continue;
    const model = key.replace(/^openai\//, "");
    // Prefer the unprefixed OpenAI model entry over aliases.
    if (!(model in models) || key === model) {
      models[model] = { inputPerMillion: input, cachedPerMillion: cached, outputPerMillion: output };
    }
  }
  if (!Object.keys(models).length) throw new Error("未解析到 OpenAI 模型价格");
  const previous = await loadPrices(file);
  // Keep user-specified overrides across refreshes; imported prices stay separate.
  const overrides = previous.overrides || {};
  const data = { updatedAt: new Date().toISOString(), models, overrides };
  await persistPrices(data, file);
  return { ...composeCatalog(data), count: Object.keys(models).length, previousSource: previous.source };
}
