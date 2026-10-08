import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
  existsSync,
  unlinkSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const BIN = resolve(import.meta.dirname, "../bin/codebase-search");
const NODE = process.execPath;
const ORIGINAL_PATH = process.env.PATH ?? "";

function makeRoot() {
  return mkdtempSync(join(tmpdir(), "codebase-search-"));
}

/** Run the CLI, returning { code, stdout, stderr, data }. */
function runCli(args, { env, root, json = true } = {}) {
  const sdkOnly = ["--help", "-v", "-V", "--version"].includes(args[0]);
  args = json && !sdkOnly && !args.includes("--json") ? [...args, "--json"] : args;
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(NODE, [BIN, ...args], {
      env: env ?? process.env,
      cwd: root ?? process.cwd(),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", rejectPromise);
    child.on("close", (code) =>
      resolvePromise({
        code,
        stdout,
        stderr,
        data: stdout.trimStart().startsWith("{") ? JSON.parse(stdout) : undefined,
      }),
    );
  });
}

function directRg(root, pattern) {
  const out = execFileSync(
    "rg",
    ["--no-config", "--json", "--line-number", "--column", "-e", pattern, "--", root],
    { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return out;
}

function write(root, rel, content) {
  const p = join(root, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  if (Buffer.isBuffer(content)) {
    writeFileSync(p, content);
  } else {
    writeFileSync(p, content, "utf-8");
  }
}

// ---------------------------------------------------------------------------
// Public CLI contract (ported from tests/codebase-search.test.sh).
// ---------------------------------------------------------------------------

test("help lists all subcommands", async () => {
  const { stdout, code } = await runCli(["--help"]);
  assert.equal(code, 0);
  for (const cmd of ["files", "search", "context", "count", "metrics"]) {
    assert.ok(stdout.includes(cmd), `help missing ${cmd}`);
  }
});

test("bare invocation returns compact orientation without scanning", async () => {
  const { stdout, code } = await runCli([], { json: false });
  assert.equal(code, 0);
  assert.match(stdout, /orientation:/);
  assert.match(stdout, /files/);
});

test("unknown command is a structured invalid_command error", async () => {
  const { data, code } = await runCli(["unknown"]);
  assert.equal(data.status, "error");
  assert.equal(data.error, "invalid_command");
  assert.equal(code, 2);
});

test("missing rg is a structured ripgrep_unavailable error", async () => {
  const root = makeRoot();
  try {
    const noTools = join(root, "no-tools");
    mkdirSync(noTools);
    const { data, code } = await runCli(["files", "--root", root], {
      env: { ...process.env, PATH: noTools },
    });
    assert.equal(data.status, "error");
    assert.equal(data.error, "ripgrep_unavailable");
    assert.equal(code, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("bounded search reports one match with correct path/line", async () => {
  const root = makeRoot();
  try {
    write(root, "src/app.txt", "needle one\nneedle two\nother\n");
    const { data, code } = await runCli([
      "search",
      "needle",
      "--root",
      root,
      "--max-results",
      "1",
    ]);
    assert.equal(code, 0);
    assert.equal(data.status, "ok");
    assert.equal(data.bounded, true);
    assert.equal(data.matches.length, 1);
    assert.equal(data.matches[0].path, "src/app.txt");
    assert.equal(data.matches[0].line, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("empty search is successful and complete", async () => {
  const root = makeRoot();
  try {
    write(root, "a.txt", "x\n");
    const { data, code } = await runCli(["search", "absent", "--root", root]);
    assert.equal(code, 0);
    assert.equal(data.status, "ok");
    assert.deepEqual(data.matches, []);
    assert.equal(data.count, 0);
    assert.equal(data.returned, 0);
    assert.equal(data.total, 0);
    assert.deepEqual(data.complete, { scan: true, display: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing root is a structured invalid_root error", async () => {
  const root = makeRoot();
  try {
    const { data, code } = await runCli([
      "search",
      "needle",
      "--root",
      join(root, "missing"),
    ]);
    assert.notEqual(code, 0);
    assert.equal(data.status, "error");
    assert.equal(data.error, "invalid_root");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("mandatory denied roots are rejected across commands", async () => {
  const root = makeRoot();
  try {
    write(root, ".git/objects/pack.txt", "needle\n");
    write(root, "allowed/pack.txt", "needle\n");
    for (const command of ["files", "search", "context", "metrics"]) {
      const args = command === "files" || command === "metrics"
        ? [command, "--root", join(root, ".git/objects"), "--full"]
        : [command, "needle", "--root", join(root, ".git/objects"), "--full"];
      const denied = await runCli(args);
      assert.equal(denied.code, 1, command);
      assert.equal(denied.data.error, "invalid_root", command);
    }
    const allowed = await runCli(["files", "--root", join(root, "allowed"), "--full"]);
    assert.equal(allowed.code, 0);
    assert.deepEqual(allowed.data.files, ["pack.txt"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("policy matrix covers symlink roots across every command", async () => {
  const root = makeRoot();
  try {
    write(root, ".git/objects/pack.txt", "needle\n");
    write(root, "allowed/pack.txt", "needle\n");
    symlinkSync(join(root, "allowed"), join(root, "allowed-link"));
    symlinkSync(join(root, ".git", "objects"), join(root, "git-link"));

    for (const command of ["files", "search", "context", "metrics"]) {
      const allowedArgs =
        command === "files" || command === "metrics"
          ? [command, "--root", join(root, "allowed-link"), "--full", "--json"]
          : [command, "needle", "--root", join(root, "allowed-link"), "--full", "--json"];
      const allowed = await runCli(allowedArgs);
      assert.equal(allowed.code, 0, command);
      const allowedValues =
        command === "files"
          ? allowed.data.files
          : command === "metrics"
            ? [allowed.data.files, allowed.data.files_seen]
            : allowed.data.matches.map((item) => item.path);
      assert.ok(allowedValues.flat().includes(command === "metrics" ? 1 : "pack.txt"), command);

      const deniedArgs =
        command === "files" || command === "metrics"
          ? [command, "--root", join(root, "git-link"), "--full", "--json"]
          : [command, "needle", "--root", join(root, "git-link"), "--full", "--json"];
      const denied = await runCli(deniedArgs);
      assert.equal(denied.code, 1, command);
      assert.equal(denied.data.error, "invalid_root", command);

      const allArgs =
        command === "files" || command === "metrics"
          ? [command, "--root", root, "--all", "--json"]
          : [command, "needle", "--root", root, "--all", "--json"];
      const removedAll = await runCli(allArgs);
      assert.equal(removedAll.code, 2, `${command}: --all`);
      assert.equal(removedAll.data.error, "invalid_command", `${command}: --all`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--full includes optional paths but denies sensitive paths", async () => {
  const root = makeRoot();
  try {
    write(root, "src/app.txt", "needle one\nneedle two\nother\n");
    write(root, "node_modules/dependency.txt", "needle vendor\n");
    write(root, "build/generated.txt", "needle build\n");
    write(root, ".env.local", "password=needle\n");
    write(root, "signing.pem", "-----BEGIN PRIVATE KEY-----\nneedle\n");
    const { data, code } = await runCli(["search", "needle", "--root", root, "--full"]);
    assert.equal(code, 0);
    const paths = new Set(data.matches.map((m) => m.path));
    assert.ok(paths.has("src/app.txt"));
    assert.ok(paths.has("node_modules/dependency.txt"));
    assert.ok(paths.has("build/generated.txt"));
    assert.ok(!paths.has(".env.local"));
    assert.ok(!paths.has("signing.pem"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--json selects the stable JSON interface", async () => {
  const root = makeRoot();
  try {
    write(root, "src/app.txt", "needle\n");
    const { data, code } = await runCli(["search", "needle", "--root", root, "--json"]);
    assert.equal(code, 0);
    assert.equal(data.status, "ok");
    assert.equal(data.matches[0].path, "src/app.txt");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("TOON is the default output format", async () => {
  const root = makeRoot();
  try {
    write(root, "src/app.txt", "needle\n");
    const { stdout, code } = await runCli(["search", "needle", "--root", root], { json: false });
    assert.equal(code, 0);
    assert.match(stdout, /^status:/);
    assert.ok(!stdout.trimStart().startsWith("{"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--all is rejected with a migration hint", async () => {
  const root = makeRoot();
  try {
    const { data, code } = await runCli(["files", "--root", root, "--all"]);
    assert.equal(code, 2);
    assert.equal(data.status, "error");
    assert.equal(data.error, "invalid_command");
    assert.match(data.message, /--all.*--full/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--json after the pattern separator remains a pattern value", async () => {
  const root = makeRoot();
  try {
    const { stdout, code } = await runCli(
      ["search", "--root", join(root, "missing"), "--", "--json"],
      { json: false },
    );
    assert.equal(code, 1);
    assert.match(stdout, /^error:/);
    assert.ok(!stdout.trimStart().startsWith("{"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("context reports before/after arrays", async () => {
  const root = makeRoot();
  try {
    write(root, "src/app.txt", "needle one\nneedle two\nother\n");
    const { data, code } = await runCli([
      "context",
      "needle",
      "--root",
      root,
      "--before",
      "1",
      "--after",
      "1",
    ]);
    assert.equal(code, 0);
    assert.equal(data.status, "ok");
    assert.deepEqual(data.matches[0].before, []);
    assert.deepEqual(data.matches[0].after, ["needle two\n"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("count reports per-file and aggregate matching-line units", async () => {
  const root = makeRoot();
  try {
    write(root, "src/app.txt", "needle needle\nneedle\n");
    write(root, "src/other.txt", "needle\n");
    const { data, code } = await runCli(["count", "needle", "--root", root, "--full"]);
    assert.equal(code, 0);
    assert.equal(data.status, "ok");
    assert.deepEqual(data.counts, [
      { path: "src/app.txt", count: 2 },
      { path: "src/other.txt", count: 1 },
    ]);
    assert.equal(data.total, 3);
    assert.equal(data.matched_files, 2);
    assert.deepEqual(data.complete, { scan: true, display: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("count-matches reports per-occurrence counts", async () => {
  const root = makeRoot();
  try {
    write(root, "src/app.txt", "needle needle\nneedle\n");
    const { data, code } = await runCli([
      "count",
      "needle",
      "--root",
      root,
      "--full",
      "--count-matches",
    ]);
    assert.equal(code, 0);
    assert.deepEqual(data.counts, [{ path: "src/app.txt", count: 3 }]);
    assert.equal(data.total, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("search supports literal case and type/glob filters", async () => {
  const root = makeRoot();
  try {
    write(root, "src/App.TS", "Needle [literal]\n");
    write(root, "src/app.js", "Needle [literal]\n");
    write(root, "src/other.txt", "needle [literal]\n");
    const { data, code } = await runCli([
      "search",
      "Needle [literal]",
      "--root",
      root,
      "--full",
      "--fixed-strings",
      "--ignore-case",
      "--glob",
      "*.TS",
    ]);
    assert.equal(code, 0);
    assert.deepEqual(data.matches.map((item) => item.path), ["src/App.TS"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fields project result records while preserving envelope completeness", async () => {
  const root = makeRoot();
  try {
    write(root, "src/app.txt", "needle\n");
    const { data, code } = await runCli([
      "search",
      "needle",
      "--root",
      root,
      "--full",
      "--fields",
      "path,line",
    ]);
    assert.equal(code, 0);
    assert.deepEqual(data.matches, [{ path: "src/app.txt", line: 1 }]);
    assert.deepEqual(data.complete, { scan: true, display: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("files supports type exclusions and native ignore controls", async () => {
  const root = makeRoot();
  try {
    write(root, ".ignore", "ignored.txt\n");
    write(root, "ignored.txt", "needle\n");
    write(root, ".hidden.txt", "needle\n");
    write(root, "visible.js", "needle\n");
    const { data, code } = await runCli([
      "files",
      "--root",
      root,
      "--full",
      "--json",
      "--no-ignore",
      "--hidden",
      "--glob",
      "*.txt",
      "--type-not",
      "js",
    ]);
    assert.equal(code, 0);
    assert.deepEqual([...data.files].sort(), [".hidden.txt", "ignored.txt"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("search supports multiline matching", async () => {
  const root = makeRoot();
  try {
    write(root, "src/app.txt", "first\nsecond\n");
    const { data, code } = await runCli([
      "search",
      "first\\nsecond",
      "--root",
      root,
      "--full",
      "--multiline",
    ]);
    assert.equal(code, 0);
    assert.equal(data.count, 1);
    assert.equal(data.matches[0].line, 1);
    assert.equal(data.matches[0].end_line, 2);
    assert.equal(data.matches[0].end_column, 7);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("context uses multiline match boundary for trailing lines", async () => {
  const root = makeRoot();
  try {
    write(root, "src/app.txt", "before\nfirst\nsecond\nafter\n");
    const { data, code } = await runCli([
      "context",
      "first\\nsecond",
      "--root",
      root,
      "--full",
      "--multiline",
      "--before",
      "1",
      "--after",
      "1",
    ]);
    assert.equal(code, 0);
    assert.deepEqual(data.matches[0].before, ["before\n"]);
    assert.deepEqual(data.matches[0].after, ["after\n"]);
    assert.equal(data.matches[0].end_line, 3);
    assert.equal(data.matches[0].end_column, 7);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pcre2 reports unsupported capability when rg rejects it", async () => {
  const root = makeRoot();
  try {
    write(root, "src/app.txt", "needle\n");
    const tools = join(root, "tools");
    mkdirSync(tools);
    const fake = join(tools, "rg");
    writeFileSync(
      fake,
      "#!/usr/bin/env node\nprocess.stderr.write('rg: unrecognized flag --pcre2\\n'); process.exit(2);\n",
    );
    chmodSync(fake, 0o755);
    const { data, code } = await runCli(["search", "needle", "--root", root, "--pcre2"], {
      env: { ...process.env, PATH: `${tools}:${ORIGINAL_PATH}` },
    });
    assert.equal(code, 1);
    assert.equal(data.error, "unsupported_feature");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("files discovers allowed and excludes generated paths", async () => {
  const root = makeRoot();
  try {
    write(root, "src/app.txt", "x\n");
    write(root, "node_modules/dependency.txt", "x\n");
    const { data, code } = await runCli(["files", "--root", root]);
    assert.equal(code, 0);
    assert.equal(data.status, "ok");
    assert.ok(data.files.includes("src/app.txt"));
    assert.ok(!data.files.includes("node_modules/dependency.txt"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("bounded metrics reports observations, not totals", async () => {
  const root = makeRoot();
  try {
    write(root, "a.txt", "x\n");
    const { data, code } = await runCli(["metrics", "--root", root]);
    assert.equal(code, 0);
    assert.equal(data.status, "ok");
    assert.ok(data.files_seen >= 1);
    assert.ok(data.bytes_seen > 0);
    assert.ok(data.lines_seen >= 1);
    assert.equal(data.complete.scan, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("metrics fields preserve aliases across bounded and full JSON/TOON output", async () => {
  const root = makeRoot();
  try {
    write(root, "a.txt", "x\ny\n");
    const boundedJson = await runCli([
      "metrics",
      "--root",
      root,
      "--fields",
      "files,bytes,lines",
      "--json",
    ]);
    assert.equal(boundedJson.code, 0);
    assert.deepEqual(
      Object.fromEntries(Object.entries(boundedJson.data).filter(([key]) => key.endsWith("_seen"))),
      { files_seen: 1, bytes_seen: 4, lines_seen: 2 },
    );

    const boundedToon = await runCli([
      "metrics",
      "--root",
      root,
      "--fields",
      "files,bytes,lines",
    ], { json: false });
    assert.equal(boundedToon.code, 0);
    assert.match(boundedToon.stdout, /files_seen: 1/);
    assert.match(boundedToon.stdout, /bytes_seen: 4/);
    assert.match(boundedToon.stdout, /lines_seen: 2/);

    const full = await runCli([
      "metrics",
      "--root",
      root,
      "--full",
      "--fields",
      "files,bytes,lines",
    ]);
    assert.equal(full.code, 0);
    assert.deepEqual(
      Object.fromEntries(Object.entries(full.data).filter(([key]) => ["files", "bytes", "lines"].includes(key))),
      { files: 1, bytes: 4, lines: 2 },
    );
    assert.equal(full.data.files_seen, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("files path projection preserves scalar and byte-encoded paths", async () => {
  const root = makeRoot();
  try {
    write(root, "visible.txt", "x\n");
    writeFileSync(Buffer.concat([Buffer.from(`${root}/`), Buffer.from([0xff, 0x2e, 0x74, 0x78, 0x74])]), "x\n");
    const { data, code } = await runCli(["files", "--root", root, "--full", "--fields", "path"]);
    assert.equal(code, 0);
    assert.ok(data.files.includes("visible.txt"));
    assert.ok(data.files.some((item) => item.bytes === "/y50eHQ="));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("full metrics rejects bounded-only fields", async () => {
  const root = makeRoot();
  try {
    write(root, "a.txt", "x\n");
    for (const field of ["files_seen", "bytes_seen", "lines_seen"]) {
      const { data, code } = await runCli(["metrics", "--root", root, "--full", "--fields", field]);
      assert.equal(code, 2, field);
      assert.equal(data.error, "invalid_command", field);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
