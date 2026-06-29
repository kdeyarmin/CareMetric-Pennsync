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
