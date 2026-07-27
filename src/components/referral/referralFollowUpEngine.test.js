import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFollowUpPlan,
  sortFollowUpItems,
  buildProviderForm,
  providerFormToText,
  toPersistedFollowUp,
  applyRuleConfig,
  FOLLOW_UP_RULES,
} from "./referralFollowUpEngine.js";

const ids = (plan) => plan.items.map((i) => i.id);

// A referral that a 30-year coder would call "complete": coded dx with an
// acceptable primary, orders + frequency, F2F, homebound support, meds,
// insurance, institutional dates, functional detail.
const COMPLETE_REFERRAL = {
  demographics: {
    full_name: "Mary Test",
    referring_physician: "Dr. Adams, MD",
    insurance_primary: "Medicare",
    policy_numbers: "1AB2-CD3-EF45",
  },
  admission_details: {
    admission_source: "Hospital discharge",
    admission_date: "2026-06-28",
    referral_reason: "Post-CVA weakness; patient is homebound, leaving home requires taxing effort with rolling walker",
  },
  diagnoses: {
    primary_diagnosis: "CVA with left hemiplegia (I69.354)",
    primary_icd10: "I69.354",
    secondary_diagnoses: ["Type 2 diabetes E11.9", "CHF I50.9"],
    recent_hospitalizations: [{ date: "2026-06-20", reason: "CVA", length_of_stay: "8 days" }],
    past_medical_history: [{ condition: "Hypertension" }],
  },
  medications: [{ name: "Lisinopril", dosage: "10mg", frequency: "daily" }],
  skilled_needs: {
    services_ordered: ["SN", "PT"],
    frequency_duration: "SN 2wk9; PT 3wk4",
  },
  orders_treatments: { physician_orders: ["PT eval and treat", "SN for disease management"] },
  functional_status: {
    ambulation: "Ambulates 50 ft with rolling walker, standby assist",
    adl_status: "Moderate assistance with bathing and dressing",
    cognitive_status: "Alert, oriented x3",
  },
  face_to_face: {
    encounter_date: "2026-06-25",
    practitioner_name: "Dr. Adams",
    practitioner_type: "MD",
    clinical_reason: "CVA with hemiplegia requiring home PT and skilled nursing",
    documented_conditions: ["CVA", "hemiplegia"],
  },
};

test("a complete referral produces no critical items", () => {
  const plan = buildFollowUpPlan(COMPLETE_REFERRAL);
  assert.equal(plan.counts.critical, 0, JSON.stringify(ids(plan)));
  assert.ok(!ids(plan).includes("orders_missing"));
  assert.ok(!ids(plan).includes("homebound_undocumented"));
  assert.ok(!ids(plan).includes("no_icd_codes"));
  assert.ok(!ids(plan).includes("institutional_dates_missing"));
});

test("an empty referral flags the full condition-of-payment stack", () => {
  const plan = buildFollowUpPlan({});
  const found = ids(plan);
  for (const rule of [
    "f2f_missing",
    "orders_missing",
    "homebound_undocumented",
    "certifier_missing",
    "medications_missing",
    "insurance_missing",
    "no_icd_codes",
    "functional_detail_missing",
  ]) {
    assert.ok(found.includes(rule), `missing rule ${rule}`);
  }
  assert.ok(plan.counts.critical >= 3);
  assert.equal(plan.counts.total, plan.items.length);
});

test("symptom-code-only referral asks for a definitive principal diagnosis", () => {
  const plan = buildFollowUpPlan({
    ...COMPLETE_REFERRAL,
    diagnoses: { primary_icd10: "R26.9", secondary_diagnoses: [] },
  });
  assert.ok(ids(plan).includes("no_acceptable_primary"));
  const it = plan.items.find((i) => i.id === "no_acceptable_primary");
  assert.equal(it.severity, "critical");
  assert.match(it.needed, /R26\.9/);
});

test("acceptable-but-unmapped primary is an agency note, not a provider request", () => {
  // I63.9 is RTP-acceptable but absent from this replace-semantics agency map:
  // the fix is the PDGM Rate Settings page, so no provider item may fire.
  const plan = buildFollowUpPlan(
    { ...COMPLETE_REFERRAL, diagnoses: { ...COMPLETE_REFERRAL.diagnoses, secondary_diagnoses: [] } },
    { icdGroups: { Q99: "MMTA_Other" } }
  );
  assert.ok(!ids(plan).includes("no_acceptable_primary"), JSON.stringify(ids(plan)));
  assert.equal(plan.internal_notes.length, 1);
  assert.match(plan.internal_notes[0], /PDGM Rate Settings/);
  assert.match(plan.internal_notes[0], /I69\.354/);
});

