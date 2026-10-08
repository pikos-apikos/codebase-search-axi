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
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const BIN = resolve(import.meta.dirname, "../bin/codebase-search");
const NODE = process.execPath;

function makeRoot() {
  return mkdtempSync(join(tmpdir(), "codebase-search-"));
}

/** Write a file at a (possibly non-UTF-8) Buffer path under a string root. */
function writeRaw(root, nameBytes, content) {
  const p = Buffer.concat([
    Buffer.from(root, "utf-8"),
    Buffer.from([0x2f]),
    nameBytes,
  ]);
  mkdirSync(p.subarray(0, p.lastIndexOf(0x2f)), { recursive: true });
  writeFileSync(p, content);
  return p;
}

function write(root, rel, content) {
  const p = join(root, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, Buffer.isBuffer(content) ? content : Buffer.from(content, "utf-8"));
  return p;
}

function runCli(args, { env, cwd, timeoutMs } = {}) {
  if (!args.includes("--json")) {
    const separator = args.indexOf("--");
    args = separator === -1
      ? [...args, "--json"]
      : [...args.slice(0, separator), "--json", ...args.slice(separator)];
  }
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(NODE, [BIN, ...args], { env: env ?? process.env, cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    let timer;
    if (timeoutMs) {
      timer = setTimeout(() => {
        child.kill("SIGKILL");
        rejectPromise(new Error(`cli did not finish within ${timeoutMs}ms`));
      }, timeoutMs);
    }
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolvePromise({
        code,
        stdout,
        stderr,
        data: stdout ? JSON.parse(stdout) : undefined,
      });
    });
  });
}

/** Create a fake `rg` at root/tools/rg running the given JS body; return env. */
function fakeRg(root, body) {
  const tools = join(root, "tools");
  mkdirSync(tools, { recursive: true });
  const rgPath = join(tools, "rg");
  writeFileSync(rgPath, `#!/usr/bin/env node\n${body}\n`);
  chmodSync(rgPath, 0o755);
  return { rgPath, env: { ...process.env, PATH: `${tools}:${process.env.PATH}` } };
}

function b64(buf) {
  return Buffer.from(buf).toString("base64");
}

/** Deep membership for Value items (strings or { bytes } objects). */
function deepIncludes(arr, target) {
  return arr.some((item) => JSON.stringify(item) === JSON.stringify(target));
}

/** The value() oracle: valid UTF-8 -> string, else { bytes: base64 }. */
function value(raw) {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, "latin1");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return { bytes: buf.toString("base64") };
  }
}

// 1 --------------------------------------------------------------------------
test("test_dash_pattern_is_a_value", async (t) => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, "allowed.txt", "-needle\nneedle\n");
  const { data, code } = await runCli([
    "search",
    "--root",
    root,
    "--full",
    "--",
    "-needle",
  ]);
  assert.equal(code, 0);
  assert.equal(data.status, "ok");
  assert.deepEqual(data.matches.map((m) => m.line), [1]);
  assert.equal(data.matches[0].text, "-needle\n");
  assert.equal(data.matches[0].submatches[0].match, "-needle");
});

// 2 --------------------------------------------------------------------------
test("test_explicit_unbounded_search_and_context_return_76", async (t) => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, "allowed.txt", "needle\n".repeat(76));
  for (const command of ["search", "context"]) {
    const { data, code } = await runCli([
      command,
      "needle",
      "--root",
      root,
      "--max-results",
      "76",
    ]);
    assert.equal(code, 0, command);
    assert.equal(data.status, "ok", command);
    assert.equal(data.count, 76, command);
    assert.deepEqual(data.complete, { scan: true, display: true }, command);
    assert.equal(data.total, 76, command);
  }
});

