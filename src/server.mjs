import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { scanCodex, priceReport } from "./core.mjs";
import { loadPrices, syncPrices, saveManualPrice } from "./pricing.mjs";

const currentDir = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = join(currentDir, "web");
const LOCAL_TOKEN = randomBytes(32).toString("hex");
const MIME = { html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8" };

function options(argv) {
  const out = { root: process.env.CODEX_HOME || join(homedir(), ".codex"), port: 0, showTitles: true, open: true };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") out.root = argv[++i] || out.root;
    else if (argv[i] === "--port") out.port = Number(argv[++i]);
    else if (argv[i] === "--no-browser") out.open = false;
    else if (argv[i] === "--hide-titles") out.showTitles = false;
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log("Codex Usage View\n  node src/server.mjs [--root C:\\Users\\you\\.codex] [--port 0] [--no-browser] [--hide-titles]");
      process.exit(0);
    } else throw new Error("未知参数：" + argv[i]);
  }
  if (!Number.isSafeInteger(out.port) || out.port < 0 || out.port > 65535) throw new Error("无效端口");
  out.root = resolve(out.root);
  return out;
}

function openBrowser(url) {
  const [cmd, args] = process.platform === "win32"
    ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]
    : process.platform === "darwin"
      ? ["open", [url]]
      : ["xdg-open", [url]];
  const child = spawn(cmd, args, { stdio: "ignore", detached: true });
  child.on("error", () => console.log("请手动在浏览器打开上方地址"));
  child.unref();
}

function headers(extra = {}) {
  return {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    ...extra,
  };
}
function respond(res, status, data) {
  const payload = JSON.stringify(data);
  res.writeHead(status, headers({ "Content-Type": "application/json; charset=utf-8" }));
  res.end(payload);
}
function fail(res, status, message) { respond(res, status, { error: message }); }
async function jsonBody(req) {
  let size = 0, buffer = "";
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) throw new Error("请求过大");
    buffer += chunk.toString("utf8");
  }
  return JSON.parse(buffer || "{}");
}
export async function startServer(config = options(process.argv.slice(2))) {
  let scan = null, scanAt = 0, inFlight = null;
  async function snapshot(force = false) {
    if (!force && scan && Date.now() - scanAt < 20_000) return scan;
    if (inFlight) return inFlight;
    inFlight = scanCodex(config.root, { showTitles: config.showTitles });
    try { scan = await inFlight; scanAt = Date.now(); return scan; }
    finally { inFlight = null; }
  }
  let port = 0;
  const server = http.createServer(async (req, res) => {
    try {
      if (!req.headers.host || !["127.0.0.1:" + port, "localhost:" + port].includes(req.headers.host.toLowerCase())) {
        return fail(res, 403, "无效 Host");
      }
      const url = new URL(req.url, "http://127.0.0.1:" + port);
      const pathname = url.pathname;
      if (pathname === "/" && req.method === "GET") {
        let html = await readFile(join(WEB_DIR, "index.html"), "utf8");
        html = html.replaceAll("__LOCAL_TOKEN__", LOCAL_TOKEN);
        res.writeHead(200, headers({ "Content-Type": MIME.html }));
        return res.end(html);
      }
      const assets = { "/app.js": "app.js", "/styles.css": "styles.css" };
      if (assets[pathname] && req.method === "GET") {
        const name = assets[pathname], ext = name.split(".").pop();
        res.writeHead(200, headers({ "Content-Type": MIME[ext] }));
        return res.end(await readFile(join(WEB_DIR, name)));
      }
      if (pathname.startsWith("/api/")) {
        if (req.headers["x-local-token"] !== LOCAL_TOKEN) return fail(res, 403, "无效本机访问凭据");
        if (pathname === "/api/report" && req.method === "GET") {
          const force = url.searchParams.get("refresh") === "1";
          return respond(res, 200, priceReport(await snapshot(force), (await loadPrices()).models));
        }
        if (pathname === "/api/prices" && req.method === "GET") return respond(res, 200, await loadPrices());
        if (pathname === "/api/prices/sync" && req.method === "POST") {
          return respond(res, 200, await syncPrices());
        }
        if (pathname === "/api/prices/manual" && req.method === "POST") {
          const body = await jsonBody(req);
          return respond(res, 200, await saveManualPrice(body.model, body.rates));
        }
        return fail(res, 404, "未知接口");
      }
      return fail(res, 404, "未找到页面");
    } catch (err) {
      console.error("[local]", err.message);
      return fail(res, 500, String(err.message || "内部错误"));
    }
  });
  await new Promise((resolveReady, reject) => {
    server.once("error", reject);
    server.listen(config.port, "127.0.0.1", () => { port = server.address().port; resolveReady(); });
  });
  const url = "http://127.0.0.1:" + port + "/";
  console.log("\nCodex Usage View 正在本机运行\n本地日志目录：" + config.root + "\n浏览器地址：" + url + "\n按 Ctrl+C 关闭。不会上传会话内容。\n");
  if (config.open) openBrowser(url);
  return { server, url, port };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().catch(error => { console.error(error); process.exitCode = 1; });
}
