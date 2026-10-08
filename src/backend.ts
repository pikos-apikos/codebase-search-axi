/**
 * The backend boundary: the only place that launches rg. Patterns are values
 * following `-e` and the search path follows `--`; no native option
 * passthrough exists. `--no-config` keeps ambient ripgrep configuration from
 * changing the approved argument model while ordinary ignore, hidden-file,
 * binary, and encoding behavior is preserved. Stderr is spooled to a scratch
 * file so a diagnostic flood cannot deadlock the stdout stream; on failure at
 * most 64 KiB of it is forwarded verbatim.
 */
import { spawn, type ChildProcess } from "node:child_process";
import {
  accessSync,
  closeSync,
  constants,
  mkdirSync,
  openSync,
  readSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { AxiError } from "axi-sdk-js";
import { MANDATORY_GLOBS, OPTIONAL_GLOBS, type ResolvedRoot } from "./policy.js";

/** A structured backend/scan error with an optional raw diagnostic payload. */
export class RgError extends AxiError {
  /** Raw stderr bytes to forward verbatim, when present. */
  readonly diagnostics: Buffer | undefined;

  constructor(code: string, message: string, diagnostics?: Buffer) {
    super(message, code);
    this.name = "RgError";
    this.diagnostics = diagnostics;
  }
}

export interface RgEvent {
  type: string;
  data: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RgOptions {
  full?: boolean;
  fixedStrings?: boolean;
  caseMode?: "sensitive" | "ignore" | "smart";
  types?: string[];
  typesNot?: string[];
  globs?: string[];
  noIgnore?: boolean;
  hidden?: boolean;
  multiline?: boolean;
  multilineDotall?: boolean;
  pcre2?: boolean;
}

const DIAGNOSTIC_LIMIT = 65536;

const INVALID_PATTERN_MARKERS: readonly string[] = [
  "regex parse error",
  "error parsing regex",
  'the literal "\\n" is not allowed in a regex',
  'pattern contains "\\0" but it is impossible to match',
  "compiled regex exceeds size limit",
];

function resolveRg(): string {
  const pathVar = process.env.PATH ?? "";
  const names =
    process.platform === "win32"
      ? ["rg.exe", "rg.cmd", "rg.bat"]
      : ["rg"];
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of pathVar.split(delimiter(pathVar))) {
    if (dir.length === 0) continue;
    for (const name of names) {
      for (const ext of exts) {
        const candidate = join(dir, name + ext);
        if (isExecutableFile(candidate)) {
          return candidate;
        }
      }
    }
  }
  throw new RgError(
    "ripgrep_unavailable",
    "Install ripgrep and ensure rg is on PATH.",
  );
}

function delimiter(pathVar: string): string | RegExp {
  return process.platform === "win32" ? ";" : ":";
}

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export class RgBackend {
  private readonly rgPath: string;
  private readonly root: ResolvedRoot;
  private readonly baseArgs: string[];
  /** The running rg child, if any, so signals can reap it. */
  activeChild: ChildProcess | undefined;
  /** Set when the CLI was interrupted; scans then never report success. */
  interrupted = false;

  constructor(root: ResolvedRoot, options: RgOptions = {}) {
    this.rgPath = resolveRg();
    this.root = root;
    this.baseArgs = ["--no-config"];
    // Apply caller filters first, then append mandatory denies so a positive
    // --glob cannot override the protected-file policy.
    for (const glob of [
      ...(options.full ? [] : OPTIONAL_GLOBS),
      ...(options.globs ?? []),
      ...MANDATORY_GLOBS,
    ]) {
      this.baseArgs.push("--glob", glob);
    }
    for (const type of options.types ?? []) this.baseArgs.push("--type", type);
    for (const type of options.typesNot ?? []) this.baseArgs.push("--type-not", type);
    if (options.noIgnore) this.baseArgs.push("--no-ignore");
    if (options.hidden) this.baseArgs.push("--hidden");
    if (options.fixedStrings) this.baseArgs.push("--fixed-strings");
    if (options.caseMode === "ignore") this.baseArgs.push("--ignore-case");
    if (options.caseMode === "smart") this.baseArgs.push("--smart-case");
    if (options.multiline) this.baseArgs.push("--multiline");
    if (options.multilineDotall) this.baseArgs.push("--multiline-dotall");
    if (options.pcre2) this.baseArgs.push("--pcre2");
  }

  /** Absolute-then-relative args shared by every invocation. */
  private argsFor(options: string[]): string[] {
    return [...this.baseArgs, ...options, "--", this.root.searchPath];
  }

  /** Discovered files, NUL-separated from rg `--files -0` output. */
  async *files(): AsyncGenerator<Buffer> {
    for await (const line of this.lines(this.argsFor(["--files", "-0"]), 0x00)) {
      if (line.length > 0) {
        yield line;
      }
    }
  }

  /**
   * rg `--json` events for a pattern. The pattern is always passed as the
   * value of `-e`; the root follows `--`. A successful scan requires both a
   * native successful exit and the rg summary event.
   */
  async *events(pattern: Buffer, before = 0, after = 0): AsyncGenerator<RgEvent> {
    if (pattern.includes(0)) {
      throw new RgError(
        "invalid_pattern",
        "Check the search regular expression.",
      );
    }
    const args = this.argsFor([
      "--json",
      "--line-number",
      "--column",
      "-B",
      String(before),
      "-A",
      String(after),
      "-e",
      pattern.toString("utf-8"),
    ]);
    let summary = false;
    for await (const raw of this.lines(args, 0x0a)) {
      let event: unknown;
      try {
        event = JSON.parse(raw.toString("utf-8"));
      } catch {
        throw new RgError(
          "ripgrep_failed",
          "The search process returned an invalid event.",
        );
      }
      if (
        typeof event !== "object" ||
        event === null ||
        typeof (event as RgEvent).type !== "string"
      ) {
        throw new RgError(
          "ripgrep_failed",
          "The search process returned an invalid event.",
        );
      }
      const typed = event as RgEvent;
      summary = summary || typed.type === "summary";
      yield typed;
    }
    if (!summary) {
      throw new RgError(
        "ripgrep_failed",
        "The search process did not report scan completion.",
      );
    }
  }

  /**
   * Run rg, spooling stderr to a scratch file and yielding NUL-free stdout
   * lines. Verifies the exit code and surfaces a structured error carrying
   * the bounded diagnostic prefix on failure.
   */
  private async *lines(args: string[], separator: number): AsyncGenerator<Buffer> {
    if (this.interrupted) {
      throw new RgError(
        "ripgrep_failed",
        "Scan interrupted; no complete results are available.",
      );
    }
    let scratchDir: string | undefined;
    let stderrFd: number | undefined;
    let child: ChildProcess | undefined;
    const cleanup = () => {
      if (this.activeChild === child) {
        this.activeChild = undefined;
      }
      if (stderrFd !== undefined) {
        try {
          closeSync(stderrFd);
        } catch {
          // Already closed.
        }
      }
      if (scratchDir !== undefined) {
        rmSync(scratchDir, { recursive: true, force: true });
      }
    };
    try {
      scratchDir = makeScratchDir();
      stderrFd = openSync(join(scratchDir, "stderr"), "w");
      child = spawn(this.rgPath, args, {
        stdio: ["ignore", "pipe", stderrFd],
      });
      this.activeChild = child;
      if (child.stdout === null) {
        throw new RgError(
          "ripgrep_failed",
          "Could not start the search process.",
        );
      }
      let pending = Buffer.alloc(0);
      for await (const chunk of child.stdout) {
        pending = Buffer.concat([pending, chunk]);
        let start = 0;
        let index: number;
        while ((index = pending.indexOf(separator, start)) !== -1) {
          yield pending.subarray(start, index);
          start = index + 1;
        }
        pending = pending.subarray(start);
      }
      if (pending.length > 0) {
        throw new RgError(
          "ripgrep_failed",
          "The search process returned an incomplete record.",
        );
      }
      const { code, signal } = await exited(child);
      if (code !== 0 && code !== 1 && signal === null) {
        const detail = readDiagnostics(scratchDir);
        throw classifyFailure(detail);
      }
      if (signal !== null) {
        const message = this.interrupted
          ? "Scan interrupted; no complete results are available."
          : "The search could not complete; check stderr diagnostics and retry.";
        throw new RgError("ripgrep_failed", message, readDiagnostics(scratchDir));
      }
    } finally {
      // Early stream closure, malformed output, and CLI interruption all reap
      // the child. Forced termination is never a successful scan.
      if (child !== undefined && child.exitCode === null && child.signalCode === null) {
        reap(child);
      }
      cleanup();
    }
  }
}

function makeScratchDir(): string {
  const dir = join(tmpdir(), `codebase-search-rg-${process.pid}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readDiagnostics(scratchDir: string | undefined): Buffer {
  if (scratchDir === undefined) return Buffer.alloc(0);
  const path = join(scratchDir, "stderr");
  try {
    const fd = openSync(path, "r");
    const buf = Buffer.alloc(DIAGNOSTIC_LIMIT);
    const bytesRead = readSync(fd, buf, 0, DIAGNOSTIC_LIMIT, 0);
    closeSync(fd);
    return buf.subarray(0, bytesRead);
  } catch {
    return Buffer.alloc(0);
  }
}

function classifyFailure(detail: Buffer): RgError {
  const text = detail.toString("utf-8", 0, Math.min(detail.length, DIAGNOSTIC_LIMIT));
  const invalid = INVALID_PATTERN_MARKERS.some((marker) => text.includes(marker));
  if (invalid) {
    return new RgError(
      "invalid_pattern",
      "Check the search regular expression.",
      detail,
    );
  }
  if (
    text.includes("unrecognized flag") ||
    text.includes("unrecognized option") ||
    text.includes("unknown option") ||
    text.includes("PCRE2 is not available")
  ) {
    return new RgError(
      "unsupported_feature",
      "The requested ripgrep feature is unavailable.",
      detail,
    );
  }
  return new RgError(
    "ripgrep_failed",
    "The search could not complete; check stderr diagnostics and retry.",
    detail,
  );
}

function exited(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

/**
 * Reap a still-running child: SIGTERM, escalate to SIGKILL after one second.
 * A forced termination is never a successful scan; callers surface their own
 * structured error.
 */
export function reap(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill("SIGTERM");
  } catch {
    return;
  }
  const timer = setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      // Already gone.
    }
  }, 1000);
  timer.unref?.();
  child.once("close", () => clearTimeout(timer));
}
