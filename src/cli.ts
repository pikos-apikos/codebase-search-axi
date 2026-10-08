/**
 * The cli boundary: parse and validate command flags, resolve dispatch
 * through axi-sdk-js, and map errors/exit codes through the SDK's
 * structured error plumbing. Does not scan files or construct raw rg
 * arguments directly.
 *
 * Output uses SDK-owned TOON serialization by default; the explicit `--json`
 * flag selects the stable JSON envelope. The tool owns result schemas and
 * JSON serialization (the SDK renders strings verbatim).
 */
import {
  AxiError,
  installSessionStartHooks,
  runAxiCli,
  sessionStartHookStatus,
  uninstallSessionStartHooks,
  type AxiCliCommand,
  type AxiCliOptions,
} from "axi-sdk-js";
import { realpathSync } from "node:fs";
import { userInfo } from "node:os";
import { resolve } from "node:path";
import { RgBackend, reap, RgError, type RgOptions } from "./backend.js";
import { count, files, matches, metrics } from "./results.js";
import { loadPolicy, resolveRoot, type PolicyConfig, type ResolvedRoot } from "./policy.js";
import { rawArgvBytes } from "./argv.js";
import { VERSION } from "./version.js";

const DEFAULT_LIMIT = 50;
type SetupScope = "user" | "project";

function isPersonalHome(homeDir: string): boolean {
  if (homeDir === "~" || homeDir === "$HOME" || homeDir === "${HOME}") return true;
  const personalHome = userInfo().homedir;
  if (resolve(homeDir) === resolve(personalHome)) return true;
  try {
    return realpathSync(homeDir) === realpathSync(personalHome);
  } catch {
    return false;
  }
}

interface ParsedCommand {
  command: "files" | "search" | "context" | "metrics" | "count";
  patternBytes?: Buffer;
  root: ResolvedRoot;
  limit: number | null;
  full: boolean;
  json: boolean;
  before: number;
  after: number;
  rgOptions: RgOptions;
  countMatches: boolean;
  fields: string[];
  policy: PolicyConfig;
  scanMaxFiles?: number;
  scanMaxBytes?: number;
  maxTextBytes?: number;
  maxBytes?: number;
}

let outputJson = false;

function hasJsonSelector(args: string[]): boolean {
  let afterSeparator = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--") {
      afterSeparator = true;
    } else if (!afterSeparator && arg === "--json") {
      return true;
    } else if (
      !afterSeparator &&
      (arg === "--root" ||
        arg === "--max-results" ||
        arg === "--before" ||
        arg === "--after" ||
        arg === "--fields" ||
        arg === "--policy" ||
        arg === "--format" ||
        arg === "--scan-max-files" ||
        arg === "--scan-max-bytes" ||
        arg === "--max-text-bytes" ||
        arg === "--max-bytes" ||
        arg === "--type" ||
        arg === "--type-not" ||
        arg === "--glob")
    ) {
      i += 1;
    }
  }
  return false;
}

function usageError(message: string): AxiError {
  return new AxiError(message, "invalid_command", [
    "Run `codebase-search --help` to see the complete interface.",
  ]);
}

function requestError(message: string): AxiError {
  return new AxiError(message, "invalid_request");
}

/** Split the current argv (after the command) into string and byte forms. */
function splitArgs(args: string[]): { strings: string[]; bytes: Buffer[] } {
  const full = rawArgvBytes();
  // full aligns with process.argv: [node, script, command, arg1, ...].
  // The SDK passes the handler argv.slice(1) of process.argv.slice(2), i.e.
  // process.argv.slice(3), so args[i] aligns with full[i + 3].
  return {
    strings: args,
    bytes: args.map((_, i) => full[i + 3] ?? Buffer.from(args[i], "utf-8")),
  };
}

type CommandName = "files" | "search" | "context" | "metrics" | "count";