// 3 --------------------------------------------------------------------------
test("test_display_limit_keeps_scanning_and_counts_total", async (t) => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, "allowed.txt", "needle\nneedle\nneedle\nneedle\nneedle\n");
  const { data, code } = await runCli([
    "search",
    "needle",
    "--root",
    root,
    "--max-results",
    "2",
  ]);
  assert.equal(code, 0);
  assert.equal(data.status, "ok");
  assert.equal(data.matches.length, 2);
  assert.equal(data.total, 5);
  assert.equal(data.count, 2);
  assert.equal(data.returned, 2);
  assert.deepEqual(data.complete, { scan: true, display: false });
});

// 4 --------------------------------------------------------------------------
test("test_non_utf8_paths_content_context_and_byte_offsets", async (t) => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const name = Buffer.from([
    0x62, 0x61, 0x64, 0x2d, 0xff, 0x2e, 0x74, 0x78, 0x74, // bad-\xff.txt
  ]);
  const contents = Buffer.from([
    0x62, 0x65, 0x66, 0x6f, 0x72, 0x65, 0x20, 0xfe, 0x0a, // before \xfe\n
    0xc3, 0xa9, 0x20, 0xff, 0x20, 0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65,
    0x20, 0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65, 0x0d, 0x0a, // é \xff needle needle\r\n
    0x61, 0x66, 0x74, 0x65, 0x72, 0x20, 0xfd, 0x0a, // after \xfd\n
  ]);
  writeRaw(root, name, contents);
  const { data, code } = await runCli(
    ["context", "needle", "--root", root, "--full", "--before", "1", "--after", "1"],
  );
  assert.equal(code, 0);
  const item = data.matches[0];
  assert.deepEqual(item.path, value(name));
  assert.deepEqual(item.text, value(contents.subarray(9, 29)));
  assert.equal(item.column, 6);
  assert.deepEqual(
    item.submatches.map((m) => [m.start, m.end]),
    [
      [5, 11],
      [12, 18],
    ],
  );
  assert.deepEqual(item.before, [value([0x62, 0x65, 0x66, 0x6f, 0x72, 0x65, 0x20, 0xfe, 0x0a])]);
  assert.deepEqual(item.after, [value([0x61, 0x66, 0x74, 0x65, 0x72, 0x20, 0xfd, 0x0a])]);

  const listing = await runCli(["files", "--root", root, "--full"]);
  assert.equal(listing.code, 0);
  assert.ok(deepIncludes(listing.data.files, value(name)));
  const metrics = await runCli(["metrics", "--root", root, "--full"]);
  assert.equal(metrics.code, 0);
  assert.equal(metrics.data.bytes, contents.length);
});

// 5 --------------------------------------------------------------------------
test("test_non_utf8_submatch_bytes_are_lossless", async (t) => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeRaw(root, Buffer.from("allowed.txt", "utf-8"), Buffer.from([0x70, 0x72, 0x65, 0x66, 0x69, 0x78, 0x20, 0xff, 0x0a]));
  const { data, code } = await runCli([
    "search",
    "--root",
    root,
    "--full",
    "--",
    "(?-u:\\xFF)",
  ]);
  assert.equal(code, 0);
  const item = data.matches[0];
  assert.deepEqual(item.text, value([0x70, 0x72, 0x65, 0x66, 0x69, 0x78, 0x20, 0xff, 0x0a]));
  assert.equal(item.column, 8);
  assert.deepEqual(item.submatches, [{ match: value([0xff]), start: 7, end: 8 }]);
});