test("uncoded diagnoses become a comorbidity-capture request naming each dx", () => {
  const plan = buildFollowUpPlan({
    ...COMPLETE_REFERRAL,
    diagnoses: {
      ...COMPLETE_REFERRAL.diagnoses,
      secondary_diagnoses: ["Generalized weakness", "Chronic kidney disease"],
    },
  });
  const it = plan.items.find((i) => i.id === "uncoded_diagnoses");
  assert.ok(it);
  assert.match(it.needed, /Chronic kidney disease/);
  assert.equal(it.category, "reimbursement");
});

test("institutional admission source without stay dates is flagged for case-mix", () => {
  const plan = buildFollowUpPlan({
    ...COMPLETE_REFERRAL,
    diagnoses: { ...COMPLETE_REFERRAL.diagnoses, recent_hospitalizations: [] },
  });
  const it = plan.items.find((i) => i.id === "institutional_dates_missing");
  assert.ok(it);
  assert.equal(it.category, "reimbursement");
  assert.match(it.impact, /community/i);
});

test("missing frequency/duration flags 409.43 even when orders exist", () => {
  const plan = buildFollowUpPlan({
    ...COMPLETE_REFERRAL,
    skilled_needs: { services_ordered: ["SN"], frequency_duration: "" },
  });
  const it = plan.items.find((i) => i.id === "frequency_missing");
  assert.ok(it);
  assert.match(it.citation, /409\.43/);
});

test("non-compliant F2F is surfaced with the validator's reasons", () => {
  const plan = buildFollowUpPlan({
    ...COMPLETE_REFERRAL,
    face_to_face: {
      ...COMPLETE_REFERRAL.face_to_face,
      practitioner_type: "DC", // chiropractor — not an allowed certifier
    },
  });
  const it = plan.items.find((i) => i.id === "f2f_invalid");
  assert.ok(it);
  assert.match(it.citation, /424\.22/);
});

test("unspecified principal diagnosis draws a specificity request", () => {
  const plan = buildFollowUpPlan({
    ...COMPLETE_REFERRAL,
    diagnoses: {
      ...COMPLETE_REFERRAL.diagnoses,
      primary_diagnosis: "Heart failure, unspecified (I50.9)",
      primary_icd10: "I50.9",
      secondary_diagnoses: [],
    },
  });
  assert.ok(ids(plan).includes("unspecified_primary"));
});

test("every item carries what/why/citation/impact and a provider request", () => {
  const plan = buildFollowUpPlan({});
  for (const it of plan.items) {
    for (const field of ["title", "needed", "why", "citation", "impact"]) {
      assert.ok(it[field] && it[field].length > 0, `${it.id} missing ${field}`);
    }
    assert.ok(it.provider_request?.question?.length > 0, `${it.id} missing provider question`);
    assert.ok(["compliance", "reimbursement"].includes(it.category));
    assert.ok(["critical", "high", "medium"].includes(it.severity));
  }
});

test("sortFollowUpItems orders severity first, compliance before reimbursement", () => {
  const sorted = sortFollowUpItems(buildFollowUpPlan({}).items);
  const sevRank = { critical: 0, high: 1, medium: 2 };
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    assert.ok(
      sevRank[a.severity] < sevRank[b.severity] ||
        (sevRank[a.severity] === sevRank[b.severity] &&
          (a.category === b.category || a.category === "compliance")),
      `${a.id} should sort before ${b.id}`
    );
  }
});

test("items without seq (AI additions) sort after rule items in the same band", () => {
  const plan = buildFollowUpPlan({});
  const firstCritical = sortFollowUpItems(plan.items).find((i) => i.severity === "critical");
  const aiItem = {
    id: "ai_0",
    source: "ai",
    category: firstCritical.category,
    severity: "critical",
    title: "AI addition",
    needed: "x",
    why: "y",
    citation: "z",
    impact: "w",
    provider_request: { question: "q", response_type: "text", hint: "" },
  };
  const sorted = sortFollowUpItems([aiItem, ...plan.items]);
  const band = sorted.filter((i) => i.severity === "critical" && i.category === firstCritical.category);
  assert.equal(band[band.length - 1].id, "ai_0"); // appended, not jumped ahead
});

// ── provider form ──

test("buildProviderForm numbers sections and personalizes the intro", () => {
  const plan = buildFollowUpPlan({});
  const form = buildProviderForm(
    {
      patientName: "Mary Test",
      patientDob: "1941-02-03",
      agencyName: "PennSync Home Health",
      contactBackFax: "(555) 012-3456",
    },
    plan.items
  );
  assert.match(form.intro, /Mary Test/);
  assert.match(form.intro, /PennSync Home Health/);
  assert.match(form.intro, /\(555\) 012-3456/);
  assert.equal(form.sections.length, plan.items.length);
  assert.deepEqual(form.sections.map((s) => s.number), form.sections.map((_, i) => i + 1));
  // Every section keeps the "what + why" pairing the provider needs.
  for (const s of form.sections) {
    assert.ok(s.request.length > 0);
    assert.ok(s.why.length > 0);
  }
});