function parseCommand(command: CommandName, args: string[]): ParsedCommand {
  const { strings, bytes } = splitArgs(args);
  let rootRaw = Buffer.from(".", "utf-8");
  let maxResults: number | null = null;
  let maxResultsExplicit = false;
  let full = false;
  let json = false;
  let before = 2;
  let after = 2;
  const rgOptions: RgOptions = { types: [], typesNot: [], globs: [] };
  let countMatches = false;
  let fields: string[] = [];
  let policyPath: string | undefined;
  let format: "toon" | "json" | undefined;
  let scanMaxFiles: number | undefined;
  let scanMaxBytes: number | undefined;
  let maxTextBytes: number | undefined;
  let maxBytes: number | undefined;
  let pattern: Buffer | undefined;
  let afterSeparator = false;

  const parseBound = (value: string, flag: string): number => {
    if (!/^-?\d+$/.test(value)) {
      throw requestError(`${flag} must be an integer`);
    }
    return Number.parseInt(value, 10);
  };

  let i = 0;
  while (i < strings.length) {
    const arg = strings[i];
    if (afterSeparator) {
      if (pattern !== undefined) {
        throw usageError(`unexpected argument: ${arg}`);
      }
      pattern = bytes[i];
      i += 1;
      continue;
    }
    if (arg === "--") {
      afterSeparator = true;
      i += 1;
      continue;
    }
    if (arg === "--root") {
      if (i + 1 >= strings.length) throw usageError("--root requires a value");
      rootRaw = bytes[i + 1];
      i += 2;
    } else if (arg === "--max-results") {
      if (i + 1 >= strings.length) {
        throw usageError("--max-results requires a value");
      }
      maxResultsExplicit = true;
      maxResults = parseBound(strings[i + 1], "--max-results");
      i += 2;
    } else if (arg === "--full") {
      full = true;
      i += 1;
    } else if (arg === "--json") {
      json = true;
      i += 1;
    } else if (arg === "--fields") {
      if (i + 1 >= strings.length) throw usageError("--fields requires a value");
      fields = strings[i + 1].split(",").map((field) => field.trim()).filter(Boolean);
      if (fields.length === 0) throw usageError("--fields requires at least one field");
      i += 2;
    } else if (arg === "--policy") {
      if (i + 1 >= strings.length) throw usageError("--policy requires a value");
      policyPath = strings[i + 1];
      i += 2;
    } else if (arg === "--format") {
      if (i + 1 >= strings.length) throw usageError("--format requires a value");
      const value = strings[i + 1];
      if (value !== "toon" && value !== "json") throw usageError("--format must be toon or json");
      format = value;
      i += 2;
    } else if (["--scan-max-files", "--scan-max-bytes", "--max-text-bytes", "--max-bytes"].includes(arg)) {
      if (i + 1 >= strings.length) throw usageError(`${arg} requires a value`);
      const value = parseBound(strings[i + 1], arg);
      if (value < 1) throw requestError(`${arg} must be positive`);
      if (arg === "--scan-max-files") scanMaxFiles = value;
      else if (arg === "--scan-max-bytes") scanMaxBytes = value;
      else if (arg === "--max-text-bytes") maxTextBytes = value;
      else maxBytes = value;
      i += 2;
    } else if (arg === "--fixed-strings") {
      rgOptions.fixedStrings = true;
      i += 1;
    } else if (arg === "--case-sensitive" || arg === "--ignore-case" || arg === "--smart-case") {
      const mode = arg === "--case-sensitive" ? "sensitive" : arg === "--ignore-case" ? "ignore" : "smart";
      if (rgOptions.caseMode && rgOptions.caseMode !== mode) {
        throw usageError("conflicting case modes");
      }
      rgOptions.caseMode = mode;
      i += 1;
    } else if (arg === "--type" || arg === "--type-not" || arg === "--glob") {
      if (i + 1 >= strings.length) throw usageError(`${arg} requires a value`);
      const target = arg === "--type" ? rgOptions.types : arg === "--type-not" ? rgOptions.typesNot : rgOptions.globs;
      target?.push(strings[i + 1]);
      i += 2;
    } else if (arg === "--no-ignore") {
      rgOptions.noIgnore = true;
      i += 1;
    } else if (arg === "--hidden") {
      rgOptions.hidden = true;
      i += 1;
    } else if (arg === "--multiline") {
      rgOptions.multiline = true;
      i += 1;
    } else if (arg === "--multiline-dotall") {
      rgOptions.multiline = true;
      rgOptions.multilineDotall = true;
      i += 1;
    } else if (arg === "--pcre2") {
      rgOptions.pcre2 = true;
      i += 1;
    } else if (arg === "--count-matches" && command === "count") {
      countMatches = true;
      i += 1;
    } else if (arg === "--all") {
      throw usageError("--all was removed; use --full instead");
    } else if (arg === "--before" && command === "context") {
      if (i + 1 >= strings.length) throw usageError("--before requires a value");
      before = parseBound(strings[i + 1], "--before");
      i += 2;
    } else if (arg === "--after" && command === "context") {
      if (i + 1 >= strings.length) throw usageError("--after requires a value");
      after = parseBound(strings[i + 1], "--after");
      i += 2;
    } else if (arg.startsWith("-") && arg !== "-") {
      throw usageError(`unrecognized argument: ${arg}`);
    } else {
      if (pattern !== undefined || command === "files" || command === "metrics") {
        throw usageError(`unexpected argument: ${arg}`);
      }
      pattern = bytes[i];
      i += 1;
    }
  }

  if ((command === "search" || command === "context" || command === "count") && pattern === undefined) {
    throw usageError("the following arguments are required: pattern");
  }
  if (full && maxResultsExplicit) {
    throw usageError("--full conflicts with an explicit --max-results bound");
  }
  if (full && (scanMaxFiles !== undefined || scanMaxBytes !== undefined || maxTextBytes !== undefined || maxBytes !== undefined)) {
    throw usageError("--full conflicts with explicit scan or display bounds");
  }
  if (maxResults !== null && maxResults < 1) {
    throw requestError("--max-results must be positive");
  }
  if (command === "context" && (before < 0 || after < 0)) {
    throw requestError("context values must not be negative");
  }
  for (const field of fields) {
    if (!FIELD_NAMES[command].has(field)) throw usageError(`unknown field for ${command}: ${field}`);
    if (command === "metrics" && full && field.endsWith("_seen")) {
      throw usageError(`${field} is only available for bounded metrics`);
    }
  }

  const root = resolveRoot(rootRaw);
  const policy = policyPath ? loadPolicy(policyPath) : { optionalGlobs: [] };
  const effectiveMax = maxResults ?? policy.maxResults;
  const limit = full ? null : (effectiveMax ?? DEFAULT_LIMIT);
  if (policy.optionalGlobs.length > 0) rgOptions.globs?.push(...policy.optionalGlobs);
  const parsed: ParsedCommand = {
    command,
    root,
    limit,
    full,
    json: format === "json" || json,
    rgOptions,
    countMatches,
    fields,
    policy,
    scanMaxFiles: scanMaxFiles ?? policy.scanMaxFiles,
    scanMaxBytes: scanMaxBytes ?? policy.scanMaxBytes,
    maxTextBytes: maxTextBytes ?? policy.maxTextBytes,
    maxBytes: maxBytes ?? policy.maxBytes,
    before: command === "context" ? before : 0,
    after: command === "context" ? after : 0,
  };
  if (pattern !== undefined) {
    parsed.patternBytes = pattern;
  }
  return parsed;
}