// 6 --------------------------------------------------------------------------
test("test_matching_lines_larger_than_read_chunk_preserve_text_and_offsets", async (t) => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const prefix = Buffer.from("é", "utf-8");
  const bigPrefix = Buffer.concat(Array.from({ length: 70000 }, () => prefix));
  for (const suffix of [Buffer.from(" tail ", "utf-8"), Buffer.from([0xff, 0x20, 0x74, 0x61, 0x69, 0x6c, 0x20])]) {
    const line = Buffer.concat([bigPrefix, Buffer.from("needle", "utf-8"), suffix, Buffer.from("needle\r\n", "latin1")]);
    writeRaw(root, Buffer.from("allowed.txt", "utf-8"), Buffer.concat([line, Buffer.from("needle\n", "latin1")]));
  const { data, code } = await runCli(["search", "needle", "--root", root, "--full"]);
    assert.equal(code, 0);
    assert.deepEqual(data.complete, { scan: true, display: true });
    assert.equal(data.total, 2);
    const lineBytes = Buffer.concat([bigPrefix, Buffer.from("needle", "utf-8"), suffix, Buffer.from("needle\r\n", "latin1")]);
    assert.deepEqual(data.matches, [
      {
        path: "allowed.txt",
        line: 1,
        column: bigPrefix.length + 1,
        text: value(lineBytes),
        submatches: [
          { match: "needle", start: bigPrefix.length, end: bigPrefix.length + 6 },
          {
            match: "needle",
            start: bigPrefix.length + 6 + suffix.length,
            end: bigPrefix.length + 12 + suffix.length,
          },
        ],
      },
      { path: "allowed.txt", line: 2, column: 1, text: "needle\n", submatches: [{ match: "needle", start: 0, end: 6 }] },
    ]);
  }
});

// 7 --------------------------------------------------------------------------
test("test_non_utf8_root_does_not_corrupt_relative_paths", async (t) => {
  const base = makeRoot();
  t.after(() => rmSync(base, { recursive: true, force: true }));
  // A root directory whose name carries a raw 0xFF byte.
  const rootBytes = Buffer.concat([
    Buffer.from(base, "utf-8"),
    Buffer.from([0x2f]),
    Buffer.from([0x72, 0x6f, 0x6f, 0x74, 0x2d, 0xff]), // root-\xff
  ]);
  mkdirSync(rootBytes);
  writeRaw(base, Buffer.concat([Buffer.from([0x72, 0x6f, 0x6f, 0x74, 0x2d, 0xff]), Buffer.from([0x2f, 0x61, 0x6c, 0x6c, 0x6f, 0x77, 0x65, 0x64, 0x2e, 0x74, 0x78, 0x74])]), Buffer.from("needle\n", "latin1"));
  // Drive the CLI from bash so the raw 0xFF root bytes reach argv (Node
  // transcodes non-UTF-8 argv, so a POSIX parent is required here).
  const script = `ROOT="$BASE/root-$(printf '\\xff')"
"$BIN" search needle --root "$ROOT" --full --json`;
  const proc = spawnSync("bash", ["-c", script], {
    env: { ...process.env, BASE: base, BIN },
    encoding: "utf-8",
  });
  assert.equal(proc.status, 0, proc.stderr);
  const data = JSON.parse(proc.stdout);
  assert.equal(data.status, "ok");
  assert.equal(data.matches[0].path, "allowed.txt");
});

// 8 --------------------------------------------------------------------------
test("test_context_uses_rg_encoding_conversion", async (t) => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const s = "before\nneedle\nafter\n";
  const le = Buffer.alloc(s.length * 2);
  for (let i = 0; i < s.length; i++) le.writeUInt16LE(s.charCodeAt(i), i * 2);
  writeRaw(root, Buffer.from("allowed.txt", "utf-8"), Buffer.concat([Buffer.from([0xff, 0xfe]), le]));
  const { data, code } = await runCli([
    "context",
    "needle",
    "--root",
    root,
    "--full",
    "--before",
    "1",
    "--after",
    "1",
  ]);
  assert.equal(code, 0);
  const item = data.matches[0];
  assert.equal(item.line, 2);
  assert.equal(item.column, 1);
  assert.equal(item.text, "needle\n");
  assert.deepEqual(item.before, ["before\n"]);
  assert.deepEqual(item.after, ["after\n"]);
});

test("test_context_deduplicates_overlapping_windows", async (t) => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, "allowed.txt", "before\nneedle\nshared\nneedle\nafter\n");
  const { data, code } = await runCli([
    "context",
    "needle",
    "--root",
    root,
    "--full",
    "--before",
    "2",
    "--after",
    "2",
  ]);
  assert.equal(code, 0);
  assert.deepEqual(data.matches.map((item) => item.before), [
    ["before\n"],
    [],
  ]);
  assert.deepEqual(data.matches.map((item) => item.after), [
    ["shared\n", "needle\n"],
    ["after\n"],
  ]);
});

