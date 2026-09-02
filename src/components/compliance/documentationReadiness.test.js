import test from "node:test";
import assert from "node:assert/strict";
import {
  READINESS_DISCLAIMER,
  READINESS_STATUSES,
  assessDocumentationReadiness,
} from "./documentationReadiness.js";

const NOW = new Date("2026-08-31T12:00:00.000Z");
const daysBefore = (n) => new Date(NOW.getTime() - n * 86400000).toISOString().slice(0, 10);
const CLEAN_VISIT = {
  id: "v1",
  nurse_notes: "A complete note.",
  emr_handoff_status: "signed_in_emr",
  homebound_status_verified: true,
  skilled_intervention_documented: true,
  grounding_pending: false,
};

const has = (result, id) => result.findings.some((f) => f.id === id);
const get = (result, id) => result.findings.find((f) => f.id === id);

// ── The language guardrails ────────────────────────────────────────────────

test("readiness never uses billing language", () => {
  const labels = Object.values(READINESS_STATUSES).map((s) => s.label).join(" ").toLowerCase();
  for (const forbidden of ["ready to bill", "billable", "payable", "claim approved", "medicare compliant"]) {
    assert.ok(!labels.includes(forbidden), `status labels must not say "${forbidden}"`);
  }
});

test("the three mandated statuses exist with the mandated wording", () => {
  assert.equal(READINESS_STATUSES.clear.label, "No PennSync issues detected");
  assert.equal(READINESS_STATUSES.review.label, "Review recommended");
  assert.equal(READINESS_STATUSES.action.label, "Action needed");
});

test("the disclaimer names every system PennSync does not replace", () => {
  for (const system of ["EMR", "billing system", "agency QA", "pre-bill review"]) {
    assert.ok(READINESS_DISCLAIMER.includes(system), `disclaimer must name "${system}"`);
  }
  const result = assessDocumentationReadiness({ visits: [CLEAN_VISIT], now: NOW });
  assert.equal(result.disclaimer, READINESS_DISCLAIMER, "every result carries the disclaimer");
});

// ── Clean case ─────────────────────────────────────────────────────────────

const ALL_DATA = {
  visits: [CLEAN_VISIT],
  drafts: [],
  complianceAudits: [],
  openTasks: [],
  oasisFindings: [],
  adrCases: [],
  incidents: [],
  handoffTrackingSince: daysBefore(30),
};

test("a fully documented, handed-off visit reports clear over a complete dataset", () => {
  const result = assessDocumentationReadiness({ ...ALL_DATA, now: NOW });
  assert.equal(result.status.id, "clear");
  assert.deepEqual(result.findings, []);
  assert.equal(result.counts.total, 0);
  assert.equal(result.complete, true, "every check ran");
  assert.deepEqual(result.notChecked, []);
  assert.ok(result.checked.length >= 8, "the checks run are listed even when nothing is found");
});

test("a dataset the caller did not supply is reported as NOT checked", () => {
  // Passing three datasets must not look like having checked eight: "clear"
  // over a partial dataset is a different claim from "clear" over a complete one.
  const result = assessDocumentationReadiness({
    visits: [CLEAN_VISIT], openTasks: [], incidents: [], now: NOW,
  });
  assert.equal(result.complete, false);
  assert.ok(result.notChecked.some((c) => /drafts/i.test(c)));
  assert.ok(result.notChecked.some((c) => /compliance findings/i.test(c)));
  assert.ok(result.notChecked.some((c) => /OASIS/i.test(c)));
  assert.ok(result.notChecked.some((c) => /ADR/i.test(c)));
  assert.ok(!result.checked.some((c) => /drafts/i.test(c)), "an unrun check is not listed as run");
});

// ── "Nothing known" is not "nothing wrong" ─────────────────────────────────

test("no documentation at all is reported, not passed silently", () => {
  const result = assessDocumentationReadiness({ now: NOW });
  assert.equal(result.status.id, "review");
  assert.ok(has(result, "no_documentation"));
  assert.match(get(result, "no_documentation").detail, /may exist only in the EMR/i);
});

// ── Individual checks ──────────────────────────────────────────────────────

test("an unfinished draft is action needed", () => {
  const result = assessDocumentationReadiness({
    ...ALL_DATA,
    drafts: [{ id: "d1", note: "Rough note still being written, more than twenty characters." }],
    now: NOW,
  });
  assert.equal(result.status.id, "action");
  assert.deepEqual(get(result, "unfinished_draft").records, ["d1"]);
});

