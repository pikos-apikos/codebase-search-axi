/**
 * The results boundary: normalize rg events into files/matches/context/
 * metrics, preserve byte fidelity, enforce display limits truthfully, and
 * calculate completeness. Never reparses patterns and never launches rg.
 */
import { readFileSync, statSync } from "node:fs";
import { RgError, type RgBackend } from "./backend.js";
import { toRootRelative, type ResolvedRoot } from "./policy.js";

/** A fidelity-preserving value: a UTF-8 string or lossless padded base64. */
export type Value = string | { bytes: string };

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** Decode bytes as a string when valid UTF-8, else lossless padded base64. */
export function encoded(raw: Buffer): Value {
  try {
    return utf8.decode(raw);
  } catch {
    return { bytes: raw.toString("base64") };
  }
}

/** Both rg JSON value variants back to exact bytes. */
export function rgBytes(value: { text?: string; bytes?: string }): Buffer {
  if (typeof value.text === "string") {
    return Buffer.from(value.text, "utf-8");
  }
  if (typeof value.bytes === "string") {
    return Buffer.from(value.bytes, "base64");
  }
  throw new RgError(
    "ripgrep_failed",
    "The search process returned an invalid result.",
  );
}

interface ByteValue {
  text?: string;
  bytes?: string;
}

function invalidResult(): RgError {
  return new RgError("ripgrep_failed", "The search process returned an invalid result.");
}

/** Root-relative, fidelity-preserving file path for a raw absolute path. */
function relativePath(raw: Buffer, root: ResolvedRoot): Value {
  return encoded(toRootRelative(raw, root.searchPathBytes));
}

function eventPath(data: Record<string, unknown>, root: ResolvedRoot): Value {
  const path = data["path"] as ByteValue | undefined;
  if (path === undefined) {
    throw invalidResult();
  }
  return relativePath(rgBytes(path), root);
}

interface MatchRecord {
  path: Value;
  line: number;
  column: number;
  end_line?: number;
  end_column?: number;
  text: Value;
  submatches: Array<Record<string, unknown>>;
  before?: Value[];
  after?: Value[];
}

function spanEnd(line: number, text: Buffer, end: number): [number, number] {
  const prefix = text.subarray(0, end);
  let endLine = line;
  for (const byte of prefix) {
    if (byte === 0x0a) endLine += 1;
  }
  const newline = prefix.lastIndexOf(0x0a);
  return [endLine, newline === -1 ? end + 1 : end - newline];
}

function contextKey(path: Value, line: number): string {
  return JSON.stringify([path, line]);
}

export interface ScanBounds {
  maxFiles?: number;
  maxBytes?: number;
}

async function scanPaths(
  backend: RgBackend,
  scan: ScanBounds,
): Promise<{ paths: (string | Buffer)[]; complete: boolean }> {
  const paths: (string | Buffer)[] = [];
  let complete = true;
  let filesSeen = 0;
  let bytes = 0;
  for await (const raw of backend.files()) {
    let size: number;
    try {
      size = statSync(raw).size;
    } catch {
      complete = false;
      break;
    }
    if (scan.maxFiles !== undefined && filesSeen >= scan.maxFiles) {
      complete = false;
      break;
    }
    if (scan.maxBytes !== undefined && bytes + size > scan.maxBytes) {
      complete = false;
      break;
    }
    filesSeen += 1;
    bytes += size;
    paths.push(raw);
  }
  return { paths, complete };
}

function envelope(
  command: string,
  key: string,
  values: unknown[],
  total: number,
  limit: number | null,
  scanComplete = true,
): Record<string, unknown> {
  const display = values.length === total;
  const record: Record<string, unknown> = {
    status: "ok",
    command,
    [key]: values,
    count: values.length,
    returned: values.length,
    ...(scanComplete ? { total } : {}),
    bounded: limit !== null,
    complete: { scan: scanComplete, display: scanComplete && display },
  };
  if (!display) {
    record.help = "Use --full to return all results within the existing exclusions.";
  }
  return record;
}

