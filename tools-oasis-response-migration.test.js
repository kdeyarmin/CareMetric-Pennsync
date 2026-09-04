import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  V1,
  V2,
  MigrationInputError,
  applyProvenanceAnnotation,
  canonicalJson,
  canonicalSha256,
  clinicalChecksum,
  inventory,
  planProvenanceAnnotation,
  protectedAssessmentSha256,
  rowState,
  validateAssessments,
  verifyDetachedPlan,
} from "./tools-oasis-response-migration.mjs";

const legacyRow = (overrides = {}) => ({ item_number: "M1830", response: "6", ...overrides });
const v2Row = (overrides = {}) => ({
  definition_id: "m1830_cms_e2",
  item_number: "M1830",
  item_name: "Bathing",
  item_source: "cms_item",
  item_spec_version: "oasis-e2",
  response_schema_id: V2,
  response_shape: "single",
  response_value: { code: "6" },
  response_origin: "clinician_selected",
  selected_by: "rn@agency.example",
  selected_at: "2026-09-04T11:30:00.000Z",
  ai_suggested: false,
  ...overrides,
});
const assessment = (id, overrides = {}) => ({
  id,
  agency_id: "agency-a",
  patient_id: `patient-${id}`,
  visit_type: "Start of Care",
  assessment_date: "2026-09-04",
  oasis_items: [legacyRow()],
  ...overrides,
});
const nativeV2Assessment = (id, overrides = {}) => assessment(id, {
  response_schema_id: V2,
  migration_status: "native_v2",
  instrument_version: "oasis-e2",
  response_schema_source: "final-oasis-e2-all-item-04-01-2026",
  last_written_by: "rn@agency.example",
  last_written_at: "2026-09-04T12:00:00.000Z",
  oasis_items: [v2Row()],
  ...overrides,
});
const sample = () => ([
  assessment("a1", { oasis_items: [legacyRow(), legacyRow({ item_number: "M1033", response: "2" })] }),
  assessment("a2", {
    response_schema_id: V1,
    migration_status: "legacy_unconverted",
    oasis_items: [legacyRow({ item_number: "M2420", response: "2", response_schema_id: V1 })],
  }),
  nativeV2Assessment("a3", {
    agency_id: "agency-b",
  }),
]);
const expectedDigests = (plan) => ({
  input_sha256: plan.input_sha256,
  plan_sha256: plan.plan_sha256,
});
const quarantineCodes = (plan, id) => plan.quarantined_assessments
  .find((entry) => entry.assessment_id === id)?.reason_codes || [];

test("rowState separates absent, known, unknown, and malformed schema values", () => {
  assert.equal(rowState({}), "unversioned");
  assert.equal(rowState({ response_schema_id: V1 }), "legacy");
  assert.equal(rowState({ response_schema_id: V2 }), "v2");
  assert.equal(rowState({ response_schema_id: "pennsync-oasis-response-v9" }), "unknown_schema");
  assert.equal(rowState({ response_schema_id: "" }), "malformed");
  assert.equal(rowState({ response_schema_id: null }), "malformed");
  assert.equal(rowState("not-an-object"), "malformed");
});

test("input is strictly a top-level array with unique ids and oasis_items arrays", () => {
  const invalid = [
    [{ assessments: [] }, /top-level JSON array/],
    [[{ agency_id: "agency-a", oasis_items: [] }], /exact, bounded, non-operator string id/],
    [[assessment("same"), assessment("same")], /Duplicate assessment id/],
    [[assessment("bad-items", { oasis_items: null })], /oasis_items array/],
  ];
  for (const [value, pattern] of invalid) {
    assert.throws(() => validateAssessments(value), pattern);
  }
});

test("assessment identifiers are exact, bounded, and never operator-shaped", () => {
  for (const id of [" padded", "$operator", "x".repeat(201)]) {
    assert.throws(
      () => validateAssessments([assessment(id)]),
      /exact, bounded, non-operator string id/,
    );
  }
});