/** Tool error codes that are usage errors (exit 2) vs scan failures (exit 1). */
const USAGE_ERROR_CODES: ReadonlySet<string> = new Set([
  "invalid_command",
  "invalid_request",
  "VALIDATION_ERROR",
]);

function formatJsonError(error: unknown): { output: string; exitCode: number } {
  const axi =
    error instanceof AxiError
      ? error
      : error instanceof RgError
        ? new AxiError(error.message, error.code)
        : new AxiError(
            error instanceof Error ? error.message : String(error),
            "internal_error",
          );
  // Forward backend diagnostics verbatim; nothing else may reach stderr.
  if (error instanceof RgError && error.diagnostics && error.diagnostics.length > 0) {
    process.stderr.write(error.diagnostics);
  }
  const exitCode = USAGE_ERROR_CODES.has(axi.code) ? 2 : 1;
  const record: Record<string, unknown> = { status: "error", error: axi.code, message: axi.message };
  return {
    output: `${JSON.stringify(record)}\n`,
    exitCode,
  };
}

const HELP = [
  "codebase-search — bounded, read-only codebase discovery and search.",
  "Defaults exclude generated and sensitive paths.",
  "",
  "Subcommands:",
  "  setup     install, inspect, or remove opt-in agent hooks",
  "  files     discover files",
  "  search    search file contents",
  "  context   search with surrounding lines",
  "  count     count matching lines or occurrences",
  "  metrics   count bounded files, bytes, and lines",
  "",
  "Common flags: --root PATH, --policy PATH, --max-results N, --scan-max-files N, --scan-max-bytes N, --max-text-bytes N, --max-bytes N, --full, --json, --format toon|json, --fields FIELD[,FIELD...]",
  "Metrics fields: files, bytes, lines (bounded mode also accepts files_seen, bytes_seen, lines_seen)",
  "Matching flags: --fixed-strings, --case-sensitive, --ignore-case, --smart-case, --type TYPE, --type-not TYPE, --glob GLOB, --multiline, --multiline-dotall, --pcre2",
  "context flags: --before N, --after N",
  "count flags: --count-matches",
].join("\n");

