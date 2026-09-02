import test from "node:test";
import assert from "node:assert/strict";
import {
  clinicalChecksum, rowState, inventory, planProvenanceAnnotation, applyProvenanceAnnotation,
} from "./tools-oasis-response-migration.mjs";

const V1 = "pennsync-oasis-response-v1-legacy";
const V2 = "pennsync-oasis-response-v2-cms-e2";

const sample = () => ([
  {
    id: "a1", agency_id: "agencyA", assessment_date: "2026-05-01", visit_type: "Start of Care",
    oasis_items: [
      { item_number: "M1830", response: "6" },
      { item_number: "M1033", response: "2" },
    ],
  },
  {
    id: "a2", agency_id: "agencyA", assessment_date: "2026-06-01", visit_type: "Discharge",
    response_schema_id: V1,
    oasis_items: [{ item_number: "M2420", response: "2", response_schema_id: V1 }],
  },
  {
    id: "a3", agency_id: "agencyB", assessment_date: "2026-06-15", visit_type: "Discharge",
    response_schema_id: V2, last_written_by: "rn@b.com",
    oasis_items: [{
      definition_id: "m1830_cms_e2", item_number: "M1830", item_source: "cms_item",
      response_schema_id: V2, response_value: { code: "6" },
      response_origin: "clinician_selected", selected_by: "rn@b.com",
    }],
  },
]);

test("rowState separates unversioned, legacy, v2 and unknown", () => {
  assert.equal(rowState({}), "unversioned");
  assert.equal(rowState({ response_schema_id: V1 }), "legacy");
  assert.equal(rowState({ response_schema_id: V2 }), "v2");
  assert.equal(rowState({ response_schema_id: "pennsync-oasis-response-v9" }), "unknown_schema");
});

test("inventory reports by tenant, item, writer and schema state", () => {
  const inv = inventory(sample());
  assert.equal(inv.totals.assessments, 3);
  assert.equal(inv.totals.rows, 4);
  assert.equal(inv.totals.unversioned, 2);
  assert.equal(inv.totals.legacy, 1);
  assert.equal(inv.totals.v2, 1);
  assert.equal(inv.by_tenant.agencyA.unversioned, 2);
  assert.equal(inv.by_tenant.agencyB.v2, 1);
  assert.equal(inv.by_writer.protected_writer.v2, 1);
  assert.equal(inv.by_writer.legacy_direct_write.unversioned, 2);
  assert.ok(inv.by_item.M1830);
});

test("every non-v2 row is listed for quarantine WITH a reason", () => {
  const inv = inventory(sample());
  assert.equal(inv.quarantine.length, 3);
  for (const q of inv.quarantine) {
    assert.ok(q.reason.length > 0, "a quarantined row must say why");
    assert.ok(q.clinical_checksum, "a quarantined row records its clinical checksum");
    assert.notEqual(q.state, "v2");
  }
  // Derived records without verified v2 provenance are named too.
  assert.equal(inv.derived_records_needing_quarantine.length, 2);
});

test("the plan never maps a legacy value to v2 and never alters clinical bytes", () => {
  const data = sample();
  const plan = planProvenanceAnnotation(data);
  assert.equal(plan.safe, true);
  assert.equal(plan.unsafe.length, 0);
  assert.equal(plan.changes.length, 2, "only the unversioned rows are touched");
  for (const c of plan.changes) {
    assert.equal(c.before_checksum, c.after_checksum, "clinical bytes must be identical");
    // The ONLY fields it sets are non-clinical provenance.
    assert.deepEqual(Object.keys(c.set).sort(), ["migration_status", "response_schema_id"]);
    assert.equal(c.set.response_schema_id, V1, "a legacy row is never annotated as v2");
  }
});

test("applying is idempotent and byte-preserving", () => {
  const data = sample();
  const before = data.map((a) => a.oasis_items.map(clinicalChecksum));
  const first = applyProvenanceAnnotation(data);
  const second = applyProvenanceAnnotation(data);
  assert.equal(first.applied, 2);
  assert.equal(second.applied, 0, "a second run must be a no-op");
  const after = data.map((a) => a.oasis_items.map(clinicalChecksum));
  assert.deepEqual(after, before, "no clinical byte may change");
  // Annotated rows are legacy, never promoted.
  assert.equal(data[0].oasis_items[0].response_schema_id, V1);
  assert.equal(data[0].oasis_items[0].response, "6", "the stored response is untouched");
  assert.equal(data[0].oasis_items[0].response_value, undefined, "no v2 value is invented");
});

test("an already-v2 row is never rewritten", () => {
  const data = sample();
  const v2Row = data[2].oasis_items[0];
  const snapshot = JSON.stringify(v2Row);
  applyProvenanceAnnotation(data);
  assert.equal(JSON.stringify(v2Row), snapshot);
});

test("the checksum covers the clinical fields, not the provenance", () => {
  const row = { item_number: "M1830", response: "6" };
  const same = clinicalChecksum({ ...row, response_schema_id: V1, migration_status: "legacy_provenance_annotated" });
  assert.equal(clinicalChecksum(row), same, "provenance must not move the checksum");
  assert.notEqual(clinicalChecksum(row), clinicalChecksum({ ...row, response: "5" }), "a response change must move it");
});