// 9 --------------------------------------------------------------------------
test("test_unavailable_rg", async (t) => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const noTools = join(root, "no-tools");
  mkdirSync(noTools);
  const { data, code } = await runCli(["files", "--root", root], {
    env: { ...process.env, PATH: noTools },
  });
  assert.equal(code, 1);
  assert.equal(data.status, "error");
  assert.equal(data.error, "ripgrep_unavailable");
});

// 10 --------------------------------------------------------------------------
test("test_invalid_pattern_is_separate_from_diagnostics", async (t) => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, "allowed.txt", "needle\n");
  const { data, code, stderr } = await runCli([
    "search",
    "(",
    "--root",
    root,
    "--max-results",
    "5",
  ]);
  assert.equal(code, 1);
  assert.equal(data.status, "error");
  assert.equal(data.error, "invalid_pattern");
  // The diagnostic is forwarded verbatim to stderr (matching direct rg) and
  // never leaks into the JSON result on stdout.
  const direct = spawnSync("rg", ["--no-config", "--json", "-e", "(", "--", root], {
    encoding: "utf-8",
  });
  assert.equal(direct.status, 2);
  assert.ok(direct.stderr.includes("regex parse error"));
  assert.equal(stderr, direct.stderr);
  assert.ok(!data.message.includes("regex parse error"));
  assert.ok(!("matches" in data));
});

// 11 --------------------------------------------------------------------------
test("test_empty_matches_are_successful_and_complete", async (t) => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, "allowed.txt", "needle\n");
  const { data, code } = await runCli([
    "search",
    "absent",
    "--root",
    root,
    "--max-results",
    "5",
  ]);
  assert.equal(code, 0);
  assert.equal(data.status, "ok");
  assert.deepEqual(data.matches, []);
  assert.equal(data.total, 0);
  assert.deepEqual(data.complete, { scan: true, display: true });
});

// 12 --------------------------------------------------------------------------
test("test_stderr_flood_cannot_deadlock_or_become_result_data", async (t) => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { env } = fakeRg(
    root,
    "process.stderr.write('backend diagnostic\\n'.repeat(20000)); process.exit(2);",
  );
  const { data, code } = await runCli(
    ["search", "needle", "--root", root, "--max-results", "5"],
    { env, timeoutMs: 15000 },
  );
  assert.equal(code, 1);
  assert.equal(data.status, "error");
  assert.equal(data.error, "ripgrep_failed");
  assert.ok(!JSON.stringify(data).includes("backend diagnostic"));
});

// 13 --------------------------------------------------------------------------
test("test_backend_signal_is_not_success", async (t) => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { env } = fakeRg(root, "process.kill(process.pid, 'SIGTERM');");
  const { data, code } = await runCli(
    ["search", "needle", "--root", root, "--max-results", "5"],
    { env, timeoutMs: 15000 },
  );
  assert.equal(code, 1);
  assert.equal(data.status, "error");
  assert.equal(data.error, "ripgrep_failed");
});

// 14 --------------------------------------------------------------------------
test("test_late_failure_after_display_limit_is_not_success", async (t) => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, "allowed.txt", "needle\n");
  const event =
    '{"type":"match","data":{"path":{"text":"' +
    join(root, "allowed.txt").replace(/"/g, '\\"') +
    '"},"lines":{"text":"needle\\n"},"line_number":1,"submatches":[{"match":{"text":"needle"},"start":0,"end":6}]}}';
  const { env } = fakeRg(
    root,
    `process.stdout.write(${JSON.stringify(event)} + "\\n");
setTimeout(() => { process.stderr.write("late scan failure\\n"); process.exit(2); }, 100);`,
  );
  const { data, code } = await runCli(
    ["search", "needle", "--root", root, "--max-results", "1"],
    { env, timeoutMs: 15000 },
  );
  assert.equal(code, 1);
  assert.equal(data.status, "error");
  assert.equal(data.error, "ripgrep_failed");
  assert.ok(!("matches" in data));
});