/**
 * All result functions run the scan to completion and only then produce the
 * record. Any failure (interruption, a late backend error, malformed events)
 * discards partial results: no partial success is ever emitted after a scan
 * error, and interrupted scans never report complete results.
 */

export async function files(
  backend: RgBackend,
  root: ResolvedRoot,
  limit: number | null,
  scan: ScanBounds = {},
): Promise<Record<string, unknown>> {
  const values: Value[] = [];
  let total = 0;
  let bytes = 0;
  let scanComplete = true;
  for await (const raw of backend.files()) {
    if (scan.maxFiles !== undefined && total >= scan.maxFiles) {
      scanComplete = false;
      break;
    }
    let size: number;
    try {
      size = statSync(raw).size;
    } catch {
      scanComplete = false;
      break;
    }
    if (scan.maxBytes !== undefined && bytes + size > scan.maxBytes) {
      scanComplete = false;
      break;
    }
    bytes += size;
    total += 1;
    if (limit === null || values.length < limit) values.push(relativePath(raw, root));
  }
  return envelope("files", "files", values, total, limit, scanComplete);
}

export async function matches(
  backend: RgBackend,
  root: ResolvedRoot,
  command: "search" | "context",
  pattern: Buffer,
  limit: number | null,
  before = 0,
  after = 0,
  scan: ScanBounds = {},
): Promise<Record<string, unknown>> {
  const values: MatchRecord[] = [];
  let total = 0;
  const selected = await scanPaths(backend, scan);
  let scanComplete = selected.complete;
  if (selected.paths.length === 0) return envelope(command, "matches", values, total, limit, scanComplete);
  const previous: Array<[number, Value]> = [];
  let following: MatchRecord[] = [];
  const emittedContext = new Set<string>();
  for await (const event of backend.events(pattern, before, after, selected.paths)) {
    const kind = event.type;
    if (kind === "begin") {
      previous.length = 0;
      following = [];
      continue;
    }
    if (kind === "end") {
      previous.length = 0;
      following = [];
      continue;
    }
    if (kind !== "match" && kind !== "context") {
      continue;
    }
    const data = event.data as Record<string, unknown>;
    const lineBytes = rgBytes(data["lines"] as ByteValue);
    const line = data["line_number"] as number;
    const text = encoded(rgBytes(data["lines"] as ByteValue));
    following = following.filter((item) => line <= (item.end_line ?? item.line) + after);
    for (const item of following) {
      if (item.after && !emittedContext.has(contextKey(item.path, line))) {
        item.after.push(text);
        emittedContext.add(contextKey(item.path, line));
      }
    }
    if (kind === "match") {
      total += 1;
      if (limit === null || values.length < limit) {
        const subRaw = (data["submatches"] as Array<Record<string, unknown>>) ?? [];
        if (subRaw.length === 0) {
          throw invalidResult();
        }
        const submatches: Array<Record<string, unknown>> = subRaw.map((match) => ({
          ...match,
          match: encoded(rgBytes(match["match"] as ByteValue)),
        }));
        const lineBytes = rgBytes(data["lines"] as ByteValue);
        const [endLine, endColumn] = spanEnd(line, lineBytes, Number(submatches[0]["end"]));
        const item: MatchRecord = {
          path: eventPath(data, root),
          line,
          column: Number(submatches[0]["start"]) + 1,
          text,
          submatches,
        };
        if (endLine !== line) {
          item.end_line = endLine;
          item.end_column = endColumn;
        }
        emittedContext.add(contextKey(item.path, line));
        if (command === "context") {
          item.before = previous
            .filter(([number]) => number >= line - before)
            .flatMap(([number, value]) => {
              const key = contextKey(item.path, number);
              if (emittedContext.has(key)) return [];
              emittedContext.add(key);
              return [value];
            });
          item.after = [];
          if (after > 0) {
            following.push(item);
          }
        }
        values.push(item);
      }
    }
    previous.push([line, text]);
    if (before > 0 && previous.length > before) {
      previous.shift();
    }
  }
  return envelope(command, "matches", values, total, limit, scanComplete);
}

