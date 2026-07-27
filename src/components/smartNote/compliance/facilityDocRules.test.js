import test from 'node:test';
import assert from 'node:assert/strict';
import {
  patientMatchesCondition,
  ruleAppliesToVisit,
  ruleSatisfiedByNote,
  evaluateFacilityRules,
  summarizeFacilityRules,
  sortFacilityResults,
  patientHasWound,
} from './facilityDocRules.js';

const diabeticPatient = {
  primary_diagnosis: 'Type 2 Diabetes Mellitus',
  chronic_conditions: [{ condition: 'Hypertension' }],
  current_medications: [{ name: 'Metformin 500mg' }, { name: 'Lisinopril' }],
  care_type: 'home_health',
};

const oxygenPatient = {
  primary_diagnosis: 'COPD',
  secondary_diagnoses: ['Chronic respiratory failure'],
  current_medications: [{ name: 'Home oxygen 2L via nasal cannula' }],
  care_type: 'home_health',
};

const woundPatient = {
  primary_diagnosis: 'Pressure ulcer',
  wounds: [{ location: 'sacrum', stage: 'III' }],
  care_type: 'home_health',
};

test('patientMatchesCondition: always applies to anyone', () => {
  assert.equal(patientMatchesCondition({ condition_type: 'always' }, {}), true);
  assert.equal(patientMatchesCondition({ condition_type: 'always' }, null), true);
});

test('patientMatchesCondition: diagnosis_keyword matches across diagnosis fields', () => {
  const rule = { condition_type: 'diagnosis_keyword', condition_keywords: ['diabet'] };
  assert.equal(patientMatchesCondition(rule, diabeticPatient), true);
  assert.equal(patientMatchesCondition(rule, oxygenPatient), false);
});

test('patientMatchesCondition: medication_keyword matches oxygen on the med list', () => {
  const rule = { condition_type: 'medication_keyword', condition_keywords: ['oxygen', 'o2'] };
  assert.equal(patientMatchesCondition(rule, oxygenPatient), true);
  assert.equal(patientMatchesCondition(rule, diabeticPatient), false);
});

test('patientMatchesCondition: has_wound keys off a non-empty wounds array', () => {
  assert.equal(patientHasWound(woundPatient), true);
  assert.equal(patientMatchesCondition({ condition_type: 'has_wound' }, woundPatient), true);
  assert.equal(patientMatchesCondition({ condition_type: 'has_wound' }, diabeticPatient), false);
});

test('patientMatchesCondition: care_type matches hospice vs home_health', () => {
  const rule = { condition_type: 'care_type', condition_care_type: 'hospice' };
  assert.equal(patientMatchesCondition(rule, { care_type: 'hospice' }), true);
  assert.equal(patientMatchesCondition(rule, { care_type: 'home_health' }), false);
});

test('patientMatchesCondition: care_type never matches when either side is unset', () => {
  // Rule missing condition_care_type must NOT match a patient with no care_type
  // (would otherwise collapse to "" === "" → true).
  assert.equal(patientMatchesCondition({ condition_type: 'care_type' }, { primary_diagnosis: 'CHF' }), false);
  assert.equal(patientMatchesCondition({ condition_type: 'care_type' }, {}), false);
  // Rule with a care type must not match a patient lacking one.
  assert.equal(patientMatchesCondition({ condition_type: 'care_type', condition_care_type: 'hospice' }, {}), false);
});

test('ruleAppliesToVisit: empty list = all visits, otherwise membership', () => {
  assert.equal(ruleAppliesToVisit({}, 'routine_visit'), true);
  assert.equal(ruleAppliesToVisit({ applies_to_visit_types: [] }, 'discharge'), true);
  assert.equal(ruleAppliesToVisit({ applies_to_visit_types: ['admission'] }, 'admission'), true);
  assert.equal(ruleAppliesToVisit({ applies_to_visit_types: ['admission'] }, 'routine_visit'), false);
});