const COMMAND_SUMMARIES: Record<string, string> = {
  files: "discover files",
  search: "search file contents",
  context: "search with surrounding lines",
  count: "count matching lines or occurrences",
  metrics: "count bounded files, bytes, and lines",
};

function commandHelp(command: string): string {
  const lines: string[] = [`codebase-search ${command} — ${COMMAND_SUMMARIES[command] ?? ""}`];
  if (command === "setup") {
    lines.push("Usage: codebase-search setup hooks <install|status|uninstall> [--scope user|project] [--home PATH] [--project-dir PATH]");
    lines.push("Flags: --scope user|project, --home PATH, --project-dir PATH (isolated --home is required)");
    return lines.join("\n");
  }
  if (command === "search" || command === "context" || command === "count") {
    lines.push(`Usage: codebase-search ${command} PATTERN [flags] [-- PATTERN]`);
  } else {
    lines.push(`Usage: codebase-search ${command} [flags]`);
  }
  lines.push(
    "",
    "Flags: --root PATH (default: .), --policy PATH, --max-results N (default: 50), --scan-max-files N, --scan-max-bytes N, --max-text-bytes N, --max-bytes N, --full, --json, --format toon|json, --fields FIELD[,FIELD...]",
  );
  if (command === "metrics") {
    lines.push("Metrics fields: files, bytes, lines (bounded mode also accepts files_seen, bytes_seen, lines_seen)");
  }
  if (command === "search" || command === "context" || command === "count") {
    lines.push("Matching flags: --fixed-strings, --case-sensitive, --ignore-case, --smart-case, --type TYPE, --type-not TYPE, --glob GLOB, --multiline, --multiline-dotall, --pcre2");
  }
  if (command === "context") {
    lines.push("Context flags: --before N (default: 2), --after N (default: 2)");
  }
  if (command === "count") lines.push("Count flags: --count-matches");
  return lines.join("\n");
}

function setupCommand(args: string[]): Record<string, unknown> | string {
  if (args.length === 0 || args[0] === "--help") {
    throw usageError("setup requires hooks install, status, or uninstall");
  }
  if (args[0] !== "hooks" || !args[1]) throw usageError("use `setup hooks <install|status|uninstall>`");
  const action = args[1];
  if (!["install", "status", "uninstall"].includes(action)) throw usageError("unknown hooks action");
  let scope: SetupScope = "user";
  let homeDir: string | undefined;
  let projectDir: string | undefined;
  let json = false;
  for (let i = 2; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--scope" || arg === "--home" || arg === "--project-dir") {
      if (i + 1 >= args.length) throw usageError(`${arg} requires a value`);
      const value = args[++i];
      if (arg === "--scope") {
        if (value !== "user" && value !== "project") throw usageError("--scope must be user or project");
        scope = value;
      } else if (arg === "--home") homeDir = value;
      else projectDir = value;
    } else throw usageError(`unrecognized argument: ${arg}`);
  }
  if (!homeDir) throw usageError("--home PATH is required for setup hooks");
  if (isPersonalHome(homeDir)) throw usageError("--home must be an isolated home");
  const hookErrors: string[] = [];
  const options = { scope, homeDir, ...(projectDir ? { projectDir } : {}), onError: (message: string) => hookErrors.push(message) };
  let record: Record<string, unknown>;
  if (action === "install") {
    installSessionStartHooks(options);
    record = { status: "ok", command: "setup", action, hooks: sessionStartHookStatus(options) };
  } else if (action === "uninstall") {
    uninstallSessionStartHooks(options);
    record = { status: "ok", command: "setup", action, hooks: sessionStartHookStatus(options) };
  } else {
    record = { status: "ok", command: "setup", action, hooks: sessionStartHookStatus(options) };
  }
  if (hookErrors.length > 0) {
    throw new AxiError(`setup hooks ${action} failed: ${hookErrors.join("; ")}`, "hook_setup_failed");
  }
  return json ? JSON.stringify(record) : record;
}

