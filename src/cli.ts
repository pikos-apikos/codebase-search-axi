/**
 * The cli boundary: parse and validate command flags, resolve dispatch
 * through axi-sdk-js, and map errors/exit codes through the SDK's
 * structured error plumbing. Does not scan files or construct raw rg
 * arguments directly.
 *
 * Output is the stable compact JSON envelope selected by the explicit
 * `--json` flag; the tool owns result schemas and JSON serialization (the SDK
 * renders strings verbatim).
 */
import {
  AxiError,
  runAxiCli,
  type AxiCliCommand,
  type AxiCliOptions,
} from "axi-sdk-js";
import { RgBackend, reap, RgError } from "./backend.js";
import { files, matches, metrics } from "./results.js";
import { resolveRoot, type ResolvedRoot } from "./policy.js";
import { rawArgvBytes } from "./argv.js";
import { VERSION } from "./version.js";

const DEFAULT_LIMIT = 50;

interface ParsedCommand {
  command: "files" | "search" | "context" | "metrics";
  patternBytes?: Buffer;
  root: ResolvedRoot;
  limit: number | null;
  before: number;
  after: number;
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

type CommandName = "files" | "search" | "context" | "metrics";

function parseCommand(command: CommandName, args: string[]): ParsedCommand {
  const { strings, bytes } = splitArgs(args);
  let rootRaw = Buffer.from(".", "utf-8");
  let maxResults: number | null = null;
  let maxResultsExplicit = false;
  let full = false;
  let before = 2;
  let after = 2;
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

  if ((command === "search" || command === "context") && pattern === undefined) {
    throw usageError("the following arguments are required: pattern");
  }
  if (full && maxResultsExplicit) {
    throw usageError("--full conflicts with an explicit --max-results bound");
  }
  if (maxResults !== null && maxResults < 1) {
    throw requestError("--max-results must be positive");
  }
  if (command === "context" && (before < 0 || after < 0)) {
    throw requestError("context values must not be negative");
  }

  const root = resolveRoot(rootRaw);
  const limit = full ? null : (maxResults ?? DEFAULT_LIMIT);
  const parsed: ParsedCommand = {
    command,
    root,
    limit,
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

function formatError(error: unknown): { output: string; exitCode: number } {
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
  return { output: `${JSON.stringify(record)}\n`, exitCode };
}

const HELP = [
  "codebase-search — bounded, read-only codebase discovery and search.",
  "Defaults exclude generated and sensitive paths.",
  "",
  "Subcommands:",
  "  files     discover files",
  "  search    search file contents",
  "  context   search with surrounding lines",
  "  metrics   count bounded files, bytes, and lines",
  "",
  "Common flags: --root PATH, --max-results N, --full, --json",
  "context flags: --before N, --after N",
].join("\n");

const COMMAND_SUMMARIES: Record<string, string> = {
  files: "discover files",
  search: "search file contents",
  context: "search with surrounding lines",
  metrics: "count bounded files, bytes, and lines",
};

function commandHelp(command: string): string {
  const lines: string[] = [`codebase-search ${command} — ${COMMAND_SUMMARIES[command] ?? ""}`];
  if (command === "search" || command === "context") {
    lines.push(`Usage: codebase-search ${command} PATTERN [flags] [-- PATTERN]`);
  } else {
    lines.push(`Usage: codebase-search ${command} [flags]`);
  }
  lines.push(
    "",
    "Flags: --root PATH (default: .), --max-results N (default: 50), --full, --json",
  );
  if (command === "context") {
    lines.push("Context flags: --before N (default: 2), --after N (default: 2)");
  }
  return lines.join("\n");
}

function execute(
  parsed: ParsedCommand,
  backend: RgBackend,
): Promise<Record<string, unknown>> {
  switch (parsed.command) {
    case "files":
      return files(backend, parsed.root, parsed.limit);
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
      );
    case "metrics":
      return metrics(backend, parsed.root, parsed.limit);
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
      const temp = new RgBackend(parsed.root);
      backend = temp;
      try {
        const record = await execute(parsed, temp);
        return JSON.stringify(record);
      } finally {
        parsed.root.cleanup();
        if (backend === temp) {
          backend = undefined;
        }
      }
    };

  const commands: Record<string, AxiCliCommand<undefined>> = {
    files: buildCommand("files"),
    search: buildCommand("search"),
    context: buildCommand("context"),
    metrics: buildCommand("metrics"),
  };

  // Preserve the tool's JSON error contract for a flag in command position
  // (the SDK's built-in rendering for that case is not the tool envelope).
  // Bare --help and version flags are handled by the SDK itself.
  const argv = process.argv.slice(2);
  const sdkOwned =
    argv.length === 1 &&
    (argv[0] === "--help" || argv[0] === "-v" || argv[0] === "-V" || argv[0] === "--version");
  if (argv[0]?.startsWith("-") && !sdkOwned) {
    process.stdout.write(
      `${JSON.stringify({
        status: "error",
        error: "invalid_command",
        message: `Flags must come after the command: ${argv[0]}`,
      })}\n`,
    );
    process.exitCode = 2;
    return;
  }

  const options: AxiCliOptions = {
    description: "Bounded, read-only codebase discovery and search.",
    version: VERSION,
    topLevelHelp: HELP,
    getCommandHelp: (command: string) =>
      command in commands ? commandHelp(command) : undefined,
    renderUnknownCommand: (command: string) =>
      `${JSON.stringify({
        status: "error",
        error: "invalid_command",
        message: `Unknown command: ${command}`,
      })}\n`,
    formatError,
    home: async () => {
      throw new AxiError(
        "A subcommand is required.",
        "invalid_command",
        ["Run `codebase-search --help` to see available commands."],
      );
    },
    commands,
  };
  try {
    await runAxiCli(options);
  } finally {
    process.removeListener("SIGINT", handler);
    process.removeListener("SIGTERM", handler);
  }
}
