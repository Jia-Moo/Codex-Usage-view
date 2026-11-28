/**
 * Byte-accurate, memory-bounded JSONL reader.
 *
 * Only newline-terminated records are committed to the cursor. If a live log
 * ends with an incomplete record, the next append resumes at that record's
 * beginning and processes it exactly once when its newline arrives.
 */
import { createReadStream } from "node:fs";
import { createZstdDecompress } from "node:zlib";

export async function readJsonl(filePath, {
  start = 0,
  compressed = false,
  maxLineBytes = 32 * 1024 * 1024,
  onRecord,
} = {}) {
  if (!Number.isSafeInteger(start) || start < 0) throw new Error("Invalid JSONL cursor");
  // Zstd is not seekable by raw byte offset; compressed rollouts are reparsed
  // only when they change, and reused from the derived index when unchanged.
  if (compressed && start !== 0) throw new Error("Cannot resume a compressed JSONL stream");
  if (typeof onRecord !== "function") throw new Error("onRecord is required");
  let position = start;
  let cursor = start;
  let pending = [];
  let pendingBytes = 0;
  let discard = false;
  let skippedLongLines = 0;
  let malformedLines = 0;
  let records = 0;
  const source = createReadStream(filePath, compressed
    ? { highWaterMark: 256 * 1024 }
    : { start, highWaterMark: 256 * 1024 });
  if (compressed && typeof createZstdDecompress !== "function") {
    source.destroy();
    throw new Error("Node.js 22.15+ is required to read .jsonl.zst files");
  }
  const stream = compressed ? source.pipe(createZstdDecompress()) : source;
  if (compressed) source.on("error", error => stream.destroy(error));
  for await (const chunk of stream) {
    let at = 0;
    while (at < chunk.length) {
      const newline = chunk.indexOf(10, at); // LF, Windows CRLF also supported
      const end = newline === -1 ? chunk.length : newline;
      const fragment = chunk.subarray(at, end);
      if (!discard) {
        if (pendingBytes + fragment.length > maxLineBytes) {
          discard = true;
          pending = [];
          pendingBytes = 0;
        } else if (fragment.length) {
          pending.push(fragment);
          pendingBytes += fragment.length;
        }
      }
      position += end - at;
      if (newline !== -1) {
        position++;
        cursor = position;
        if (discard) {
          skippedLongLines++;
        } else if (pendingBytes) {
          // The Buffer is released immediately after parsing; no whole-file load.
          const text = Buffer.concat(pending, pendingBytes).toString("utf8").trim();
          if (text) {
            try {
              const entry = JSON.parse(text);
              onRecord(entry);
              records++;
            } catch (error) {
              // Malformed JSON is tolerable; errors in parsing the event itself
              // should surface as a scan failure rather than be mislabelled.
              if (error instanceof SyntaxError) malformedLines++;
              else throw error;
            }
          }
        }
        discard = false;
        pending = [];
        pendingBytes = 0;
        at = newline + 1;
      } else at = end;
    }
  }
  // A valid final record may not have a newline. If still incomplete,
  // preserve the cursor so appended bytes can complete the JSON safely.
  if (!discard && pendingBytes) {
    const text = Buffer.concat(pending, pendingBytes).toString("utf8").trim();
    if (text) {
      try {
        const entry = JSON.parse(text);
        onRecord(entry);
        records++;
        cursor = position;
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
    }
  }
  return { cursor, skippedLongLines, malformedLines, records, incompleteBytes: position - cursor };
}
