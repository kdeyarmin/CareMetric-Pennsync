import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findDuplicateKeys,
  scanFiles,
  trackedJsFiles,
  unparseableByExtension,
} from "./tools-duplicate-object-keys.mjs";

/**
 * Guards tools-duplicate-object-keys.mjs. The gate exists because git merges
 * two branches that each add the same key to one frozen registry literal with
 * NO conflict, the later key silently wins, and `node --check` passes — so the
 * detector has to SEE the duplicate that node --check cannot, name BOTH ends of
 * it, parse the whole tracked JS/TS population rather than a part, and never
 * report a clean answer after looking at nothing.
 *
 * Hazard measured by #360's seat; esbuild instrument by #372's seat; the
 * far-apart sabotage shape, the node --check blindness check, and the
 * parsed-count requirement are Plan's (session_014pqTP9sfvpVkuPNutbeAk3).
 */

// Plan's shape: the duplicate is appended FAR from the first use, as a merge of
// two branches would place it, in a frozen registry literal.
const SABOTAGE = [
  "export const REGISTRY = Object.freeze({",
  "  alpha: handlerA,",
  "  beta: handlerB,",
  "  gamma: handlerC,",
  "  delta: handlerD,",
  "  epsilon: handlerF,",
  "  alpha: handlerE,",
  "});",
].join("\n");

test("detects a far-apart duplicate and names BOTH lines", () => {
  const { dupes } = findDuplicateKeys(SABOTAGE, "client.mjs");
  assert.equal(dupes.length, 1);
  assert.equal(dupes[0].key, "alpha");
  assert.equal(dupes[0].line, 7); // the duplicate
  assert.equal(dupes[0].originalLine, 2); // the first use it shadows
});

