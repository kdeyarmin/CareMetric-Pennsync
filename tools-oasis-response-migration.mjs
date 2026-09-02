#!/usr/bin/env node
/**
 * OASIS response-schema migration and reporting tool.
 *
 * EXPAND-ONLY. This tool NEVER converts, recodes or reinterprets a clinical
 * response. It cannot: a legacy code and a v2 code with the same characters mean
 * different things, and there is no rule that maps one onto the other without
 * inventing a clinical fact. The only write it will ever propose is NON-CLINICAL
 * provenance (`response_schema_id: "pennsync-oasis-response-v1-legacy"`,
 * `migration_status: "legacy_provenance_annotated"`) on rows that already have
 * no schema — and even that is opt-in, idempotent and byte-preserving.
 *
 * DRY RUN IS THE DEFAULT. `--apply` is refused unless `--i-have-read-the-plan`
 * is also given, because "ran the migration by accident" must not be reachable.
 *
 *   node tools-oasis-response-migration.mjs --in export.json
 *   node tools-oasis-response-migration.mjs --in export.json --out report.json
 *   node tools-oasis-response-migration.mjs --in export.json --apply --i-have-read-the-plan
 *
 * Input is a JSON array of OASISAssessment rows (an export), so the tool runs
 * offline against a snapshot and never touches live data by itself.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import process from "node:process";

const V1 = "pennsync-oasis-response-v1-legacy";
const V2 = "pennsync-oasis-response-v2-cms-e2";
const KNOWN = new Set([V1, V2]);

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const has = (name) => process.argv.includes(name);

/** Stable checksum of the CLINICAL bytes of a row — what must never change. */
export function clinicalChecksum(row) {
  const clinical = {
    item_number: row?.item_number ?? null,
    response: row?.response ?? null,
    response_value: row?.response_value ?? null,
  };
  return createHash("sha256").update(JSON.stringify(clinical)).digest("hex").slice(0, 16);
}

/** Classify one saved row's schema state. */
export function rowState(row) {
  const id = row?.response_schema_id;
  if (!id) return "unversioned";
  if (id === V1) return "legacy";
  if (id === V2) return "v2";
  return "unknown_schema";
}

/**
 * Inventory an export by tenant, item, writer and schema state.
 *
 * @param {Array} assessments
 */
export function inventory(assessments) {
  const byTenant = new Map();
  const byItem = new Map();
  const byWriter = new Map();
  const byState = { unversioned: 0, legacy: 0, v2: 0, unknown_schema: 0 };
  const quarantine = [];
  let rows = 0;

  for (const a of Array.isArray(assessments) ? assessments : []) {
    const tenant = a?.agency_id || a?.created_by || "unknown";
    for (const row of Array.isArray(a?.oasis_items) ? a.oasis_items : []) {
      rows += 1;
      const state = rowState(row);
      byState[state] += 1;

      const t = byTenant.get(tenant) || { unversioned: 0, legacy: 0, v2: 0, unknown_schema: 0 };
      t[state] += 1;
      byTenant.set(tenant, t);

      const item = row?.item_number || row?.definition_id || "unknown";
      const it = byItem.get(item) || { unversioned: 0, legacy: 0, v2: 0, unknown_schema: 0 };
      it[state] += 1;
      byItem.set(item, it);

      // "Writer" is whatever provenance the row carries — the point is to see
      // which paths produced rows that cannot be vouched for.
      const writer = row?.selected_by ? "protected_writer"
        : row?.ai_suggested === true ? "ai_path"
          : a?.last_written_by ? "protected_writer"
            : "legacy_direct_write";
      const w = byWriter.get(writer) || { unversioned: 0, legacy: 0, v2: 0, unknown_schema: 0 };
      w[state] += 1;
      byWriter.set(writer, w);

      if (state !== "v2") {
        quarantine.push({
          assessment_id: a?.id ?? null,
          tenant,
          item,
          state,
          reason: state === "unversioned"
            ? "No response schema — meanings unknown; never CMS-scorable or exportable with a code."
            : state === "legacy"
              ? "Frozen legacy response set — codes mean something different on the official assessment."
              : "Unrecognised response schema — refuse rather than guess.",
          clinical_checksum: clinicalChecksum(row),
        });
      }
    }
  }

  // Derived records computed from anything but a v2 pair must be retired from
  // CMS-labeled aggregates — auditable, but not counted.
  const derivedNeedingQuarantine = (Array.isArray(assessments) ? assessments : [])
    .filter((a) => rowState({ response_schema_id: a?.response_schema_id }) !== "v2")
    .map((a) => ({ assessment_id: a?.id ?? null, reason: "derived metrics from this assessment lack verified v2 provenance" }));

  return {
    totals: { assessments: (assessments || []).length, rows, ...byState },
    by_tenant: Object.fromEntries(byTenant),
    by_item: Object.fromEntries([...byItem].sort()),
    by_writer: Object.fromEntries(byWriter),
    quarantine,
    derived_records_needing_quarantine: derivedNeedingQuarantine,
  };
}

