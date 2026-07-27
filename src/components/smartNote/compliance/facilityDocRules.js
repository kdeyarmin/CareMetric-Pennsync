// Pure, framework-free evaluation of facility-specific documentation rules.
//
// A facility (often driven by a state survey finding) can require that certain
// documentation appears in EVERY note for patients who match a condition — e.g.
// "any patient on oxygen must have an SpO2 in every note", "diabetic patients must
// document a blood sugar", "any wound must have measurements". Admins author these
// as FacilityDocumentationRule records; this module decides, for the current
// patient + note, which rules apply and which are still unsatisfied.
//
// Kept free of React and the Base44 SDK so it is unit-tested (node --test) and
// shared by the nurse-facing checklist and the pre-review nudge. Detection is
// deterministic keyword/field matching — it never fabricates content, it only
// flags what the nurse still needs to write.

function lc(s) {
  return String(s == null ? "" : s).toLowerCase();
}

// Flatten everything about a patient that can indicate a diagnosis/condition into
// one lowercase haystack for keyword matching.
export function patientDiagnosisText(patient) {
  if (!patient) return "";
  const parts = [];
  if (patient.primary_diagnosis) parts.push(patient.primary_diagnosis);
  if (Array.isArray(patient.secondary_diagnoses)) parts.push(patient.secondary_diagnoses.join(" "));
  if (Array.isArray(patient.chronic_conditions)) {
    parts.push(patient.chronic_conditions.map((c) => (c && c.condition) || "").join(" "));
  }
  if (Array.isArray(patient.past_medical_history)) parts.push(patient.past_medical_history.join(" "));
  return lc(parts.join(" "));
}

export function patientMedicationText(patient) {
  if (!patient || !Array.isArray(patient.current_medications)) return "";
  return lc(patient.current_medications.map((m) => (m && m.name) || "").join(" "));
}

export function patientHasWound(patient) {
  return !!(patient && Array.isArray(patient.wounds) && patient.wounds.length > 0);
}

function anyKeyword(haystack, keywords) {
  if (!Array.isArray(keywords) || keywords.length === 0) return false;
  return keywords.some((k) => {
    const t = lc(k).trim();
    return t.length > 0 && haystack.includes(t);
  });
}

/** Whether a rule's condition matches this patient. */
export function patientMatchesCondition(rule, patient) {
  if (!rule) return false;
  switch (rule.condition_type) {
    case "always":
      return true;
    case "has_wound":
      return patientHasWound(patient);
    case "diagnosis_keyword":
      return anyKeyword(patientDiagnosisText(patient), rule.condition_keywords);
    case "medication_keyword":
      return anyKeyword(patientMedicationText(patient), rule.condition_keywords);
    case "care_type": {
      // Require a concrete care type on BOTH sides — otherwise an unset
      // condition_care_type vs a patient with no care_type collapses to
      // "" === "" and the rule would match every incomplete record.
      const want = lc(rule.condition_care_type);
      const have = lc(patient && patient.care_type);
      return want.length > 0 && have === want;
    }
    default:
      return false;
  }
}

/** Whether a rule applies to the current visit type (empty list = all visits). */
export function ruleAppliesToVisit(rule, visitType) {
  const list = rule && rule.applies_to_visit_types;
  if (!Array.isArray(list) || list.length === 0) return true;
  return list.map(lc).includes(lc(visitType));
}

/**
 * Whether the note satisfies a rule.
 * @returns {true | false | null} true = a required keyword is present;
 *   false = required keywords defined but none present; null = no required
 *   keywords to detect, so satisfaction can't be auto-verified (advisory).
 */
export function ruleSatisfiedByNote(rule, noteText) {
  const keywords = rule && rule.required_keywords;
  if (!Array.isArray(keywords) || keywords.length === 0) return null;
  // Word-boundary matching, not raw substrings: the keyword "cm" was satisfied
  // by "CMS guidelines", falsely marking a wound-measurement requirement
  // documented (a false PASS on a facility requirement). Admin-authored
  // keywords are whole words/phrases; boundaries also make the old
  // trailing-space workaround ("bg ") unnecessary while keeping it working.
  const text = lc(noteText);
  return keywords.some((k) => {
    const t = lc(k).trim();
    if (!t) return false;
    return new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
  });
}

/**
 * Evaluate all facility rules for the current patient/note/visit.
 * @returns {{ rule, applies, satisfied, missing }[]} — only the rules that apply
 *   (patient condition + visit type + active) are returned. `missing` is true
 *   when the rule applies and is definitively NOT satisfied (satisfied === false).
 * @param {{ rules?: any[], patient?: any, noteText?: string, visitType?: string }} [opts]
 */
export function evaluateFacilityRules({ rules, patient, noteText = "", visitType } = {}) {
  const list = Array.isArray(rules) ? rules : [];
  const out = [];
  for (const rule of list) {
    if (!rule || rule.is_active === false) continue;
    if (!ruleAppliesToVisit(rule, visitType)) continue;
    if (!patientMatchesCondition(rule, patient)) continue;
    const satisfied = ruleSatisfiedByNote(rule, noteText);
    out.push({ rule, applies: true, satisfied, missing: satisfied === false });
  }
  return out;
}

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

/** Sort evaluated results: unmet first, then by severity, then name. */
export function sortFacilityResults(results) {
  return [...(results || [])].sort((a, b) => {
    if (a.missing !== b.missing) return a.missing ? -1 : 1;
    const sa = SEVERITY_ORDER[a.rule?.severity] ?? 1;
    const sb = SEVERITY_ORDER[b.rule?.severity] ?? 1;
    if (sa !== sb) return sa - sb;
    return lc(a.rule?.rule_name).localeCompare(lc(b.rule?.rule_name));
  });
}

/** Count summary for the checklist header + pre-review nudge. */
export function summarizeFacilityRules(results) {
  const applicable = results || [];
  const missing = applicable.filter((r) => r.missing);
  return {
    applicable: applicable.length,
    missing: missing.length,
    missingCritical: missing.filter((r) => r.rule?.severity === "critical").length,
    satisfied: applicable.filter((r) => r.satisfied === true).length,
    advisory: applicable.filter((r) => r.satisfied === null).length,
  };
}
