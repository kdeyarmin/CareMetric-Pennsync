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
    "The future protected write path. It is hard-paused before client creation; its dormant validator remains contract-tested for the eventual server-broker redesign.",
  ],
  [
    "src/components/hub-tabs/OASISAnalyzer.jsx",
    "Dormant AI-extraction writer retained for redesign only. OASISUpload write "
    + "RLS is service-role-only; restoration requires a tenant/chart broker.",
  ],
  [
    "src/components/oasis/OASISApprovalWorkflow.jsx",
    "Dormant review writer retained for redesign only. Service-only OASISUpload "
    + "write RLS blocks it until authorized broker support exists.",
  ],
  [
    "src/components/oasis/OASISComparisonView.jsx",
    "Dormant comparison writer retained for redesign only. Service-only "
    + "OASISUpload write RLS blocks it until authorized broker support exists.",
  ],
]);

const WRITE_RE = /\b(OASISAssessment|OASISUpload)\s*\.\s*(create|update|bulkCreate|bulkUpdate)\s*\(/g;

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
    + "\n\nBrowser OASIS writes are paused. Add a server-owned tenant + patient-access "
    + "broker before registering any new writer.",
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