test("canonical SHA-256 is stable across key order, full length, and content-sensitive", () => {
  const left = { z: [{ b: 2, a: 1 }], a: "value" };
  const right = { a: "value", z: [{ a: 1, b: 2 }] };
  assert.equal(canonicalJson(left), canonicalJson(right));
  assert.equal(canonicalSha256(left), canonicalSha256(right));
  assert.match(canonicalSha256(left), /^[a-f0-9]{64}$/);
  assert.notEqual(canonicalSha256(left), canonicalSha256({ ...right, a: "changed" }));
  const protoKey = JSON.parse('{"__proto__":{"polluted":true},"a":1}');
  assert.match(canonicalJson(protoKey), /"__proto__"/);
  assert.notEqual(canonicalSha256(protoKey), canonicalSha256({ a: 1 }));
  assert.equal({}.polluted, undefined);
});

test("canonical JSON rejects integers that cannot survive JSON parsing exactly", () => {
  for (const value of [Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1]) {
    assert.throws(() => canonicalJson({ value }), /unsafe integer/);
    assert.throws(() => canonicalSha256({ value }), /unsafe integer/);
  }
});

test("protected digest excludes only supported provenance destinations", () => {
  const original = assessment("protected");
  const annotated = structuredClone(original);
  annotated.response_schema_id = V1;
  annotated.migration_status = "legacy_provenance_annotated";
  annotated.oasis_items[0].response_schema_id = V1;
  assert.equal(protectedAssessmentSha256(original), protectedAssessmentSha256(annotated));
  assert.match(protectedAssessmentSha256(original), /^[a-f0-9]{64}$/);

  const clinicalEdit = structuredClone(annotated);
  clinicalEdit.oasis_items[0].response = "5";
  assert.notEqual(protectedAssessmentSha256(original), protectedAssessmentSha256(clinicalEdit));
  const unsupportedNestedStatus = structuredClone(annotated);
  unsupportedNestedStatus.oasis_items[0].migration_status = "legacy_provenance_annotated";
  assert.notEqual(protectedAssessmentSha256(original), protectedAssessmentSha256(unsupportedNestedStatus));
  assert.notEqual(clinicalChecksum(legacyRow()), clinicalChecksum({ ...legacyRow(), migration_status: "x" }));
});

test("inventory uses claimed_clinician_provenance rather than claiming a protected writer", () => {
  const result = inventory(sample());
  assert.equal(result.totals.assessments, 3);
  assert.equal(result.totals.rows, 4);
  assert.equal(result.totals.unversioned, 2);
  assert.equal(result.totals.legacy, 1);
  assert.equal(result.totals.v2, 1);
  assert.equal(result.by_writer.claimed_clinician_provenance.v2, 1);
  assert.equal(result.by_writer.legacy_direct_write.unversioned, 2);
  assert.equal(Object.hasOwn(result.by_writer, "protected_writer"), false);
  assert.equal(result.derived_records_needing_quarantine.length, 2);
});

test("native-v2 passthrough requires canonical definitions, source, shape, context, and provenance", () => {
  const cases = [
    ["missing-definition", (value) => { delete value.oasis_items[0].definition_id; }],
    ["unknown-definition", (value) => { value.oasis_items[0].definition_id = "m9999_cms_e2"; }],
    ["missing-source", (value) => { delete value.oasis_items[0].item_source; }],
    ["wrong-source", (value) => { value.oasis_items[0].item_source = "pennsync_screening"; }],
    ["wrong-shape", (value) => { value.oasis_items[0].response_shape = "multi_select"; }],
    ["invalid-value", (value) => { value.oasis_items[0].response_value = { code: "99" }; }],
    ["wrong-row-instrument", (value) => { value.oasis_items[0].item_spec_version = "oasis-e1"; }],
    ["wrong-assessment-instrument", (value) => { value.instrument_version = "oasis-e1"; }],
    ["unverified-source", (value) => { value.response_schema_source = "draft"; }],
    ["invalid-timepoint", (value) => { value.visit_type = "Transfer"; }],
    ["ai-origin", (value) => { value.oasis_items[0].ai_suggested = true; }],
    ["wrong-origin", (value) => { value.oasis_items[0].response_origin = "ai_suggested"; }],
    ["missing-clinician", (value) => { delete value.oasis_items[0].selected_by; }],
    ["bad-selection-time", (value) => { value.oasis_items[0].selected_at = "not-a-time"; }],
    ["screening-wearing-m-number", (value) => {
      value.oasis_items[0] = {
        ...value.oasis_items[0],
        definition_id: "ps_hospitalization_risk_tier",
        item_name: "Hospitalization risk tier",
        item_source: "pennsync_screening",
        item_spec_version: null,
        response_value: { code: "high" },
      };
    }],
  ];

  for (const [name, mutate] of cases) {
    const value = nativeV2Assessment(name);
    mutate(value);
    const result = inventory([value]);
    assert.equal(result.derived_records_needing_quarantine.length, 1, name);
    assert.ok(
      result.assessment_quarantine[0].reason_codes.includes("invalid_native_v2_provenance"),
      name,
    );
    const plan = planProvenanceAnnotation([value]);
    assert.equal(plan.changes.length, 0, name);
    assert.ok(quarantineCodes(plan, name).includes("invalid_native_v2_provenance"), name);
  }
});

