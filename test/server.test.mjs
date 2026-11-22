import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import { startServer } from "../src/server.mjs";

test("loopback server requires a local token and protects against DNS rebinding", async () => {
  const root = await mkdtemp(join(tmpdir(), "cuv-http-test-"));
  const sessionDir = join(root, "sessions");
  await mkdir(sessionDir);
  await writeFile(join(root, "auth.json"), JSON.stringify({ secret: "never-serve-me" }));
  await writeFile(join(sessionDir, "test.jsonl"), [
    JSON.stringify({ timestamp: "2026-11-22T13:00:00Z", type: "session_meta", payload: { id: "test-id", cwd: "/project/alpha" } }),
    JSON.stringify({ timestamp: "2026-11-22T13:01:00Z", type: "turn_context", payload: { model: "gpt-test" } }),
    JSON.stringify({ timestamp: "2026-11-22T13:02:00Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 75, output_tokens: 20 } } } }),
  ].join("\n"));
  const { server, url, port } = await startServer({ root, port: 0, showTitles: false, open: false });
  try {
    const page = await fetch(url);
    assert.equal(page.status, 200);
    const html = await page.text();
    const key = html.match(/name="local-token" content="([0-9a-f]{64})"/)?.[1];
    assert.ok(key);
    assert.match(page.headers.get("content-security-policy"), /script-src 'self'/);
    const unauthorized = await fetch(url + "api/report");
    assert.equal(unauthorized.status, 403);
    const authorized = await fetch(url + "api/report", { headers: { "X-Local-Token": key } });
    assert.equal(authorized.status, 200);
    const json = await authorized.json();
    assert.equal(json.sessions.length, 1);
    assert.equal(json.sessions[0].usage.input, 100);
    assert.equal(json.sessions[0].usage.cached, 75);
    assert.equal(json.sessions[0].usage.output, 20);
    assert.equal(json.sessions[0].project, "alpha");
    assert.doesNotMatch(JSON.stringify(json), /never-serve-me/);
    const hostRejected = await new Promise((resolve, reject) => {
      const req = httpRequest({ hostname: "127.0.0.1", port, path: "/api/report", headers: { Host: "malicious.example", "X-Local-Token": key } }, res => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      });
      req.once("error", reject);
      req.end();
    });
    assert.equal(hostRejected, 403);
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
