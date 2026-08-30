import test from "node:test";
import assert from "node:assert/strict";
import {
  computeCoverageScore,
  toNoteConversionFields,
  deriveStructuredVisitFields,
} from "./coverageScore.js";

const reqs = [
  { id: "homebound", severity: "critical" },
  { id: "skilled_need", severity: "critical" },
  { id: "vitals", severity: "required" },
  { id: "pain", severity: "required" },
];

test("all present => 100", () => {
  const presence = reqs.map((e) => ({ id: e.id, present: true }));
  assert.equal(computeCoverageScore({ requiredElements: reqs, presenceResults: presence }), 100);
});

test("half present => 50", () => {
  const presence = [
    { id: "homebound", present: true },
    { id: "skilled_need", present: true },
    { id: "vitals", present: false },
    { id: "pain", present: false },
  ];
  assert.equal(computeCoverageScore({ requiredElements: reqs, presenceResults: presence }), 50);
});

test("answers and confirmed negatives count as covered", () => {
  const presence = [
    { id: "homebound", present: true },
    { id: "skilled_need", present: false },
    { id: "vitals", present: false },
    { id: "pain", present: false },
  ];
  const score = computeCoverageScore({
    requiredElements: reqs,
    presenceResults: presence,
    answeredIds: ["skilled_need", "vitals"],
    confirmedNegativeIds: ["pain"],
  });
  assert.equal(score, 100);
});

test("compliance_improvement is the real after-minus-before delta", () => {
  const fields = toNoteConversionFields({
    coverageScore: 90,
    draftPresenceScore: 60,
    roughLen: 100,
    enhancedLen: 400,
    visitType: "routine_visit",
    diagnosis: "CHF",
    nurseEmail: "n@x.com",
    patientId: "p1",
  });
  assert.equal(fields.rough_note_compliance, 60);
  assert.equal(fields.enhanced_note_compliance, 90);
  assert.equal(fields.compliance_improvement, 30);
  assert.equal(fields.quality_score, 90);
});

test("structured visit fields flip with homebound/skilled coverage", () => {
  const presence = [
    { id: "homebound", present: true, evidence: "Patient is homebound due to taxing effort." },
    { id: "skilled_need", present: false, evidence: null },
  ];
  const fields = deriveStructuredVisitFields(presence, { answeredIds: ["skilled_need"] });
  assert.equal(fields.homebound_status_verified, true);
  assert.equal(fields.skilled_intervention_documented, true); // answered
  assert.match(fields.homebound_justification, /taxing effort/);
});

// ── Regression: service-line-aware structured fields (2026-07 review) ───────

test("hospice visits derive skilled_intervention_documented from comfort_skilled_need", () => {
  const presence = [
    { id: "comfort_skilled_need", present: true, evidence: "Skilled comfort assessment." },
    { id: "symptom_management", present: true, evidence: "Pain managed." },
  ];
  const out = deriveStructuredVisitFields(presence, {});
  assert.equal(out.skilled_intervention_documented, true, "a documented comfort skilled need must count");
  assert.equal(out.homebound_status_verified, true, "no homebound element in the hospice set — nothing can be missing");
});

test("a home-health visit still reports a genuinely missing skilled need", () => {
  const presence = [
    { id: "skilled_need", present: false, evidence: null },
    { id: "homebound", present: false, evidence: null },
  ];
  const out = deriveStructuredVisitFields(presence, {});
  assert.equal(out.skilled_intervention_documented, false);
  assert.equal(out.homebound_status_verified, false);
});

// ── Structured Visit fields are QUALITY-aware, not just presence-aware ──────
import { runDenialGuardrail } from "../../compliance/denialGuardrailEngine.js";
import { getRequiredElements } from "./requiredElements.js";
import { detectPresence } from "./presenceDetection.js";

const hhPresence = (ids) =>
  getRequiredElements("home_health", "routine_visit").map((e) => ({
    id: e.id,
    label: e.label,
    severity: e.severity,
    present: ids.includes(e.id),
    evidence: ids.includes(e.id) ? `${e.label} documented` : null,
  }));

test("a conclusory homebound narrative does not persist as verified", () => {
  const note = "Patient is homebound. Provided nursing care this visit.";
  const denialFindings = runDenialGuardrail({
    noteText: note, serviceLine: "home_health", visitType: "routine_visit",
  }).findings;

  const presence = hhPresence(["homebound", "skilled_need"]);
  // Presence alone still counts it as covered — that is the coverage question.
  assert.equal(
    deriveStructuredVisitFields(presence, {}).homebound_status_verified,
    true,
  );
  // But the chart field, which dashboards read as "eligibility is met", is withheld.
  const structured = deriveStructuredVisitFields(presence, { denialFindings });
  assert.equal(structured.homebound_status_verified, false);
  assert.equal(structured.skilled_intervention_documented, false);
});

test("a specific narrative still persists as verified", () => {
  const note = [
    "Patient is homebound due to severe exertional dyspnea and requires a walker with one-person assist to ambulate.",
    "Skilled wound care: sterile dressing change to the stage 3 sacral ulcer for management of the wound.",
  ].join(" ");
  const denialFindings = runDenialGuardrail({
    noteText: note, serviceLine: "home_health", visitType: "routine_visit",
  }).findings;
  const structured = deriveStructuredVisitFields(hhPresence(["homebound", "skilled_need"]), { denialFindings });
  assert.equal(structured.homebound_status_verified, true);
  assert.equal(structured.skilled_intervention_documented, true);
});

test("guardrail findings can only withhold a claim, never grant one", () => {
  // Nothing documented → not covered. A passing guardrail must not flip it true.
  const denialFindings = runDenialGuardrail({
    noteText: "Patient is homebound due to dyspnea; requires a walker and assistance of one. Sterile dressing change for management of the wound.",
    serviceLine: "home_health", visitType: "routine_visit",
  }).findings;
  const structured = deriveStructuredVisitFields(hhPresence([]), { denialFindings });
  assert.equal(structured.homebound_status_verified, false);
  assert.equal(structured.skilled_intervention_documented, false);
});

test("the guardrail veto does not fire on documentation the detector accepts", () => {
  // Regression: the veto is only sound while the guardrail's homebound
  // vocabulary matches presenceDetection's. When it didn't, this well-documented
  // note — accepted by the detector — was vetoed to `false`.
  const note =
    "Patient unable to leave home due to severe dyspnea and requires a walker with one-person assistance. "
    + "Skilled wound care with a sterile dressing change for management of the sacral wound.";
  const elements = getRequiredElements("home_health", "routine_visit");
  const presence = detectPresence(note, elements);
  assert.equal(presence.find((p) => p.id === "homebound").present, true, "detector accepts this note");

  const denialFindings = runDenialGuardrail({
    noteText: note, serviceLine: "home_health", visitType: "routine_visit",
  }).findings;
  const structured = deriveStructuredVisitFields(presence, { denialFindings });
  assert.equal(structured.homebound_status_verified, true);
  assert.equal(structured.skilled_intervention_documented, true);
});