test("a canonically labeled PennSync screening row remains v2 but never wears an M-number", () => {
  const row = {
    definition_id: "ps_hospitalization_risk_tier",
    item_number: null,
    item_name: "Hospitalization risk tier",
    item_source: "pennsync_screening",
    item_spec_version: null,
    response_schema_id: V2,
    response_shape: "single",
    response_value: { code: "high" },
    response_origin: "clinician_selected",
    selected_by: "rn@agency.example",
    selected_at: "2026-09-04T11:30:00.000Z",
    ai_suggested: false,
  };
  const value = nativeV2Assessment("screening", {
    visit_type: "Transfer",
    oasis_items: [row],
  });
  const result = inventory([value]);
  assert.equal(result.assessment_quarantine.length, 0);
  assert.equal(result.derived_records_needing_quarantine.length, 0);
  assert.equal(planProvenanceAnnotation([value]).changes.length, 0);
});

test("invalid tenant identifiers quarantine the whole assessment", () => {
  for (const agencyId of [" agency-a", "$agency", "a".repeat(201)]) {
    const value = assessment(`tenant-${agencyId.length}`, { agency_id: agencyId });
    const plan = planProvenanceAnnotation([value]);
    assert.ok(quarantineCodes(plan, value.id).includes("unscoped_tenant"));
    assert.equal(plan.changes.length, 0);
  }
});

test("plan stamps assessment metadata and only response_schema_id on rows", () => {
  const plan = planProvenanceAnnotation(sample());
  assert.match(plan.input_sha256, /^[a-f0-9]{64}$/);
  assert.match(plan.plan_sha256, /^[a-f0-9]{64}$/);
  assert.equal(plan.changes.length, 1);
  const change = plan.changes[0];
  assert.equal(change.assessment_id, "a1");
  assert.deepEqual(change.assessment_set, {
    response_schema_id: V1,
    migration_status: "legacy_provenance_annotated",
  });
  assert.equal(change.row_sets.length, 2);
  for (const rowSet of change.row_sets) {
    assert.deepEqual(rowSet.set, { response_schema_id: V1 });
    assert.equal(Object.hasOwn(rowSet.set, "migration_status"), false);
  }
  assert.equal(change.before_protected_sha256, change.after_protected_sha256);
  assert.match(change.before_protected_sha256, /^[a-f0-9]{64}$/);
});

test("homogeneous v1 rows with missing assessment metadata get assessment-only stamps", () => {
  const data = [assessment("row-v1", { oasis_items: [legacyRow({ response_schema_id: V1 })] })];
  const plan = planProvenanceAnnotation(data);
  assert.equal(plan.changes.length, 1);
  assert.deepEqual(plan.changes[0].assessment_set, {
    response_schema_id: V1,
    migration_status: "legacy_provenance_annotated",
  });
  assert.deepEqual(plan.changes[0].row_sets, []);
});

test("mixed v2 and unversioned rows quarantine the whole assessment with zero changes", () => {
  const data = [assessment("mixed", { oasis_items: [v2Row(), legacyRow()] })];
  const before = canonicalJson(data);
  const plan = planProvenanceAnnotation(data);
  assert.equal(plan.changes.length, 0);
  assert.ok(quarantineCodes(plan, "mixed").includes("mixed_schema_assessment"));
  const result = applyProvenanceAnnotation(data, plan, expectedDigests(plan));
  assert.equal(result.applied_assessments, 0);
  assert.equal(canonicalJson(data), before);
});