test("node --check is BLIND to the hazard this gate catches", () => {
  // The whole reason the gate exists: the sabotage source is valid syntax, so
  // `node --check` exits 0 on it. If this ever throws, the hazard stopped being
  // invisible and the gate's premise changed — a test that would tell us.
  const dir = mkdtempSync(join(tmpdir(), "dupkey-nodecheck-"));
  try {
    const f = join(dir, "registry.mjs");
    writeFileSync(f, SABOTAGE);
    // Throws (non-zero exit) only on a syntax error; the duplicate is not one.
    execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a clean object literal yields no finding and no retry", () => {
  const res = findDuplicateKeys(
    "const o = { a: 1, b: 2, c: 3 }; export default o;",
    "x.js",
  );
  assert.deepEqual(res.dupes, []);
  assert.equal(res.retriedAsTsx, false);
});

test("accessor pairs are not duplicates (would switch the gate off)", () => {
  // A get/set pair shares a name legally; esbuild does not warn, and a gate
  // that flagged it gets disabled. Plan's exclusion.
  const res = findDuplicateKeys(
    "const o = { get x() { return 1; }, set x(v) {} }; export default o;",
    "x.js",
  );
  assert.deepEqual(res.dupes, []);
});

test("computed keys are not flagged (cannot statically collide)", () => {
  const res = findDuplicateKeys(
    'const k = "a"; const o = { [k]: 1, [k]: 2 }; export default o;',
    "x.js",
  );
  assert.deepEqual(res.dupes, []);
});

test("reads JSX natively — the parser choice acorn could not make", () => {
  // acorn without a plugin is blind to a third of the tree; esbuild reads JSX,
  // so a duplicate inside a .jsx module is seen rather than silently skipped.
  // A .jsx selects the tsx loader directly, so no retry is needed.
  const { dupes, retriedAsTsx } = findDuplicateKeys(
    "const o = { a: 1, a: 2 }; export default function C() { return <div />; }",
    "C.jsx",
  );
  assert.equal(dupes.length, 1);
  assert.equal(dupes[0].key, "a");
  assert.equal(retriedAsTsx, false);
});

test("a .ts file is parsed under the ts loader, TS syntax and all", () => {
  // The wider scope includes TypeScript, where the duplicate-key hazard is
  // identical. The ts loader must accept TS-only syntax (here a typed
  // declaration and a `<T>x` assertion, which THROWS under tsx) without a
  // retry, and still find the duplicate.
  const src = [
    "const n = <number>(1 as unknown);",
    "export const o: Record<string, number> = {",
    "  a: 1,",
    "  b: 2,",
    "  a: n,",
    "};",
  ].join("\n");
  const { dupes, retriedAsTsx } = findDuplicateKeys(src, "registry.ts");
  assert.equal(dupes.length, 1);
  assert.equal(dupes[0].key, "a");
  assert.equal(dupes[0].line, 5);
  assert.equal(dupes[0].originalLine, 3);
  // Parsed on the first loader: a `<T>x` assertion would throw under tsx, so a
  // retry here would mean the ts loader was not tried first.
  assert.equal(retriedAsTsx, false);
});

test("JSX in a .js file throws the js loader and is saved by a tsx retry", () => {
  // #376's seat measured that the js loader throws on JSX. Rather than fail the
  // gate on a valid-but-mis-extensioned file, the scanner retries under tsx —
  // and still finds a duplicate in it. The retry is surfaced so a tree whose
  // extensions understate their syntax is visible rather than silent.
  const src =
    "const o = { a: 1, a: 2 }; export default function C() { return <div />; }";
  const { dupes, retriedAsTsx } = findDuplicateKeys(src, "mislabeled.js");
  assert.equal(dupes.length, 1);
  assert.equal(dupes[0].key, "a");
  assert.equal(retriedAsTsx, true);
});

test("a duplicate survives many preceding warnings (diagnostic limit)", () => {
  // Copilot flagged on #394 that esbuild's default diagnostic limit could drop
  // a later duplicate-key warning once earlier non-target warnings consumed it,
  // reading the file clean. Measured false on 0.28.2 — the returned `warnings`
  // array is not capped — but the gate sets `logLimit: 0` so the guarantee does
  // not rest on that. This pins the property either way: a pile of unrelated
  // warnings (here duplicate `case` labels) before the duplicate key does not
  // hide it. Were a future esbuild to truncate the array at the default 10
  // WITHOUT logLimit:0, this would fail — which is the point.
  const noise = [];
  for (let i = 0; i < 15; i += 1) {
    noise.push(`function f${i}(x){ switch(x){ case 1: return 1; case 1: return 2; } }`);
  }
  const src = `${noise.join("\n")}\nconst o = { a: 1, b: 2, a: 3 }; export default o;`;
  const { dupes } = findDuplicateKeys(src, "noisy.js");
  assert.equal(dupes.length, 1);
  assert.equal(dupes[0].key, "a");
});

test("an unparseable file is null, not a silent clean pass", () => {
  // Unparseable under both the primary loader and the tsx retry.
  assert.equal(findDuplicateKeys("const o = {", "bad.js"), null);
});

test("scanFiles attributes findings, collects unparseable, counts retries", () => {
  const dir = mkdtempSync(join(tmpdir(), "dupkey-scan-"));
  try {
    const dupFile = join(dir, "dup.mjs");
    const cleanFile = join(dir, "clean.js");
    const badFile = join(dir, "bad.js");
    const retryFile = join(dir, "jsx-in-js.js");
    writeFileSync(dupFile, SABOTAGE);
    writeFileSync(cleanFile, "export default { a: 1, b: 2 };");
    writeFileSync(badFile, "const o = {");
    writeFileSync(
      retryFile,
      "export default function C() { return <div />; }",
    );
    const { findings, unparseable, retried, scanned } = scanFiles([
      dupFile,
      cleanFile,
      badFile,
      retryFile,
    ]);
    assert.equal(scanned, 4);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].file, dupFile);
    assert.equal(findings[0].key, "alpha");
    assert.deepEqual(unparseable, [badFile]);
    assert.equal(retried, 1); // the JSX-in-.js file
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a parse-failure tally names the dimension a hole runs along", () => {
  // Plan's sharpened point 2: one aggregate count cannot tell three odd files
  // from a whole class gone invisible. The by-extension tally must surface the
  // systematic class (every .jsx) ahead of the scattered ones, so a refusal
  // reads as "a file type stopped parsing", not "N files skipped".
  const unparseable = [
    "a/one.jsx",
    "b/two.jsx",
    "c/three.jsx",
    "d/odd.ts",
    "e/lonely.mjs",
  ];
  const tally = unparseableByExtension(unparseable);
  // Most-frequent first: the .jsx class leads.
  assert.deepEqual(tally[0], [".jsx", 3]);
  // Ties broken by name, so the line is stable across runs.
  assert.deepEqual(tally, [
    [".jsx", 3],
    [".mjs", 1],
    [".ts", 1],
  ]);
});

test("the file list is not blind — a non-rotting floor", () => {
  // The gate's "0 duplicates" is only trustworthy if it looked at the tree.
  // Membership of the hazard's own file is a floor that does not rot: it will
  // not vanish without a great deal of other change, where a bare count would
  // drift on ordinary churn.
  const files = trackedJsFiles();
  assert.ok(
    files.includes("services/authority-client/client.mjs"),
    "tracked JS must include the registry file the hazard lives in",
  );
  // The wider scope must actually reach TypeScript, not just the .js family.
  assert.ok(
    files.some((f) => f.endsWith(".ts")),
    "tracked population must include .ts files",
  );
  assert.ok(files.length > 100, `expected a substantial tree, got ${files.length}`);
});