test("a trivial draft is not counted as unfinished work", () => {
  const result = assessDocumentationReadiness({
    ...ALL_DATA, drafts: [{ id: "d1", note: "hi" }], now: NOW,
  });
  assert.equal(has(result, "unfinished_draft"), false);
});

test("a visit with no reported EMR handoff is review, and says PennSync cannot see the EMR", () => {
  const result = assessDocumentationReadiness({
    ...ALL_DATA,
    visits: [{ ...CLEAN_VISIT, emr_handoff_status: "not_started", visit_date: daysBefore(3) }],
    now: NOW,
  });
  assert.equal(result.status.id, "review");
  assert.match(get(result, "emr_handoff_missing").detail, /PennSync cannot see the EMR/i);
});

test("a flagged homebound or skilled-need signal is action needed", () => {
  const homebound = assessDocumentationReadiness({
    ...ALL_DATA, visits: [{ ...CLEAN_VISIT, homebound_status_verified: false }], now: NOW,
  });
  assert.equal(homebound.status.id, "action");
  assert.match(get(homebound, "homebound_support").detail, /Potential\s+Medicare documentation gap/i);

  const skilled = assessDocumentationReadiness({
    ...ALL_DATA, visits: [{ ...CLEAN_VISIT, skilled_intervention_documented: false }], now: NOW,
  });
  assert.ok(has(skilled, "skilled_need_support"));
});

test("an acknowledged critical finding is not reported as unresolved", () => {
  const unresolved = assessDocumentationReadiness({
    ...ALL_DATA, complianceAudits: [{ id: "a1", status: "critical" }], now: NOW,
  });
  assert.equal(unresolved.status.id, "action");

  // ComplianceAudit.acknowledgment has no `acknowledged` boolean — the schema
  // and persistVisitNote store acknowledged_by / acknowledged_at / justification
  // / finding_ids. Keying off a field that never exists left every acknowledged
  // critical finding permanently unresolved.
  const resolved = assessDocumentationReadiness({
    ...ALL_DATA,
    complianceAudits: [{
      id: "a1",
      status: "critical",
      acknowledgment: { acknowledged_by: "nurse@example.com", acknowledged_at: NOW.toISOString() },
    }],
    now: NOW,
  });
  assert.equal(resolved.status.id, "clear");
});

test("a deferred grounding pass is surfaced as an incomplete verification trail", () => {
  const result = assessDocumentationReadiness({
    ...ALL_DATA, visits: [{ ...CLEAN_VISIT, grounding_pending: true }], now: NOW,
  });
  assert.match(get(result, "grounding_pending").detail, /deterministic value guard ran/i);
});

test("an open provider follow-up never implies the provider was contacted", () => {
  const result = assessDocumentationReadiness({
    ...ALL_DATA,
    openTasks: [{ id: "t1", title: "Notify provider: wound decline", status: "pending" }],
    now: NOW,
  });
  assert.match(get(result, "provider_followup_open").detail, /does not mean the provider was contacted/i);
});

test("an OASIS inconsistency points corrections back at the EMR", () => {
  const result = assessDocumentationReadiness({
    ...ALL_DATA, oasisFindings: [{ id: "o1" }], now: NOW,
  });
  assert.match(get(result, "oasis_inconsistency").detail, /official assessment in the EMR/i);
});

test("open ADR cases are action needed; closed ones are not reported", () => {
  const open = assessDocumentationReadiness({
    ...ALL_DATA, adrCases: [{ id: "c1", status: "letter_uploaded" }], now: NOW,
  });
  assert.equal(open.status.id, "action");

  const closed = assessDocumentationReadiness({
    ...ALL_DATA, adrCases: [{ id: "c1", status: "closed" }], now: NOW,
  });
  assert.equal(closed.status.id, "clear");
});

test("the recertification window opens late in the episode and points at the EMR", () => {
  const late = assessDocumentationReadiness({
    ...ALL_DATA, patient: { admission_date: daysBefore(55) }, now: NOW,
  });
  assert.match(get(late, "recertification_due").detail, /complete it in your EMR/i);

  const mid = assessDocumentationReadiness({
    ...ALL_DATA, patient: { admission_date: daysBefore(20) }, now: NOW,
  });
  assert.equal(has(mid, "recertification_due"), false);
});

test("a discharged patient is not chased for recertification", () => {
  const result = assessDocumentationReadiness({
    ...ALL_DATA,
    patient: { admission_date: daysBefore(55), discharge_date: daysBefore(2) },
    now: NOW,
  });
  assert.equal(has(result, "recertification_due"), false);
});

