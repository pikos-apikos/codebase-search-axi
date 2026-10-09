import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
  existsSync,
  unlinkSync,
  symlinkSync,
} from "node:fs";
import { tmpdir, userInfo } from "node:os";
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

test("setup hooks is explicit, idempotent, and preserves unrelated home files", async () => {
  const home = makeRoot();
  try {
    const unrelated = join(home, "unrelated.json");
    writeFileSync(unrelated, '{"keep":true}\n', "utf-8");
    for (const action of ["status", "install", "status", "uninstall", "status"]) {
      const { data, code } = await runCli([
        "setup",
        "hooks",
        action,
        "--home",
        home,
      ]);
      assert.equal(code, 0);
      assert.equal(data.status, "ok");
      assert.equal(data.command, "setup");
    }
    assert.equal(readFileSync(unrelated, "utf-8"), '{"keep":true}\n');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("setup hooks requires an explicit isolated home", async () => {
  for (const action of ["status", "install", "uninstall"]) {
    const { data, code } = await runCli(["setup", "hooks", action]);
    assert.equal(code, 2);
    assert.equal(data.status, "error");
    assert.equal(data.error, "invalid_command");
  }
});

test("setup hooks rejects personal home aliases before dispatch", async () => {
  const personalHome = userInfo().homedir;
  const aliasRoot = makeRoot();
  const symlinkHome = join(aliasRoot, "home");
  symlinkSync(personalHome, symlinkHome, "dir");
  try {
    for (const home of [personalHome, join(personalHome, "."), "~", "$HOME", "${HOME}", symlinkHome]) {
      for (const action of ["status", "install", "uninstall"]) {
        const { data, code } = await runCli(["setup", "hooks", action, "--home", home]);
        assert.equal(code, 2);
        assert.equal(data.status, "error");
        assert.equal(data.error, "invalid_command");
      }
    }
  } finally {
    rmSync(aliasRoot, { recursive: true, force: true });
  }
});

test("setup hooks rejects the account home when HOME is overridden", async () => {
  const fakeHome = makeRoot();
  try {
    for (const action of ["status", "install", "uninstall"]) {
      const { data, code } = await runCli(["setup", "hooks", action, "--home", userInfo().homedir], {
        env: { ...process.env, HOME: fakeHome },
      });
      assert.equal(code, 2);
      assert.equal(data.status, "error");
      assert.equal(data.error, "invalid_command");
    }
  } finally {
    rmSync(fakeHome, { recursive: true, force: true });
  }
});

test("setup hooks surfaces SDK write failures", async () => {
  for (const action of ["install", "uninstall"]) {
    const home = makeRoot();
    try {
      mkdirSync(join(home, ".claude"), { recursive: true });
      writeFileSync(join(home, ".claude", "settings.json"), "{\n", "utf-8");
      const { data, code } = await runCli(["setup", "hooks", action, "--home", home]);
      assert.equal(code, 1);
      assert.equal(data.status, "error");
      assert.equal(data.error, "hook_setup_failed");
      assert.match(data.message, /settings\.json/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }
});

test("setup hooks rejects project-scoped configuration", async () => {
  for (const flag of ["--scope", "--project-dir"]) {
    const { data, code } = await runCli(["setup", "hooks", "status", flag, "/tmp/project"]);
    assert.equal(code, 2);
    assert.equal(data.status, "error");
    assert.equal(data.error, "invalid_command");
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

test("mandatory denied globs cannot be bypassed by positive glob or scan flags", async () => {
  const root = makeRoot();
  try {
    write(root, "safe.txt", "public-marker\n");
    write(root, "secret.key", "synthetic-secret-marker\n");
    const common = ["--root", root, "--full", "--glob", "**/*.key", "--hidden", "--no-ignore"];
    const cases = [
      ["files", ...common],
      ["search", "synthetic-secret-marker", ...common],
      ["context", "synthetic-secret-marker", ...common],
      ["count", "synthetic-secret-marker", ...common],
      ["metrics", ...common],
    ];
    for (const args of cases) {
      const { data, code, stdout } = await runCli(args);
      assert.equal(code, 0, args[0]);
      assert.equal(stdout.includes("synthetic-secret-marker"), false, args[0]);
      const serialized = JSON.stringify(data);
      assert.equal(serialized.includes("secret.key"), false, args[0]);
      if (args[0] === "files") assert.deepEqual(data.files, []);
      if (args[0] === "metrics") assert.equal(data.files, 0);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("display text and serialized byte bounds mark truncation", async () => {
  const root = makeRoot();
  try {
    write(root, "long.txt", "needle-abcdefghijklmnopqrstuvwxyz\n");
    const text = await runCli(["search", "needle", "--root", root, "--max-text-bytes", "6"]);
    assert.equal(text.code, 0);
    assert.equal(text.data.matches[0].text_truncated, true);
    assert.equal(text.data.matches[0].text_bytes > 6, true);
    const projected = await runCli(["search", "needle", "--root", root, "--fields", "path", "--max-text-bytes", "1"]);
    assert.equal(projected.code, 0);
    assert.deepEqual(projected.data.matches[0], { path: "long.txt" });
    const bytes = await runCli(["search", "needle", "--root", root, "--max-bytes", "180"]);
    assert.equal(bytes.code, 0);
    assert.ok(Buffer.byteLength(JSON.stringify(bytes.data) + "\n") <= 180);
    const tooSmall = await runCli(["search", "needle", "--root", root, "--max-bytes", "1"]);
    assert.equal(tooSmall.code, 1);
    assert.equal(tooSmall.data.error, "output_bound");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("text bounds keep UTF-8 prefixes valid and selected metadata visible", async () => {
  const root = makeRoot();
  try {
    write(root, "unicode.txt", "needleé\n");
    const { data, code } = await runCli(["search", "needle", "--root", root, "--max-text-bytes", "7", "--fields", "text"]);
    assert.equal(code, 0);
    assert.equal(data.matches[0].text, "needle");
    assert.equal(data.matches[0].text_bytes > 7, true);
    assert.equal(data.matches[0].text_truncated, true);
    assert.equal(data.complete.display, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("text bounds preserve bounded non-UTF-8 bytes", async () => {
  const root = makeRoot();
  try {
    write(root, "binary.txt", Buffer.from([0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65, 0xff, 0x0a]));
    const { data, code } = await runCli(["search", "needle", "--root", root, "--max-text-bytes", "6"]);
    assert.equal(code, 0);
    assert.deepEqual(data.matches[0].text, { bytes: Buffer.from("needle").toString("base64") });
    assert.equal(data.matches[0].text_truncated, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scan bounds stop discovery and report incomplete scans", async () => {
  const root = makeRoot();
  try {
    write(root, "one.txt", "needle\n");
    write(root, "two.txt", "needle\n");
    write(root, "nonmatching.txt", "other\n");
    const { data, code } = await runCli(["search", "needle", "--root", root, "--full", "--scan-max-files", "1"]);
    assert.equal(code, 2);
    assert.equal(data.error, "invalid_command");
    const bounded = await runCli(["search", "needle", "--root", root, "--scan-max-files", "1"]);
    assert.equal(bounded.code, 0);
    assert.equal(bounded.data.complete.scan, false);
    assert.equal("total" in bounded.data, false);
    const count = await runCli(["count", "needle", "--root", root, "--scan-max-files", "1"]);
    assert.equal(count.code, 0);
    assert.equal(count.data.complete.scan, false);
    assert.equal("total" in count.data, false);
    const nonmatching = await runCli(["search", "needle", "--root", root, "--scan-max-files", "1"]);
    assert.equal(nonmatching.code, 0);
    assert.equal(nonmatching.data.complete.scan, false);
    const nonmatchingCount = await runCli(["count", "needle", "--root", root, "--scan-max-files", "1"]);
    assert.equal(nonmatchingCount.code, 0);
    assert.equal(nonmatchingCount.data.complete.scan, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("explicit TOML policy is loaded, validated, and format aliases JSON", async () => {
  const root = makeRoot();
  const policy = join(root, "policy.toml");
  try {
    write(root, "visible.txt", "needle\n");
    write(root, "optional/hidden.txt", "needle\n");
    writeFileSync(policy, 'optional_globs = [\n  \'!**/optional/**\', # keep # inside a literal\n]\nmax_results = 1\n');
    const files = await runCli(["files", "--root", root, "--policy", policy, "--full", "--format", "json"]);
    assert.equal(files.code, 0);
    assert.deepEqual([...files.data.files].sort(), ["policy.toml", "visible.txt"]);
    assert.equal(files.data.bounded, false);
    const malformed = join(root, "bad.toml");
    writeFileSync(malformed, "not valid = [");
    const bad = await runCli(["files", "--root", root, "--policy", malformed]);
    assert.equal(bad.code, 1);
    assert.equal(bad.data.error, "invalid_policy");
    writeFileSync(malformed, 'max_results = 1\nmax_results = 2\n');
    const duplicate = await runCli(["files", "--root", root, "--policy", malformed]);
    assert.equal(duplicate.code, 1);
    assert.equal(duplicate.data.error, "invalid_policy");
    writeFileSync(malformed, 'optional_globs = [\n  """!**/#cache/**""",\n]\n');
    const multiline = await runCli(["files", "--root", root, "--policy", malformed]);
    assert.equal(multiline.code, 0);
    writeFileSync(malformed, 'optional_globs = ["""!**/\"quoted\"/**"""]\n');
    const quotedMultiline = await runCli(["files", "--root", root, "--policy", malformed]);
    assert.equal(quotedMultiline.code, 0);
    writeFileSync(malformed, 'optional_globs = ["foo]"]\n');
    const closingBracket = await runCli(["files", "--root", root, "--policy", malformed]);
    assert.equal(closingBracket.code, 0);
    writeFileSync(malformed, 'optional_globs = ["\\u12"]\n');
    const badEscape = await runCli(["files", "--root", root, "--policy", malformed]);
    assert.equal(badEscape.code, 1);
    writeFileSync(malformed, 'optional_globs = ["one"\n  "two"]\n');
    const missingComma = await runCli(["files", "--root", root, "--policy", malformed]);
    assert.equal(missingComma.code, 1);
    writeFileSync(malformed, 'optional_globs = "one\n two"\n');
    const multilineBasic = await runCli(["files", "--root", root, "--policy", malformed]);
    assert.equal(multilineBasic.code, 1);
    writeFileSync(malformed, Buffer.from('optional_globs = ["foo\0bar"]\n', "utf8"));
    const nul = await runCli(["files", "--root", root, "--policy", malformed]);
    assert.equal(nul.code, 1);
    writeFileSync(malformed, Buffer.from([0x6f, 0x70, 0x74, 0x69, 0x6f, 0x6e, 0x61, 0x6c, 0x5f, 0x67, 0x6c, 0x6f, 0x62, 0x73, 0x20, 0x3d, 0x20, 0x5b, 0x22, 0x66, 0x6f, 0x6f, 0xff, 0x22, 0x5d, 0x0a]));
    const invalidUtf8 = await runCli(["files", "--root", root, "--policy", malformed]);
    assert.equal(invalidUtf8.code, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI globs override policy globs while mandatory denies remain last", async () => {
  const root = makeRoot();
  const policy = join(root, "policy.toml");
  try {
    write(root, "dist/allowed.txt", "needle\n");
    write(root, "secret.key", "needle\n");
    writeFileSync(policy, 'optional_globs = ["!**/dist/**"]\n');
    const result = await runCli([
      "files", "--root", root, "--policy", policy, "--glob", "**/dist/**", "--full",
    ]);
    assert.equal(result.code, 0);
    assert.deepEqual(result.data.files, ["dist/allowed.txt"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("bounded search, context, and count preserve non-UTF8 paths", async () => {
  const root = makeRoot();
  try {
    writeFileSync(Buffer.concat([Buffer.from(root), Buffer.from([0x2f, 0x30, 0x2d, 0xff, 0x2e, 0x74, 0x78, 0x74])]), "needle\n");
    for (const command of ["search", "context", "count"]) {
      const args = [command, ...(command === "files" ? [] : ["needle"]), "--root", root, "--scan-max-files", "1"];
      const result = await runCli(args);
      assert.equal(result.code, 0, command);
      assert.equal(result.data.complete.scan, true, command);
      const records = command === "count" ? result.data.counts : result.data.matches;
      const nonUtf8Name = Buffer.from([0x30, 0x2d, 0xff, 0x2e, 0x74, 0x78, 0x74]).toString("base64");
      assert.ok(records.some((item) => item.path?.bytes === nonUtf8Name), command);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("format aliases select JSON errors and output bounds use TOON", async () => {
  const root = makeRoot();
  try {
    const bad = join(root, "bad.toml");
    writeFileSync(bad, "invalid = true\n");
    const error = await runCli(["files", "--root", root, "--policy", bad, "--format", "json"], { json: false });
    assert.equal(error.code, 1);
    assert.equal(error.data.error, "invalid_policy");
    write(root, "a.txt", "x\n");
    const toon = await runCli(["files", "--root", root, "--max-bytes", "20"], { json: false });
    assert.equal(toon.code, 1);
    assert.match(toon.stdout, /^error:/);
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
