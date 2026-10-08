/**
 * The policy boundary: canonicalize the root byte-exactly, own the effective
 * path exclusions, and give the backend a search path it can pass to rg.
 *
 * Node cannot hand non-UTF-8 bytes to a child process through argv, cwd, or a
 * string path. ripgrep output, however, is byte-faithful. So when the resolved
 * root is not valid UTF-8, we hand rg a temporary symlink with a valid name
 * whose target is the exact root bytes; rg then reports paths under that
 * symlink, which the results layer makes root-relative. Valid-UTF-8 roots are
 * canonicalized with realpath and passed directly.
 */
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isValidUtf8 } from "./argv.js";
import { RgError } from "./backend.js";

/** Mandatory exclusions that apply to every search mode. */
export const MANDATORY_GLOBS: readonly string[] = [
  "!**/.git/**",
  "!**/.env*",
  "!**/*.pem",
  "!**/*.key",
  "!**/*.crt",
  "!**/*.cer",
  "!**/*.p12",
  "!**/*.pfx",
  "!**/id_rsa*",
];

/** Optional exclusions used by bounded searches. */
export const OPTIONAL_GLOBS: readonly string[] = [
  "!**/node_modules/**",
  "!**/vendor/**",
  "!**/build/**",
  "!**/dist/**",
  "!**/target/**",
  "!**/coverage/**",
  "!**/.venv/**",
  "!**/venv/**",
  "!**/__pycache__/**",
];

/** A resolved root the backend can search byte-exactly. */
export interface ResolvedRoot {
  /** Absolute, valid-UTF-8 path to hand rg after `--`. */
  searchPath: string;
  /** The same path as bytes, for making result paths root-relative. */
  searchPathBytes: Buffer;
  /** Release any scratch resources (temp symlink) created for this root. */
  cleanup: () => void;
}

function expandUser(raw: Buffer): Buffer {
  if (raw.length === 1 && raw[0] === 0x7e) {
    return Buffer.from(process.env.HOME ?? "", "utf-8");
  }
  if (raw[0] === 0x7e && raw[1] === 0x2f) {
    return Buffer.concat([
      Buffer.from(process.env.HOME ?? "", "utf-8"),
      raw.subarray(1),
    ]);
  }
  return raw;
}

function invalidRoot(): RgError {
  return new RgError(
    "invalid_root",
    "Choose an existing, readable directory with --root.",
  );
}

function isDirectory(path: Buffer): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function startsWithAscii(value: Buffer, text: string): boolean {
  const prefix = Buffer.from(text, "ascii");
  return value.subarray(0, prefix.length).equals(prefix);
}

function endsWithAscii(value: Buffer, text: string): boolean {
  const suffix = Buffer.from(text, "ascii");
  return value.length >= suffix.length && value.subarray(-suffix.length).equals(suffix);
}

function isDeniedRoot(path: Buffer): boolean {
  return path
    .toString("latin1")
    .split("/")
    .some((part) => {
      const name = Buffer.from(part, "latin1");
      return (
        name.equals(Buffer.from(".git", "ascii")) ||
        startsWithAscii(name, ".env") ||
        startsWithAscii(name, "id_rsa") ||
        [".pem", ".key", ".crt", ".cer", ".p12", ".pfx"].some((suffix) =>
          endsWithAscii(name, suffix),
        )
      );
    });
}

function rejectDeniedRoot(path: Buffer): void {
  if (isDeniedRoot(path)) {
    throw invalidRoot();
  }
}

/** Resolve `--root` to a byte-exact, searchable absolute directory. */
export function resolveRoot(rawRoot: Buffer): ResolvedRoot {
  let abs = expandUser(rawRoot);
  if (abs.length === 0 || abs[0] !== 0x2f) {
    abs = Buffer.concat([Buffer.from(process.cwd(), "utf-8"), Buffer.from([0x2f]), abs]);
  }

  if (isValidUtf8(abs)) {
    const asString = abs.toString("utf-8");
    if (!isDirectory(abs)) {
      throw invalidRoot();
    }
    // Canonicalize (resolve symlinks / ..) like the previous implementation.
    let canonical = asString;
    try {
      canonical = realpathSync(asString);
    } catch {
      canonical = asString;
    }
    rejectDeniedRoot(Buffer.from(canonical, "utf-8"));
    return {
      searchPath: canonical,
      searchPathBytes: Buffer.from(canonical, "utf-8"),
      cleanup: () => {},
    };
  }

  // Non-UTF-8 root: expose it to rg through a valid-named temp symlink whose
  // target carries the exact root bytes.
  if (!isDirectory(abs)) {
    throw invalidRoot();
  }
  rejectDeniedRoot(abs);
  const dir = mkdtempSync(join(tmpdir(), "codebase-search-root-"));
  const link = join(dir, "root");
  symlinkSync(abs, link);
  return {
    searchPath: link,
    searchPathBytes: Buffer.from(link, "utf-8"),
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Make an absolute result path (bytes as reported by rg) root-relative in
 * POSIX form by stripping the search-path prefix.
 */
export function toRootRelative(resultPath: Buffer, searchPathBytes: Buffer): Buffer {
  const prefix = Buffer.concat([searchPathBytes, Buffer.from([0x2f])]);
  if (resultPath.subarray(0, prefix.length).equals(prefix)) {
    return resultPath.subarray(prefix.length);
  }
  // Fallback: strip a leading "./" or "/" so we never return an absolute path.
  let out = resultPath;
  if (out.length >= 2 && out[0] === 0x2e && out[1] === 0x2f) {
    out = out.subarray(2);
  }
  while (out.length > 0 && out[0] === 0x2f) {
    out = out.subarray(1);
  }
  return out;
}