test("every heterogeneous row-state combination is treated as mixed", () => {
  const data = [
    assessment("legacy-unversioned", {
      oasis_items: [legacyRow({ response_schema_id: V1 }), legacyRow({ item_number: "M1840" })],
    }),
    assessment("legacy-v2", {
      oasis_items: [legacyRow({ response_schema_id: V1 }), v2Row({ item_number: "M1840" })],
    }),
  ];
  const plan = planProvenanceAnnotation(data);
  assert.equal(plan.changes.length, 0);
  assert.ok(quarantineCodes(plan, "legacy-unversioned").includes("mixed_schema_assessment"));
  assert.ok(quarantineCodes(plan, "legacy-v2").includes("mixed_schema_assessment"));
});

test("conflicting assessment and row schemas quarantine the whole assessment", () => {
  const data = [assessment("conflict", {
    response_schema_id: V2,
    migration_status: "native_v2",
    oasis_items: [legacyRow({ response_schema_id: V1 })],
  })];
  const plan = planProvenanceAnnotation(data);
  assert.equal(plan.changes.length, 0);
  assert.ok(quarantineCodes(plan, "conflict").includes("conflicting_schema_metadata"));
});

test("unknown response schemas quarantine the whole assessment", () => {
  const data = [assessment("unknown", {
    oasis_items: [legacyRow({ response_schema_id: "pennsync-oasis-response-v9" })],
  })];
  const plan = planProvenanceAnnotation(data);
  assert.equal(plan.changes.length, 0);
  assert.ok(quarantineCodes(plan, "unknown").includes("unknown_schema"));
});

test("malformed metadata, nested migration status, and empty rows quarantine", () => {
  const data = [
    assessment("bad-schema", { oasis_items: [legacyRow({ response_schema_id: null })] }),
    assessment("nested-status", { oasis_items: [legacyRow({ migration_status: "legacy_provenance_annotated" })] }),
    assessment("empty", { oasis_items: [] }),
  ];
  const plan = planProvenanceAnnotation(data);
  assert.equal(plan.changes.length, 0);
  for (const id of ["bad-schema", "nested-status", "empty"]) {
    assert.ok(quarantineCodes(plan, id).includes("malformed_assessment"));
  }
});

test("an assessment without explicit tenant scope is quarantined and unchanged", () => {
  const unscoped = assessment("unscoped");
  delete unscoped.agency_id;
  unscoped.created_by = "owner@example.com";
  const data = [unscoped];
  const before = canonicalJson(data);
  const plan = planProvenanceAnnotation(data);
  assert.ok(quarantineCodes(plan, "unscoped").includes("unscoped_tenant"));
  applyProvenanceAnnotation(data, { provenance_plan: plan }, expectedDigests(plan));
  assert.equal(canonicalJson(data), before, "created_by must never substitute for explicit tenant scope");
});

test("apply requires a detached exact plan and both manually carried digests", () => {
  const data = [assessment("apply")];
  const plan = planProvenanceAnnotation(data);
  assert.throws(() => applyProvenanceAnnotation(data), MigrationInputError);
  assert.throws(() => applyProvenanceAnnotation(data, plan), /expected input_sha256 and plan_sha256/);
  assert.throws(
    () => applyProvenanceAnnotation(data, plan, { ...expectedDigests(plan), plan_sha256: "0".repeat(64) }),
    /Expected plan_sha256/,
  );
  assert.equal(rowState(data[0].oasis_items[0]), "unversioned");
});

test("exact-plan verification rejects tampering even when the attacker rehashes it", () => {
  const data = [assessment("tamper")];
  const plan = planProvenanceAnnotation(data);
  const tampered = structuredClone(plan);
  tampered.changes[0].row_sets[0].item = "M9999";
  const { plan_sha256: ignored, ...unsigned } = tampered;
  void ignored;
  tampered.plan_sha256 = canonicalSha256(unsigned);
  const before = canonicalJson(data);
  assert.throws(
    () => verifyDetachedPlan(data, tampered, expectedDigests(tampered)),
    /exact plan for the current input/,
  );
  assert.equal(canonicalJson(data), before);
});

