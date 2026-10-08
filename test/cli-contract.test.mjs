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
  for (const cmd of ["files", "search", "context", "metrics"]) {
    assert.ok(stdout.includes(cmd), `help missing ${cmd}`);
  }
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