// 15 --------------------------------------------------------------------------
test("test_truncated_json_stream_is_not_complete", async (t) => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, "allowed.txt", "x\n");
  const { env } = fakeRg(root, "process.stdout.write('{broken\\n'); process.exit(0);");
  const { data, code } = await runCli(
    ["search", "needle", "--root", root, "--max-results", "5"],
    { env, timeoutMs: 15000 },
  );
  assert.equal(code, 1);
  assert.equal(data.status, "error");
  assert.equal(data.error, "ripgrep_failed");
});

// 16 --------------------------------------------------------------------------
test("test_cli_interrupt_is_structured_and_reaps_backend", async (t) => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, "allowed.txt", "needle\n");
  const marker = join(root, "rg.pid");
  const { env } = fakeRg(
    root,
    `const fs = require("fs");
fs.writeFileSync(${JSON.stringify(marker)}, String(process.pid));
setTimeout(() => process.exit(0), 30000);`,
  );
  const startedAt = Date.now();
  const child = spawn(NODE, [BIN, "search", "needle", "--root", root, "--json"], { env });
  let stdout = "";
  child.stdout.on("data", (d) => (stdout += d));
  const deadline = Date.now() + 5000;
  while (!existsSync(marker) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(existsSync(marker), "backend pid marker was not written");
  child.kill("SIGINT");
  const code = await new Promise((r) => child.on("close", r));
  const elapsed = (Date.now() - startedAt) / 1000;
  assert.equal(code, 1);
  assert.ok(elapsed < 5, `cli took too long: ${elapsed}`);
  const data = JSON.parse(stdout);
  assert.equal(data.status, "error");
  assert.equal(data.error, "ripgrep_failed");
  assert.ok(stdout.includes("interrupted"), stdout);
  const pid = Number(readFileSync(marker, "utf-8").trim());
  assert.ok(pid > 0);
});

// 17 --------------------------------------------------------------------------
test("test_ordinary_search_agrees_with_direct_rg", async (t) => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, "allowed.txt", "é needle needle\nother\nneedle\r\n");
  const raw = await runCli(["search", "needle", "--root", root, "--max-results", "10"]);
  assert.equal(raw.code, 0);
  const rgOut = await new Promise((res, rej) => {
    const c = spawn("rg", ["--no-config", "--json", "--line-number", "--column", "-e", "needle", "--", root]);
    let o = "";
    c.stdout.on("data", (d) => (o += d));
    c.on("close", () => res(o));
    c.on("error", rej);
  });
  const got = [];
  for (const line of rgOut.split("\n")) {
    if (!line) continue;
    const ev = JSON.parse(line);
    if (ev.type !== "match") continue;
    got.push({
      path: ev.data.path.text.slice(root.length + 1),
      line: ev.data.line_number,
      column: ev.data.submatches[0].start + 1,
      text: ev.data.lines.text,
      submatches: ev.data.submatches.map((s) => ({ match: s.match.text, start: s.start, end: s.end })),
    });
  }
  const want = raw.data.matches.map((m) => ({
    path: m.path,
    line: m.line,
    column: m.column,
    text: m.text,
    submatches: m.submatches.map((s) => ({ match: s.match, start: s.start, end: s.end })),
  }));
  assert.deepEqual(want, got);
});

// 18 --------------------------------------------------------------------------
test("test_native_ignores_and_binary_detection_are_preserved", async (t) => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, ".ignore", "ignored.txt\n");
  write(root, "ignored.txt", "needle\n");
  write(root, ".hidden.txt", "needle\n");
  write(root, "binary.txt", Buffer.from([0x00, 0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65, 0x0a]));
  write(root, "allowed.txt", "needle\n");
    const { data, code } = await runCli(["search", "needle", "--root", root, "--full"]);
  assert.equal(code, 0);
  assert.deepEqual(data.matches.map((m) => m.path), ["allowed.txt"]);
});