const FIELD_NAMES: Record<CommandName, ReadonlySet<string>> = {
  files: new Set(["path"]),
  search: new Set(["path", "line", "column", "text", "submatches", "end_line", "end_column"]),
  context: new Set(["path", "line", "column", "text", "submatches", "before", "after", "end_line", "end_column"]),
  count: new Set(["path", "count"]),
  metrics: new Set(["files", "bytes", "lines", "files_seen", "bytes_seen", "lines_seen"]),
};

function valueBytes(value: unknown): Buffer | undefined {
  if (typeof value === "string") return Buffer.from(value, "utf8");
  if (value && typeof value === "object" && typeof (value as { bytes?: unknown }).bytes === "string") {
    return Buffer.from((value as { bytes: string }).bytes, "base64");
  }
  return undefined;
}

function encodeValue(bytes: Buffer): string | { bytes: string } {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { bytes: bytes.toString("base64") };
  }
}

function applyTextBound(record: Record<string, unknown>, maxTextBytes: number | undefined): void {
  if (maxTextBytes === undefined) return;
  const collection = record.matches;
  if (!Array.isArray(collection)) return;
  for (const item of collection) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const fields: string[] = ["text"];
    if (Array.isArray(entry.before)) fields.push("before");
    if (Array.isArray(entry.after)) fields.push("after");
    let used = 0;
    let originalBytes = 0;
    let truncated = false;
    const trim = (value: unknown): unknown => {
      const bytes = valueBytes(value);
      if (!bytes) return value;
      const remaining = Math.max(0, maxTextBytes - used);
      const kept = bytes.subarray(0, remaining);
      used += bytes.length;
      originalBytes += bytes.length;
      if (kept.length !== bytes.length) truncated = true;
      return encodeValue(kept);
    };
    for (const field of fields) {
      const value = entry[field];
      if (Array.isArray(value)) entry[field] = value.map(trim);
      else if (value !== undefined) entry[field] = trim(value);
    }
    if (Array.isArray(entry.submatches)) {
      entry.submatches = entry.submatches.map((sub) => {
        if (!sub || typeof sub !== "object") return sub;
        const copy = { ...(sub as Record<string, unknown>) };
        if (copy.match !== undefined) copy.match = trim(copy.match);
        return copy;
      });
    }
    entry.text_bytes = originalBytes;
    if (truncated) entry.text_truncated = true;
  }
}

function applyOutputBound(record: Record<string, unknown>, maxBytes: number | undefined): void {
  if (maxBytes === undefined) return;
  const collectionKey = ["files", "matches", "counts"].find((key) => Array.isArray(record[key]));
  if (!collectionKey) return;
  const collection = record[collectionKey] as unknown[];
  while (collection.length > 0 && Buffer.byteLength(JSON.stringify(record) + "\n", "utf8") > maxBytes) {
    collection.pop();
    record.returned = collection.length;
    if ("count" in record) record.count = collection.length;
    const complete = record.complete;
    if (complete && typeof complete === "object") (complete as Record<string, unknown>).display = false;
  }
  if (Buffer.byteLength(JSON.stringify(record) + "\n", "utf8") > maxBytes) {
    const complete = record.complete;
    if (complete && typeof complete === "object") (complete as Record<string, unknown>).display = false;
  }
}

function projectFields(command: CommandName, record: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  if (fields.length === 0) return record;
  for (const field of fields) {
    if (!FIELD_NAMES[command].has(field)) throw usageError(`unknown field for ${command}: ${field}`);
  }
  const projected = { ...record };
  const collection = command === "files" ? "files" : command === "count" ? "counts" : command === "search" || command === "context" ? "matches" : undefined;
  if (collection === "files" && Array.isArray(record[collection])) {
    projected[collection] = [...(record[collection] as unknown[])];
    return projected;
  }
  if (collection && Array.isArray(record[collection])) {
    projected[collection] = (record[collection] as Array<Record<string, unknown>>).map((item) =>
      Object.fromEntries(fields.filter((field) => field in item).map((field) => [field, item[field]])),
    );
    return projected;
  }
  const projectedFields =
    command === "metrics" && record.bounded === true
      ? fields.map((field) => field.endsWith("_seen") ? field : `${field}_seen`)
      : fields;
  for (const key of Object.keys(record)) {
    if (!projectedFields.includes(key) && !["status", "command", "bounded", "complete", "count", "returned", "total", "matched_files", "help"].includes(key)) {
      delete projected[key];
    }
  }
  return projected;
}