test("providerFormToText renders response lines and a signature block", () => {
  const plan = buildFollowUpPlan({});
  const txt = providerFormToText(buildProviderForm({ patientName: "M T" }, plan.items));
  assert.match(txt, /Additional Information Request/);
  assert.match(txt, /WHY WE NEED IT/);
  assert.match(txt, /RESPONSE/);
  assert.match(txt, /Document attached/); // document-type items get a checkbox
  assert.match(txt, /Practitioner signature/);
});

// ── agency rule configuration ──

test("FOLLOW_UP_RULES catalog matches the rule ids the engine can emit", () => {
  const emitted = new Set(buildFollowUpPlan({}).items.map((i) => i.id));
  const catalog = new Set(FOLLOW_UP_RULES.map((r) => r.id));
  for (const id of emitted) assert.ok(catalog.has(id), `rule ${id} missing from catalog`);
});

test("ruleConfig disables rules, overrides severity, and appends custom items", () => {
  const plan = buildFollowUpPlan({}, {
    ruleConfig: {
      disabled_rules: ["medications_missing"],
      severity_overrides: { insurance_missing: "critical", bogus_rule: "high", homebound_undocumented: "not_a_severity" },
      custom_items: [
        { title: "Wound photos", question: "Please attach current wound photos.", category: "compliance", severity: "high", why: "Agency wound program requirement." },
        { title: "", question: "ignored — no title" },
      ],
    },
  });
  const byId = Object.fromEntries(plan.items.map((i) => [i.id, i]));
  assert.equal(byId.medications_missing, undefined);
  assert.equal(byId.insurance_missing.severity, "critical");
  assert.equal(byId.homebound_undocumented.severity, "high"); // invalid override ignored
  assert.equal(byId.custom_0.source, "agency");
  assert.equal(byId.custom_0.provider_request.question, "Please attach current wound photos.");
  assert.equal(byId.custom_1, undefined); // titleless custom item dropped
  // counts reflect the configured item set
  assert.equal(plan.counts.total, plan.items.length);
});

test("applyRuleConfig is a no-op without a config", () => {
  const items = buildFollowUpPlan({}).items;
  assert.deepEqual(applyRuleConfig(items, null), items);
});

test("custom items sort after built-in rules but before AI additions", () => {
  const plan = buildFollowUpPlan({}, {
    ruleConfig: { custom_items: [{ title: "T", question: "Q", severity: "critical", category: "compliance" }] },
  });
  const ai = { id: "ai_0", source: "ai", severity: "critical", category: "compliance", title: "AI", needed: "n", why: "w", citation: "c", impact: "i", provider_request: { question: "q" } };
  const sorted = sortFollowUpItems([ai, ...plan.items]).filter((i) => i.severity === "critical" && i.category === "compliance");
  const idxCustom = sorted.findIndex((i) => i.id === "custom_0");
  const idxAi = sorted.findIndex((i) => i.id === "ai_0");
  const lastRule = Math.max(...sorted.map((i, idx) => (i.source === "rules" ? idx : -1)));
  assert.ok(idxCustom > lastRule && idxCustom < idxAi);
});

// ── portal link on the provider form ──

test("provider form advertises the online response portal when a link is supplied", () => {
  const plan = buildFollowUpPlan({});
  const form = buildProviderForm({ patientName: "M T", portalLink: "https://x.example/followup?token=abc" }, plan.items);
  assert.match(form.intro, /RESPOND ONLINE/);
  assert.match(form.intro, /token=abc/);
  const withoutLink = buildProviderForm({ patientName: "M T" }, plan.items);
  assert.ok(!/RESPOND ONLINE/.test(withoutLink.intro));
});

// ── persistence ──

test("toPersistedFollowUp produces the lean sorted Referral shape", () => {
  const plan = buildFollowUpPlan({});
  const persisted = toPersistedFollowUp(plan, {
    generatedAt: "2026-07-02T12:00:00Z",
    status: "sent",
    sentVia: "fax",
    faxLogId: "fx1",
    portalLink: "https://x.example/followup?token=abc",
  });
  assert.equal(persisted.status, "sent");
  assert.equal(persisted.generated_at, "2026-07-02T12:00:00Z");
  assert.equal(persisted.sent_via, "fax");
  assert.equal(persisted.fax_log_id, "fx1");
  // Capability-token hygiene: the PLAINTEXT link must never be persisted on
  // the Referral — only the fact that a link is active.
  assert.equal(persisted.portal_link, undefined);
  assert.equal(persisted.portal_link_active, true);
  // Per-item lifecycle starts open with no response.
  assert.equal(persisted.items[0].item_status, "open");
  assert.equal(persisted.items[0].response, null);
  assert.equal(persisted.items.length, plan.items.length);
  assert.deepEqual(persisted.counts, plan.counts);
  // Sorted: first item must be critical severity.
  assert.equal(persisted.items[0].severity, "critical");
  // No engine-internal fields leak into persistence.
  assert.equal(persisted.items[0].seq, undefined);
  assert.equal(toPersistedFollowUp(null), null);
});