test('ruleSatisfiedByNote: present/absent/advisory tri-state', () => {
  const rule = { required_keywords: ['spo2', 'o2 sat', 'pulse ox'] };
  assert.equal(ruleSatisfiedByNote(rule, 'SpO2 96% on room air'), true);
  assert.equal(ruleSatisfiedByNote(rule, 'patient resting comfortably'), false);
  // no required keywords => cannot auto-verify => advisory (null)
  assert.equal(ruleSatisfiedByNote({ required_keywords: [] }, 'anything'), null);
});

test('evaluateFacilityRules: returns only applicable rules with satisfaction', () => {
  const rules = [
    {
      rule_name: 'Oxygen SpO2',
      condition_type: 'medication_keyword',
      condition_keywords: ['oxygen'],
      required_keywords: ['spo2', 'o2 sat'],
      severity: 'high',
    },
    {
      rule_name: 'Diabetic blood sugar',
      condition_type: 'diagnosis_keyword',
      condition_keywords: ['diabet'],
      required_keywords: ['blood sugar', 'glucose', 'bg '],
      severity: 'critical',
    },
    {
      rule_name: 'Wound measurements',
      condition_type: 'has_wound',
      required_keywords: ['cm', 'measur'],
      severity: 'high',
    },
    { rule_name: 'Inactive', condition_type: 'always', is_active: false },
  ];

  // Oxygen patient, note WITHOUT an SpO2 -> the oxygen rule applies and is missing.
  const res = evaluateFacilityRules({
    rules,
    patient: oxygenPatient,
    noteText: 'Patient reports mild dyspnea on exertion. Lungs with scattered wheezes.',
    visitType: 'routine_visit',
  });
  assert.equal(res.length, 1);
  assert.equal(res[0].rule.rule_name, 'Oxygen SpO2');
  assert.equal(res[0].missing, true);

  // Same patient, note WITH SpO2 -> satisfied, not missing.
  const res2 = evaluateFacilityRules({
    rules,
    patient: oxygenPatient,
    noteText: 'SpO2 94% on 2L. Dyspnea improved.',
    visitType: 'routine_visit',
  });
  assert.equal(res2[0].missing, false);
  assert.equal(res2[0].satisfied, true);

  // Diabetic patient without a glucose value -> critical miss.
  const res3 = evaluateFacilityRules({
    rules,
    patient: diabeticPatient,
    noteText: 'Reviewed medications, no changes.',
    visitType: 'routine_visit',
  });
  assert.equal(res3.length, 1);
  assert.equal(res3[0].rule.rule_name, 'Diabetic blood sugar');
  assert.equal(res3[0].rule.severity, 'critical');
  assert.equal(res3[0].missing, true);
});

test('summarizeFacilityRules + sortFacilityResults: counts and ordering', () => {
  const results = [
    { rule: { rule_name: 'b', severity: 'high' }, applies: true, satisfied: true, missing: false },
    { rule: { rule_name: 'a', severity: 'critical' }, applies: true, satisfied: false, missing: true },
    { rule: { rule_name: 'c', severity: 'low' }, applies: true, satisfied: null, missing: false },
  ];
  const summary = summarizeFacilityRules(results);
  assert.equal(summary.applicable, 3);
  assert.equal(summary.missing, 1);
  assert.equal(summary.missingCritical, 1);
  assert.equal(summary.satisfied, 1);
  assert.equal(summary.advisory, 1);

  const sorted = sortFacilityResults(results);
  assert.equal(sorted[0].rule.rule_name, 'a'); // missing critical first
});

// ── Regression: word-boundary keyword satisfaction (2026-07 review) ─────────

test("a short keyword is not satisfied by an unrelated containing word", () => {
  const rule = { required_keywords: ["cm"] };
  assert.equal(ruleSatisfiedByNote(rule, "Reviewed CMS guidelines with caregiver."), false);
  assert.equal(ruleSatisfiedByNote(rule, "Wound measures 4 x 5 cm today."), true);
});