test("stale reviewed input is rejected before any mutation", () => {
  const data = [assessment("stale")];
  const plan = planProvenanceAnnotation(data);
  data[0].oasis_items[0].response = "5";
  const before = canonicalJson(data);
  assert.throws(
    () => applyProvenanceAnnotation(data, plan, expectedDigests(plan)),
    /Current input does not match/,
  );
  assert.equal(canonicalJson(data), before);
});

test("verified apply is byte-preserving outside provenance and a fresh plan is a no-op", () => {
  const data = [assessment("eligible"), nativeV2Assessment("v2")];
  const v2Before = canonicalJson(data[1]);
  const protectedBefore = data.map(protectedAssessmentSha256);
  const plan = planProvenanceAnnotation(data);
  const result = applyProvenanceAnnotation(data, { provenance_plan: plan }, expectedDigests(plan));
  assert.equal(result.applied_assessments, 1);
  assert.equal(result.applied_rows, 1);
  assert.equal(data[0].response_schema_id, V1);
  assert.equal(data[0].migration_status, "legacy_provenance_annotated");
  assert.equal(data[0].oasis_items[0].response_schema_id, V1);
  assert.equal(Object.hasOwn(data[0].oasis_items[0], "migration_status"), false);
  assert.equal(data[0].oasis_items[0].response, "6");
  assert.deepEqual(data.map(protectedAssessmentSha256), protectedBefore);
  assert.equal(canonicalJson(data[1]), v2Before);
  assert.equal(planProvenanceAnnotation(data).changes.length, 0);
});

test("a mixed dataset annotates eligible assessments without touching quarantined ones", () => {
  const quarantined = assessment("quarantined", { oasis_items: [v2Row(), legacyRow()] });
  const quarantinedBefore = canonicalJson(quarantined);
  const data = [assessment("eligible-among-many"), quarantined];
  const plan = planProvenanceAnnotation(data);
  const result = applyProvenanceAnnotation(data, plan, expectedDigests(plan));
  assert.equal(result.applied_assessments, 1);
  assert.equal(data[0].response_schema_id, V1);
  assert.equal(canonicalJson(data[1]), quarantinedBefore);
});

test("CLI refuses to overwrite its input even through equivalent relative paths", () => {
  const dir = mkdtempSync(join(tmpdir(), "oasis-migration-same-path-"));
  const input = join(dir, "input.json");
  const original = `${JSON.stringify([assessment("cli-same")], null, 2)}\n`;
  writeFileSync(input, original);
  const run = spawnSync(process.execPath, [
    "tools-oasis-response-migration.mjs", "--in", input, "--out", join(dir, ".", "input.json"),
  ], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /Refusing --out equal to --in/);
  assert.equal(readFileSync(input, "utf8"), original);
});

test("CLI same-file refusal also detects a distinct hard-link path", () => {
  const dir = mkdtempSync(join(tmpdir(), "oasis-migration-hard-link-"));
  const input = join(dir, "input.json");
  const hardLink = join(dir, "same-inode.json");
  const original = `${JSON.stringify([assessment("cli-hard-link")], null, 2)}\n`;
  writeFileSync(input, original);
  linkSync(input, hardLink);
  const run = spawnSync(process.execPath, [
    "tools-oasis-response-migration.mjs", "--in", input, "--out", hardLink,
  ], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /Refusing --out equal to --in/);
  assert.equal(readFileSync(input, "utf8"), original);
});

