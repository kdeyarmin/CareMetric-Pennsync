// Adapter that folds the agency's `MedicareComplianceRule` records (when seeded)
// into the static required-element set. Pure + offline: it takes a plain array of
// rule records (fetched by the host via base44.entities.MedicareComplianceRule.list)
// and the static defaults from requiredElements.js, and returns a MERGED element
// list plus the list of rules that were applied (for the audit version stamp).
//
// Design contract (see plan + docs/NURSE_APP_IMPROVEMENTS.md #11):
//   - The static defaults are the GUARANTEED FLOOR. An empty / unseeded DB returns
//     them unchanged, so the offline experience never weakens.
//   - DB rules may only ADD elements, RAISE severity, and ENRICH an existing
//     element (keywords / examples / remediation). They can never remove an
//     element or downgrade a critical one.
import { getRequiredElements } from "./requiredElements.js";

// MedicareComplianceRule.category enum → our required-element id.
const CATEGORY_TO_ID = {
  homebound_status: "homebound",
  skilled_need: "skilled_need",
  patient_response: "patient_response",
  coordination_of_care: "idg_coordination",
  safety_assessment: "safety",
  functional_status: "functional_baseline",
  patient_education: "education",
  plan_of_care: "care_plan_progress",
  physician_orders: "physician_orders",
  infection_control: "infection_control", // no static default — added by a rule
};

// MedicareComplianceRule severity (critical|high|medium) → element severity
// (critical|required). Only "critical" gates; everything else is "required".
function mapSeverity(dbSeverity) {
  return dbSeverity === "critical" ? "critical" : "required";
}

function appliesToVisit(rule, visitType) {
  const v = rule.applies_to_visit_types;
  if (!Array.isArray(v) || v.length === 0) return true; // unscoped → all visit types
  return v.includes(visitType);
}

// A rule scoped to one service line must not leak into the other: seeding the
// home-health defaults used to inject homebound/skilled-need CRITICALS into
// hospice notes, hard-blocking them on requirements hospice does not have.
// Unscoped rules (agency-authored, pre-scoping records) still apply to both.
function appliesToService(rule, serviceLine) {
  const s = rule.service_line;
  if (!s || s === "both" || s === "all") return true;
  return s === serviceLine;
}

function dedupeKeywords(existing = [], incoming = []) {
  const seen = new Set(existing.map((k) => String(k).toLowerCase()));
  const out = [...existing];
  for (const k of incoming) {
    const key = String(k).toLowerCase();
    if (k && !seen.has(key)) {
      seen.add(key);
      out.push(k);
    }
  }
  return out;
}

function deriveQuestion(rule) {
  const els = Array.isArray(rule.required_elements) ? rule.required_elements.filter(Boolean) : [];
  if (els.length) return `Document ${rule.rule_name || "this requirement"}: ${els.join(", ")}.`;
  if (rule.description) return rule.description;
  return `Document ${rule.rule_name || "this required element"} for this visit.`;
}

// Enrich (in place) an existing static element with a matching rule — additive only.
function enrich(element, rule, sev) {
  if (Array.isArray(rule.keywords) && rule.keywords.length) {
    element.keywords = dedupeKeywords(element.keywords, rule.keywords);
  }
  if ((!element.examples || !element.examples.length) && Array.isArray(rule.examples_compliant) && rule.examples_compliant.length) {
    element.examples = rule.examples_compliant.slice();
  }
  if (!element.remediationGuidance && rule.remediation_guidance) {
    element.remediationGuidance = rule.remediation_guidance;
  }
  // Severity can only be RAISED, never lowered.
  if (sev === "critical" && element.severity !== "critical") {
    element.severity = "critical";
  }
}

const slugifyRuleName = (name) =>
  String(name || "rule")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "rule";