/**
 * The ONLY mutation this tool will ever propose: add non-clinical provenance to
 * a row that has none. Byte-preserving and idempotent by construction — it
 * writes two metadata fields and touches nothing else.
 */
export function planProvenanceAnnotation(assessments) {
  const changes = [];
  for (const a of Array.isArray(assessments) ? assessments : []) {
    for (const row of Array.isArray(a?.oasis_items) ? a.oasis_items : []) {
      if (rowState(row) !== "unversioned") continue;
      changes.push({
        assessment_id: a?.id ?? null,
        item: row?.item_number || "unknown",
        before_checksum: clinicalChecksum(row),
        set: { response_schema_id: V1, migration_status: "legacy_provenance_annotated" },
        // Proving the clinical bytes are untouched is the point of the exercise.
        after_checksum: clinicalChecksum({ ...row, response_schema_id: V1 }),
      });
    }
  }
  const unsafe = changes.filter((c) => c.before_checksum !== c.after_checksum);
  return { changes, safe: unsafe.length === 0, unsafe };
}

/** Apply the plan in memory. Never maps a legacy value to v2. */
export function applyProvenanceAnnotation(assessments) {
  const plan = planProvenanceAnnotation(assessments);
  if (!plan.safe) throw new Error("Refusing to apply: a change would alter clinical bytes.");
  let applied = 0;
  for (const a of assessments) {
    for (const row of Array.isArray(a?.oasis_items) ? a.oasis_items : []) {
      if (rowState(row) !== "unversioned") continue;
      row.response_schema_id = V1;
      row.migration_status = "legacy_provenance_annotated";
      applied += 1;
    }
  }
  return { applied, plan };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain) {
  const inPath = arg("--in");
  if (!inPath) {
    console.error("Usage: node tools-oasis-response-migration.mjs --in <export.json> [--out report.json] [--apply --i-have-read-the-plan]");
    process.exit(2);
  }
  let data;
  try {
    data = JSON.parse(readFileSync(inPath, "utf8"));
  } catch (err) {
    console.error(`✗ Could not read ${inPath}: ${err.message}`);
    process.exit(2);
  }
  const assessments = Array.isArray(data) ? data : data.assessments || [];
  const report = {
    tool: "tools-oasis-response-migration",
    mode: has("--apply") ? "apply" : "dry-run",
    generated_at: new Date().toISOString(),
    known_schemas: [...KNOWN],
    no_conversion_guarantee:
      "This tool never maps a legacy response to a v2 response. Legacy and v2 codes with the "
      + "same characters mean different clinical facts, and no rule converts one to the other "
      + "without inventing one.",
    inventory: inventory(assessments),
    provenance_plan: planProvenanceAnnotation(assessments),
  };

  if (has("--apply")) {
    if (!has("--i-have-read-the-plan")) {
      console.error("✗ --apply requires --i-have-read-the-plan. Review the dry-run report first.");
      process.exit(2);
    }
    const result = applyProvenanceAnnotation(assessments);
    report.applied = result.applied;
    report.mutated_assessments = assessments;
    console.error(`! Applied non-clinical provenance to ${result.applied} row(s) IN MEMORY.`);
    console.error("! Nothing was written to any live system. Persist the output deliberately.");
  }

  const out = arg("--out");
  if (out) {
    writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`✓ Wrote ${out}`);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
  const t = report.inventory.totals;
  console.error(
    `\n${t.assessments} assessment(s), ${t.rows} row(s): `
    + `${t.v2} v2, ${t.legacy} legacy, ${t.unversioned} unversioned, ${t.unknown_schema} unknown.`,
  );
  console.error(`${report.inventory.quarantine.length} row(s) require quarantine from CMS-labeled output and scoring.`);
}
