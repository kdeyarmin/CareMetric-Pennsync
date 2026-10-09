import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Static contract: no unapproved direct OASIS write.
 *
 * `OASISAssessment` and `OASISUpload` carry clinical responses. A direct
 * `.create()` / `.update()` from a component bypasses the version-aware builder
 * and the protected backend path, so nothing checks the response schema, the
 * time point, the code, or that a clinician actually selected it. UI-level care
 * is not a control — the next component to be written will not know the rule.
 *
 * A new writer must either route through the adapter or be added to
 * APPROVED_WRITERS with a reason, which makes the exception reviewable in a diff
 * rather than invisible.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** Paths allowed to write response-bearing OASIS rows, and why. */
const APPROVED_WRITERS = new Map([
  [
    "base44/functions/saveOasisResponses/entry.ts",
    "The protected response writer, released by the owner on 2026-10-08. It "
    + "decides authority from the built-in admin role or an exact active "
    + "membership, applies the chart rule, derives every row's provenance and "
    + "schema itself, and deletes only the row it just created when that row "
    + "loses its authority or a concurrent twin landed first.",
  ],
  [
    "base44/functions/manageOASISRecords/entry.ts",
    "The OASIS record broker, released with the OASIS Center on 2026-10-08. It "
    + "writes OASISUpload (saved analyses, extraction review, sign-off, the "
    + "comprehensive review) under the caller's trusted scope and the chart "
    + "rule, and never writes OASISAssessment.",
  ],
]);

const WRITE_RE = /\b(OASISAssessment|OASISUpload)\s*\.\s*(create|update|updateMany|bulkCreate|bulkUpdate|delete|bulkDelete)\s*\(/g;

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) yield full;
  }
}

async function findWriters() {
  const found = new Map();
  for (const base of ["src", "base44"]) {
    for await (const file of walk(join(ROOT, base))) {
      const rel = relative(ROOT, file).split("\\").join("/");
      if (/\.(test|spec)\.(js|jsx|ts|tsx)$/.test(rel)) continue;
      const src = await readFile(file, "utf8");
      const hits = [...src.matchAll(WRITE_RE)].map((m) => `${m[1]}.${m[2]}`);
      if (hits.length) found.set(rel, [...new Set(hits)]);
    }
  }
  return found;
}

test("no unapproved direct OASISAssessment/OASISUpload write exists", async () => {
  const found = await findWriters();
  const unapproved = [...found.keys()].filter((f) => !APPROVED_WRITERS.has(f));
  assert.deepEqual(
    unapproved,
    [],
    "Unapproved direct OASIS write(s) found:\n"
    + unapproved.map((f) => `  ${f} → ${found.get(f).join(", ")}`).join("\n")
    + "\n\nBrowser code never writes OASIS rows: route the write through "
    + "saveOasisResponses or the manageOASISRecords broker.",
  );
});

test("every approved writer still exists and carries a stated reason", async () => {
  const found = await findWriters();
  for (const [path, reason] of APPROVED_WRITERS) {
    assert.ok(reason && reason.length > 30, `${path}: the approval needs a real reason`);
    assert.ok(
      found.has(path),
      `${path} is on the approved list but no longer writes. Remove the stale exemption.`,
    );
  }
});

test("the protected write path is the only writer of clinician-selected responses", async () => {
  const found = await findWriters();
  for (const path of found.keys()) {
    if (path === "base44/functions/saveOasisResponses/entry.ts") continue;
    const src = await readFile(join(ROOT, path), "utf8");
    assert.ok(
      !/response_origin\s*:\s*['"]clinician_selected['"]/.test(src),
      `${path} stamps response_origin: "clinician_selected" outside the protected write path.`,
    );
  }
});

test("no writer outside the adapter builds a v2 response row by hand", async () => {
  const found = await findWriters();
  for (const path of found.keys()) {
    if (path === "base44/functions/saveOasisResponses/entry.ts") continue;
    const src = await readFile(join(ROOT, path), "utf8");
    assert.ok(
      !/response_schema_id\s*:\s*['"]pennsync-oasis-response-v2-cms-e2['"]/.test(src),
      `${path} writes a v2 response_schema_id directly. Use buildOfficialResponseRow().`,
    );
  }
});

// Source-cohort verification depends on assessment rows never changing after
// creation. The writer may delete only the row it created in the same request
// (a write that lost its authority, or a concurrent twin), never update one.
test("OASISAssessment source rows remain append-only", async () => {
  for (const [path, operations] of await findWriters()) {
    const allowed = path === "base44/functions/saveOasisResponses/entry.ts"
      ? ["OASISAssessment.create", "OASISAssessment.delete"]
      : ["OASISAssessment.create"];
    assert.deepEqual(
      operations.filter((op) => op.startsWith("OASISAssessment.") && !allowed.includes(op)), [], path);
  }
  const writer = await readFile(join(ROOT, "base44/functions/saveOasisResponses/entry.ts"), "utf8");
  const deletes = [...writer.matchAll(/OASISAssessment\.delete\(([^)]*)\)/g)].map((match) => match[1]);
  assert.ok(deletes.length > 0);
  assert.deepEqual([...new Set(deletes)], ["assessmentId"], "only the just-created id is ever deleted");
  assert.match(writer, /const assessmentId = exactIdentifier\(created\?\.id\);/);
  const created = writer.indexOf("const created = await entities.OASISAssessment.create(");
  assert.ok(created > 0 && [...writer.matchAll(/OASISAssessment\.delete\(/g)].every((m) => m.index > created));
});

// The broker also writes through two generic helpers (a create-once and a
// compare-and-set), which the literal scan above cannot see. Their entity names
// are enumerated here so a new OASIS entity reached that way is reviewed too.
test("the OASIS record broker's generic writers reach only reviewed entities", async () => {
  const broker = await readFile(join(ROOT, "base44/functions/manageOASISRecords/entry.ts"), "utf8");
  const reached = (helper) => [...new Set([...broker.matchAll(
    new RegExp(`${helper}\\(entities, '([A-Za-z]+)'`, "g"))].map((match) => match[1]))].sort();
  assert.deepEqual(reached("compareAndSet"), ["OASISUpload"]);
  assert.deepEqual(reached("createKeyedOnce"), ["OASISAudit", "OASISWorkflowExecution", "Task"]);
  assert.equal((broker.match(/entities\[entity\]/g) || []).length,
    (broker.match(/entities\[entity\]\.(?:updateMany|filter|create|delete)\(/g) || []).length,
    "the generic helpers are the only computed entity reach");
  assert.doesNotMatch(broker, /OASISAssessment\.(?:create|update|delete)/, "the broker never writes a response row");
});
