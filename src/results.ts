/**
 * The results boundary: normalize rg events into files/matches/context/
 * metrics, preserve byte fidelity, enforce display limits truthfully, and
 * calculate completeness. Never reparses patterns and never launches rg.
 */
import { readFileSync } from "node:fs";
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
  text: Value;
  submatches: Array<Record<string, unknown>>;
  before?: Value[];
  after?: Value[];
}

function contextKey(path: Value, line: number): string {
  return JSON.stringify([path, line]);
}

function envelope(
  command: string,
  key: string,
  values: unknown[],
  total: number,
  limit: number | null,
): Record<string, unknown> {
  const display = values.length === total;
  const record: Record<string, unknown> = {
    status: "ok",
    command,
    [key]: values,
    count: values.length,
    returned: values.length,
    total,
    bounded: limit !== null,
    complete: { scan: true, display },
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
): Promise<Record<string, unknown>> {
  const values: Value[] = [];
  let total = 0;
  for await (const raw of backend.files()) {
    total += 1;
    if (limit === null || values.length < limit) {
      values.push(relativePath(raw, root));
    }
  }
  return envelope("files", "files", values, total, limit);
}

export async function matches(
  backend: RgBackend,
  root: ResolvedRoot,
  command: "search" | "context",
  pattern: Buffer,
  limit: number | null,
  before = 0,
  after = 0,
): Promise<Record<string, unknown>> {
  const values: MatchRecord[] = [];
  let total = 0;
  const previous: Array<[number, Value]> = [];
  let following: MatchRecord[] = [];
  const emittedContext = new Set<string>();

  for await (const event of backend.events(pattern, before, after)) {
    const kind = event.type;
    if (kind === "begin" || kind === "end") {
      previous.length = 0;
      following = [];
      continue;
    }
    if (kind !== "match" && kind !== "context") {
      continue;
    }
    const data = event.data as Record<string, unknown>;
    const line = data["line_number"] as number;
    const text = encoded(rgBytes(data["lines"] as ByteValue));
    following = following.filter((item) => line <= item.line + after);
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
        const item: MatchRecord = {
          path: eventPath(data, root),
          line,
          column: Number(submatches[0]["start"]) + 1,
          text,
          submatches,
        };
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
  return envelope(command, "matches", values, total, limit);
}

export async function metrics(
  backend: RgBackend,
  root: ResolvedRoot,
  limit: number | null,
): Promise<Record<string, unknown>> {
  let fileCount = 0;
  let byteCount = 0;
  let lineCount = 0;
  for await (const raw of backend.files()) {
    if (limit !== null && fileCount >= limit) {
      break;
    }
    // rg reports absolute paths under the (absolute) search path; the raw
    // bytes are a valid filesystem path, including non-UTF-8 components.
    const content = readFileSync(raw);
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
      complete: { scan: false, display: true },
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
    complete: { scan: true, display: true },
  };
}

function countNewlines(content: Buffer): number {
  let count = 0;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === 0x0a) count += 1;
  }
  return count;
}
