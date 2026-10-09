/**
 * Exact argument bytes.
 *
 * Node decodes process.argv as UTF-8, replacing undecodable bytes with U+FFFD,
 * and spawn/cwd accept only strings or already-lossy Buffers. On Linux the raw
 * argv bytes are still available from /proc/self/cmdline, so --root (and other
 * byte-sensitive values) are recovered exactly there. Other platforms fall
 * back to the UTF-8 encoding of process.argv, which is exact for valid UTF-8
 * arguments.
 */
import { readFileSync } from "node:fs";
import process from "node:process";

let cached: Buffer[] | undefined;

/**
 * Returns the raw bytes of process.argv (index-aligned with process.argv).
 * Falls back to the UTF-8 re-encoding of process.argv when the raw bytes are
 * unavailable or do not line up.
 */
export function rawArgvBytes(): Buffer[] {
  if (cached) return cached;
  if (process.platform === "linux") {
    try {
      const raw = readFileSync("/proc/self/cmdline");
      const parts: Buffer[] = [];
      let start = 0;
      for (let i = 0; i < raw.length; i++) {
        if (raw[i] === 0) {
          parts.push(raw.subarray(start, i));
          start = i + 1;
        }
      }
      if (parts.at(-1)?.length === 0) {
        parts.pop();
      }
      if (parts.length === process.argv.length) {
        cached = parts;
        return cached;
      }
    } catch {
      // Fall through to the string-based fallback.
    }
  }
  cached = process.argv.map((arg) => Buffer.from(arg, "utf-8"));
  return cached;
}

/** True when every byte is valid UTF-8. */
export function isValidUtf8(bytes: Buffer): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}