export async function count(
  backend: RgBackend,
  root: ResolvedRoot,
  pattern: Buffer,
  limit: number | null,
  countMatches = false,
  scan: ScanBounds = {},
): Promise<Record<string, unknown>> {
  const byPath = new Map<string, { path: Value; count: number }>();
  let total = 0;
  const selected = await scanPaths(backend, scan);
  const scanComplete = selected.complete;
  if (selected.paths.length === 0) {
    return {
      status: "ok",
      command: "count",
      counts: [],
      count: 0,
      returned: 0,
      ...(scanComplete ? { total: 0 } : {}),
      matched_files: 0,
      bounded: limit !== null,
      complete: { scan: scanComplete, display: scanComplete },
      ...(scanComplete ? {} : { help: "Use --full or raise scan bounds to scan all results within the existing exclusions." }),
    };
  }
  let boundedComplete = scanComplete;
  for await (const event of backend.events(pattern, 0, 0, selected.paths)) {
    if (event.type === "begin") {
      continue;
    }
    if (event.type !== "match") continue;
    const data = event.data as Record<string, unknown>;
    const path = eventPath(data, root);
    const key = JSON.stringify(path);
    let item = byPath.get(key);
    if (!item) {
      item = { path, count: 0 };
      byPath.set(key, item);
    }
    const submatches = (data["submatches"] as unknown[] | undefined) ?? [];
    const increment = countMatches ? Math.max(1, submatches.length) : 1;
    item.count += increment;
    total += increment;
  }
  const values = [...byPath.values()]
    .sort((left, right) => {
      const leftKey = JSON.stringify(left.path);
      const rightKey = JSON.stringify(right.path);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    })
    .slice(0, limit ?? undefined);
  return {
    status: "ok",
    command: "count",
    counts: values,
    count: values.length,
    returned: values.length,
    ...(boundedComplete ? { total } : {}),
    matched_files: byPath.size,
    bounded: limit !== null,
    complete: { scan: boundedComplete, display: boundedComplete && values.length === byPath.size },
    ...(boundedComplete && values.length === byPath.size
      ? {}
      : { help: "Use --full or raise scan bounds to scan all results within the existing exclusions." }),
  };
}

export async function metrics(
  backend: RgBackend,
  root: ResolvedRoot,
  limit: number | null,
  scan: ScanBounds = {},
): Promise<Record<string, unknown>> {
  let fileCount = 0;
  let byteCount = 0;
  let lineCount = 0;
  let scanComplete = true;
  let scanBytes = 0;
  for await (const raw of backend.files()) {
    if (limit !== null && fileCount >= limit) break;
    if (scan.maxFiles !== undefined && fileCount >= scan.maxFiles) { scanComplete = false; break; }
    // rg reports absolute paths under the (absolute) search path; the raw
    // bytes are a valid filesystem path, including non-UTF-8 components.
    let size: number;
    try {
      size = statSync(raw).size;
    } catch {
      scanComplete = false;
      break;
    }
    if (scan.maxBytes !== undefined && scanBytes + size > scan.maxBytes) { scanComplete = false; break; }
    const content = readFileSync(raw);
    scanBytes += content.length;
    fileCount += 1;
    byteCount += content.length;
    lineCount +=
      countNewlines(content) +
      (content.length > 0 && content[content.length - 1] !== 0x0a ? 1 : 0);
  }
  if (limit !== null) {
    return {
      status: "ok",
      command: "metrics",
      files_seen: fileCount,
      bytes_seen: byteCount,
      lines_seen: lineCount,
      bounded: true,
      complete: { scan: scanComplete && false, display: true },
      help: "Use --full to scan all files within the existing exclusions.",
    };
  }
  return {
    status: "ok",
    command: "metrics",
    files: fileCount,
    bytes: byteCount,
    lines: lineCount,
    bounded: false,
    complete: { scan: scanComplete, display: true },
  };
}

function countNewlines(content: Buffer): number {
  let count = 0;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === 0x0a) count += 1;
  }
  return count;
}