function execute(
  parsed: ParsedCommand,
  backend: RgBackend,
): Promise<Record<string, unknown>> {
  const scan = { maxFiles: parsed.scanMaxFiles, maxBytes: parsed.scanMaxBytes };
  switch (parsed.command) {
    case "files":
      return files(backend, parsed.root, parsed.limit, scan);
    case "search":
    case "context":
      return matches(
        backend,
        parsed.root,
        parsed.command,
        parsed.patternBytes ?? Buffer.alloc(0),
        parsed.limit,
        parsed.before,
        parsed.after,
        scan,
      );
    case "count":
      return count(
        backend,
        parsed.root,
        parsed.patternBytes ?? Buffer.alloc(0),
        parsed.limit,
        parsed.countMatches,
        scan,
      );
    case "metrics":
      return metrics(backend, parsed.root, parsed.limit, scan);
  }
}

/**
 * Entry point used by bin/codebase-search after the version fast path.
 * Dispatch, help, and version handling come from axi-sdk-js; command
 * validation, byte-faithful argument values, and the JSON envelope are
 * owned by this tool.
 */
export async function main(): Promise<void> {
  let interrupted = false;
  let backend: RgBackend | undefined;
  const handler = () => {
    interrupted = true;
    if (backend) {
      backend.interrupted = true;
      if (backend.activeChild) {
        reap(backend.activeChild);
      }
    }
  };
  process.once("SIGINT", handler);
  process.once("SIGTERM", handler);

  const buildCommand =
    (command: CommandName): AxiCliCommand<undefined> =>
    async (args: string[]) => {
      if (interrupted) {
        throw new RgError(
          "ripgrep_failed",
          "Scan interrupted; no complete results are available.",
        );
      }
      const parsed = parseCommand(command, args);
      const temp = new RgBackend(parsed.root, { ...parsed.rgOptions, full: parsed.full });
      backend = temp;
      try {
        const record = await execute(parsed, temp);
        if (interrupted || temp.interrupted) {
          throw new RgError(
            "ripgrep_failed",
            "Scan interrupted; no complete results are available.",
          );
        }
        const projected = projectFields(parsed.command, record, parsed.fields);
        applyTextBound(projected, parsed.maxTextBytes);
        applyOutputBound(projected, parsed.maxBytes);
        return parsed.json ? JSON.stringify(projected) : projected;
      } finally {
        parsed.root.cleanup();
        if (backend === temp) {
          backend = undefined;
        }
      }
    };

  const commands: Record<string, AxiCliCommand<undefined>> = {
    setup: async (args: string[]) => setupCommand(args),
    files: buildCommand("files"),
    search: buildCommand("search"),
    context: buildCommand("context"),
    count: buildCommand("count"),
    metrics: buildCommand("metrics"),
  };

  const argv = process.argv.slice(2);
  outputJson = hasJsonSelector(argv.slice(1));

  const options: AxiCliOptions = {
    description: "Bounded, read-only codebase discovery and search.",
    version: VERSION,
    topLevelHelp: HELP,
    getCommandHelp: (command: string) =>
      command in commands ? commandHelp(command) : undefined,
    home: async () => ({
      orientation: "bounded, read-only ripgrep discovery under mandatory exclusions",
      commands: ["files", "search", "context", "count", "metrics"],
      help: [
        "Run `codebase-search --help` for commands.",
        "Use --full only when an unbounded scan is intended.",
      ],
    }),
    commands,
  };
  if (outputJson) {
    options.renderUnknownCommand = (command: string) =>
      `${JSON.stringify({
        status: "error",
        error: "invalid_command",
        message: `Unknown command: ${command}`,
      })}\n`;
    options.formatError = formatJsonError;
  }
  try {
    await runAxiCli(options);
  } finally {
    process.removeListener("SIGINT", handler);
    process.removeListener("SIGTERM", handler);
  }
}
