/**
 * Local-only derived statistics index; never stores the full JSONL payloads.
 * File signatures ensure append-only resume is not used for rewritten files.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const VERSION = 2;
const SAMPLE_BYTES = 4096;
export const defaultIndexFile = (root) => {
  const key = createHash("sha256").update(String(root || "default")).digest("hex").slice(0, 14);
  return join(homedir(), ".codex-usage-view", "usage-index-v2-" + key + ".json");
};

export async function fingerprint(file, size) {
  if (!Number.isSafeInteger(size) || size < 0) throw new Error("Invalid indexed size");
  const handle = await open(file, "r");
  try {
    const hash = createHash("sha256");
    hash.update(String(size) + ":");
    for (const offset of [...new Set([0, Math.max(0, size - SAMPLE_BYTES)])]) {
      const count = Math.min(SAMPLE_BYTES, Math.max(0, size - offset));
      if (count === 0) continue;
      const buffer = Buffer.allocUnsafe(count);
      const { bytesRead } = await handle.read(buffer, 0, count, offset);
      if (bytesRead !== count) throw new Error("Log changed while computing signature");
      hash.update(buffer);
    }
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}

export async function loadIndex(file, { root, showTitles, timeZone }) {
  try {
    const value = JSON.parse(await readFile(file, "utf8"));
    if (value.version !== VERSION || value.root !== root ||
      value.showTitles !== showTitles || value.timeZone !== timeZone ||
      !value.entries || typeof value.entries !== "object" || Array.isArray(value.entries)) {
      return {};
    }
    return value.entries;
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return {};
    throw error;
  }
}

export async function saveIndex(file, { root, showTitles, timeZone, entries }) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const data = JSON.stringify({
    version: VERSION, root, showTitles, timeZone, entries,
  });
  const temporary = file + ".tmp-" + randomBytes(8).toString("hex");
  try {
    // Atomic replacement; owner-only where the operating system supports it.
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(data, "utf8"); }
    finally { await handle.close(); }
    await rename(temporary, file);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}