// ── Aggregation ────────────────────────────────────────────────────────────

test("the worst finding sets the overall status", () => {
  const result = assessDocumentationReadiness({
    ...ALL_DATA,
    visits: [{
      ...CLEAN_VISIT, emr_handoff_status: "not_started",
      homebound_status_verified: false, visit_date: daysBefore(3),
    }],
    now: NOW,
  });
  assert.equal(result.status.id, "action", "an action finding outranks a review finding");
  assert.equal(result.counts.action, 1);
  assert.equal(result.counts.review, 1);
  assert.equal(result.counts.total, 2);
});

test("every finding carries a status, a title, and an explanation to drill into", () => {
  const result = assessDocumentationReadiness({
    ...ALL_DATA,
    visits: [{
      ...CLEAN_VISIT, emr_handoff_status: "not_started",
      skilled_intervention_documented: false, visit_date: daysBefore(3),
    }],
    openTasks: [{ id: "t1", title: "Notify physician of new order", status: "pending" }],
    now: NOW,
  });
  for (const f of result.findings) {
    assert.ok(["action", "review"].includes(f.status), `${f.id} needs a status`);
    assert.ok(f.title, `${f.id} needs a title`);
    assert.ok(f.detail, `${f.id} needs an explanation`);
  }
});

test("assessment is deterministic for the same inputs", () => {
  const args = { ...ALL_DATA, drafts: [{ id: "d", note: "x".repeat(40) }], now: NOW };
  assert.deepEqual(assessDocumentationReadiness(args), assessDocumentationReadiness(args));
});

test("junk input never throws", () => {
  assert.doesNotThrow(() => assessDocumentationReadiness());
  assert.doesNotThrow(() => assessDocumentationReadiness({ visits: [null], drafts: [undefined], now: NOW }));
  assert.doesNotThrow(() => assessDocumentationReadiness({ ...ALL_DATA, visits: [null], now: NOW }));
});


// ── Legacy data and enum correctness ───────────────────────────────────────

test("visits documented before handoff tracking began are not a backlog", () => {
  // Handoff tracking started when the feature shipped; a pre-existing visit has
  // no emr_handoff_status because the workflow did not exist, not because
  // anyone skipped a step. Treating those as outstanding turned a 1,000-visit
  // history into a fabricated backlog on first open.
  const legacy = { ...CLEAN_VISIT, id: "old", emr_handoff_status: undefined, visit_date: daysBefore(200) };
  const result = assessDocumentationReadiness({
    ...ALL_DATA, visits: [legacy], handoffTrackingSince: daysBefore(30), now: NOW,
  });
  assert.equal(has(result, "emr_handoff_missing"), false);
});

test("a visit after the tracking start date IS in scope", () => {
  const recent = { ...CLEAN_VISIT, id: "new", emr_handoff_status: undefined, visit_date: daysBefore(3) };
  const result = assessDocumentationReadiness({
    ...ALL_DATA, visits: [recent], handoffTrackingSince: daysBefore(30), now: NOW,
  });
  assert.deepEqual(get(result, "emr_handoff_missing").records, ["new"]);
});

test("without a tracking start date the handoff check does not run, and says so", () => {
  const result = assessDocumentationReadiness({
    ...ALL_DATA,
    visits: [{ ...CLEAN_VISIT, emr_handoff_status: undefined }],
    handoffTrackingSince: null,
    now: NOW,
  });
  assert.equal(has(result, "emr_handoff_missing"), false);
  assert.ok(result.notChecked.some((c) => /handoff-tracking start date/i.test(c)));
  assert.equal(result.complete, false);
});

test("an archived incident is terminal, not outstanding work", () => {
  // Incident.status terminal states are `resolved` and `archived`; there is no
  // `closed`. Matching a value the enum does not contain reported every
  // archived incident as unresolved.
  const archived = assessDocumentationReadiness({
    ...ALL_DATA, incidents: [{ id: "i1", status: "archived" }], now: NOW,
  });
  assert.equal(has(archived, "incident_open"), false);

  const resolved = assessDocumentationReadiness({
    ...ALL_DATA, incidents: [{ id: "i1", status: "resolved" }], now: NOW,
  });
  assert.equal(has(resolved, "incident_open"), false);

  const open = assessDocumentationReadiness({
    ...ALL_DATA, incidents: [{ id: "i1", status: "under_review" }], now: NOW,
  });
  assert.equal(has(open, "incident_open"), true);
});