// 19 --------------------------------------------------------------------------
test("test_unbounded_adapter_keeps_sensitive_denies", async (t) => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, "allowed.txt", "needle\n");
  write(root, "src/app.txt", "needle\n");
  const optional = [
    "node_modules/dependency.txt",
    "dist/bundle.js",
    "build/generated.txt",
    "target/output.txt",
    "coverage/report.txt",
  ];
  const mandatory = [
    ".env",
    ".env.production",
    ".env.local",
    "id_rsa",
    "signing.pem",
    "key.key",
  ];
  for (const denied of [...optional, ...mandatory]) {
    write(root, denied, "needle\n");
  }
  for (const command of ["search", "files"]) {
    const args =
      command === "search"
        ? [command, "needle", "--root", root, "--full"]
        : [command, "--root", root, "--full"];
    const { data, code } = await runCli(args);
    assert.equal(code, 0, command);
    const paths =
      command === "search" ? data.matches.map((m) => m.path) : data.files;
    for (const denied of mandatory) {
      assert.ok(!paths.includes(denied), `${command}: ${denied} should be denied`);
    }
    for (const included of optional) {
      assert.ok(paths.includes(included), `${command}: ${included} should be included by --full`);
    }
    assert.ok(paths.includes("allowed.txt"), command);
    assert.ok(paths.includes("src/app.txt"), command);
  }
});

// 20 --------------------------------------------------------------------------
test("test_files_limit_reports_complete_scan", async (t) => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (let number = 0; number < 76; number++) {
    write(root, `${number}.txt`, "needle\n");
  }
  const { data, code } = await runCli(["files", "--root", root, "--max-results", "3"]);
  assert.equal(code, 0);
  assert.equal(data.status, "ok");
  assert.equal(data.files.length, 3);
  assert.equal(data.total, 76);
  assert.equal(data.returned, 3);
  assert.equal(data.bounded, true);
  assert.equal(data.complete.scan, true);
  assert.equal(data.complete.display, false);
});

// 21 --------------------------------------------------------------------------
test("test_explicit_bound_conflicts_with_full", async (t) => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, "allowed.txt", "needle\n");
  const { data, code } = await runCli([
    "search",
    "needle",
    "--root",
    root,
    "--full",
    "--max-results",
    "1",
  ]);
  assert.equal(code, 2);
  assert.equal(data.status, "error");
  assert.equal(data.error, "invalid_command");
});

// 22 --------------------------------------------------------------------------
test("test_success_exit_without_rg_summary_is_not_complete", async (t) => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, "allowed.txt", "needle\n");
  const event =
    '{"type":"match","data":{"path":{"text":"' +
    join(root, "allowed.txt").replace(/"/g, '\\"') +
    '"},"lines":{"text":"needle\\n"},"line_number":1,"submatches":[{"match":{"text":"needle"},"start":0,"end":6}]}}';
  const { env } = fakeRg(
    root,
    `process.stdout.write(${JSON.stringify(event)} + "\\n"); process.exit(0);`,
  );
  const { data, code } = await runCli(
    ["search", "needle", "--root", root, "--max-results", "1"],
    { env, timeoutMs: 15000 },
  );
  assert.equal(code, 1);
  assert.equal(data.status, "error");
  assert.equal(data.error, "ripgrep_failed");
  assert.ok(!("matches" in data));
});

// 23 --------------------------------------------------------------------------
test("test_metrics_bound_is_an_observation_not_a_total", async (t) => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, "allowed.txt", "x\n");
  const { data, code } = await runCli(["metrics", "--root", root]);
  assert.equal(code, 0);
  assert.equal(data.status, "ok");
  assert.ok(data.files_seen >= 1);
  assert.ok(data.bytes_seen > 0);
  assert.ok(data.lines_seen >= 1);
  assert.equal(data.bounded, true);
  assert.equal(data.complete.scan, false);
  assert.ok("help" in data);
});