test("CLI rejects both raw JSON spellings at the unsafe-integer collision boundary", () => {
  const dir = mkdtempSync(join(tmpdir(), "oasis-migration-unsafe-integer-"));
  for (const [index, integer] of ["9007199254740992", "9007199254740993"].entries()) {
    const input = join(dir, `unsafe-${index}.json`);
    writeFileSync(
      input,
      `[{"id":"unsafe-${index}","agency_id":"agency-a","patient_id":"patient-a",`
        + `"visit_type":"Start of Care","assessment_date":"2026-09-04",`
        + `"oasis_items":[{"item_number":"M1830","response":${integer}}]}]\n`,
    );
    const run = spawnSync(process.execPath, [
      "tools-oasis-response-migration.mjs", "--in", input,
    ], { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(run.status, 2);
    assert.match(run.stderr, /unsafe integer/);
  }
});

test("CLI apply binds a prior report, input digest, and plan digest across invocations", () => {
  const dir = mkdtempSync(join(tmpdir(), "oasis-migration-binding-"));
  const input = join(dir, "input.json");
  const dryReport = join(dir, "dry-report.json");
  const appliedReport = join(dir, "applied-report.json");
  const appliedData = join(dir, "applied-data.json");
  const rerunReport = join(dir, "rerun-report.json");
  writeFileSync(input, `${JSON.stringify([assessment("cli-apply")], null, 2)}\n`);
  const dry = spawnSync(process.execPath, [
    "tools-oasis-response-migration.mjs", "--in", input, "--out", dryReport,
  ], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(dry.status, 0, dry.stderr);
  const reviewed = JSON.parse(readFileSync(dryReport, "utf8"));
  assert.equal(reviewed.input_sha256, reviewed.provenance_plan.input_sha256);
  assert.equal(reviewed.plan_sha256, reviewed.provenance_plan.plan_sha256);

  const apply = spawnSync(process.execPath, [
    "tools-oasis-response-migration.mjs",
    "--in", input,
    "--out", appliedReport,
    "--data-out", appliedData,
    "--apply",
    "--plan", dryReport,
    "--expect-input-sha256", reviewed.input_sha256,
    "--expect-plan-sha256", reviewed.plan_sha256,
    "--i-have-read-the-plan",
  ], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(apply.status, 0, apply.stderr);
  const applied = JSON.parse(readFileSync(appliedReport, "utf8"));
  const appliedDataBytes = readFileSync(appliedData);
  const annotated = JSON.parse(appliedDataBytes.toString("utf8"));
  assert.equal(applied.applied_assessments, 1);
  assert.equal(
    applied.data_output_sha256,
    createHash("sha256").update(appliedDataBytes).digest("hex"),
  );
  assert.equal(Object.hasOwn(applied, "mutated_assessments"), false);
  assert.equal(annotated[0].response_schema_id, V1);
  assert.equal(annotated[0].migration_status, "legacy_provenance_annotated");
  assert.deepEqual(annotated[0].oasis_items[0], {
    item_number: "M1830",
    response: "6",
    response_schema_id: V1,
  });
  assert.equal(statSync(dryReport).mode & 0o777, 0o600);
  assert.equal(statSync(appliedReport).mode & 0o777, 0o600);
  assert.equal(statSync(appliedData).mode & 0o777, 0o600);

  const rerun = spawnSync(process.execPath, [
    "tools-oasis-response-migration.mjs", "--in", appliedData, "--out", rerunReport,
  ], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(rerun.status, 0, rerun.stderr);
  const rerunResult = JSON.parse(readFileSync(rerunReport, "utf8"));
  assert.equal(rerunResult.provenance_plan.changes.length, 0);
  assert.equal(statSync(rerunReport).mode & 0o777, 0o600);
});

test("CLI never publishes an apply report when the secured data artifact cannot be created", () => {
  const dir = mkdtempSync(join(tmpdir(), "oasis-migration-data-first-"));
  const input = join(dir, "input.json");
  const dryReport = join(dir, "dry-report.json");
  const appliedReport = join(dir, "applied-report.json");
  const blockedData = join(dir, "blocked-data.json");
  const sentinel = "do-not-overwrite\n";
  writeFileSync(input, `${JSON.stringify([assessment("cli-data-first")], null, 2)}\n`);
  writeFileSync(blockedData, sentinel);

  const dry = spawnSync(process.execPath, [
    "tools-oasis-response-migration.mjs", "--in", input, "--out", dryReport,
  ], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(dry.status, 0, dry.stderr);
  const reviewed = JSON.parse(readFileSync(dryReport, "utf8"));

  const apply = spawnSync(process.execPath, [
    "tools-oasis-response-migration.mjs",
    "--in", input,
    "--out", appliedReport,
    "--data-out", blockedData,
    "--apply",
    "--plan", dryReport,
    "--expect-input-sha256", reviewed.input_sha256,
    "--expect-plan-sha256", reviewed.plan_sha256,
    "--i-have-read-the-plan",
  ], { cwd: process.cwd(), encoding: "utf8" });

  assert.equal(apply.status, 2);
  assert.match(apply.stderr, /Could not securely create applied assessment output/);
  assert.equal(readFileSync(blockedData, "utf8"), sentinel);
  assert.equal(existsSync(appliedReport), false);
});