function createElement(id, rule, sev, inheritFrom) {
  return {
    id,
    // A rule that splits off its own element still belongs to the same
    // eligibility category, so it must inherit the traits that govern DETECTION
    // — most importantly negationSensitive, without which a negated mention
    // would count as evidence for the split-off requirement.
    ...(inheritFrom?.negationSensitive ? { negationSensitive: true } : {}),
    label: rule.rule_name || id,
    severity: sev,
    copReference: rule.cop_reference || "",
    keywords: Array.isArray(rule.keywords) ? rule.keywords.slice() : [],
    question: deriveQuestion(rule),
    notDocumentedPhrase: `${rule.rule_name || "This required element"} was not documented this visit.`,
    examples: Array.isArray(rule.examples_compliant) && rule.examples_compliant.length ? rule.examples_compliant.slice() : undefined,
    remediationGuidance: rule.remediation_guidance || undefined,
    carryForward: false,
    fromRule: true,
  };
}

/**
 * Merge active rules into the static required-element list for a service line +
 * visit type.
 * @returns {{ elements: Array, applied: Array<{rule_name, cop_reference, category, severity, effective_date}> }}
 */
export function buildMergedElements(rules, { serviceLine = "home_health", visitType = "routine_visit" } = {}) {
  // Clone so we never mutate the shared static definitions.
  const elements = getRequiredElements(serviceLine, visitType).map((e) => ({ ...e }));
  const applied = [];
  if (!Array.isArray(rules) || rules.length === 0) return { elements, applied };

  const byId = new Map(elements.map((e) => [e.id, e]));
  // Categories whose element has already absorbed a rule this build.
  const claimedCategories = new Set();
  for (const rule of rules) {
    if (!rule || rule.is_active === false) continue;
    if (!appliesToVisit(rule, visitType)) continue;
    if (!appliesToService(rule, serviceLine)) continue;
    const id = CATEGORY_TO_ID[rule.category];
    if (!id) continue;
    const sev = mapSeverity(rule.severity);
    const existing = byId.get(id);
    if (existing && !claimedCategories.has(rule.category)) {
      // First applicable rule for this category enriches the static element.
      claimedCategories.add(rule.category);
      enrich(existing, rule, sev);
    } else if (existing) {
      // A SECOND rule in the same category is a distinct requirement — its own
      // rule_name, cop_reference and required_elements. Merging its keywords into
      // the first rule's element let either rule's keyword satisfy both, so one
      // documented requirement marked the other one present too: a false PASS
      // that inflated the coverage score. Give it its own element instead. That
      // can surface a duplicate-looking question when two rules really do
      // describe the same thing, which is the safe direction to err in for a
      // gate whose failure mode is a denied claim.
      const splitId = `${id}__${slugifyRuleName(rule.rule_name)}`;
      if (!byId.has(splitId)) {
        const created = createElement(splitId, rule, sev, existing);
        byId.set(splitId, created);
        elements.push(created);
      } else {
        enrich(byId.get(splitId), rule, sev);
      }
    } else {
      claimedCategories.add(rule.category);
      const created = createElement(id, rule, sev);
      byId.set(id, created);
      elements.push(created);
    }
    applied.push({
      rule_name: rule.rule_name || "",
      cop_reference: rule.cop_reference || "",
      category: rule.category || "",
      severity: sev,
      effective_date: rule.effective_date || null,
    });
  }
  return { elements, applied };
}

/**
 * Build the `overrides` object `getRequiredElements(serviceLine, visitType, overrides)`
 * expects, plus the applied-rule list for the audit version stamp. Returns
 * `{ overrides: null, applied: [] }` when there are no rules, so the caller can
 * pass `overrides` straight through and fall back to the static defaults.
 */
export function buildOverrides(rules, ctx = {}) {
  const { serviceLine = "home_health", visitType = "routine_visit" } = ctx;
  const { elements, applied } = buildMergedElements(rules, { serviceLine, visitType });
  if (!applied.length) return { overrides: null, applied };
  return { overrides: { [serviceLine]: { [visitType]: elements } }, applied };
}
