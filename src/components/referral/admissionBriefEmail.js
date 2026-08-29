// Admission-briefing email builder for the referral analyzer.
//
// Assembles the complete plain-text briefing an intake coordinator emails to
// the admitting nurse after a referral is analyzed: patient snapshot, alerts,
// PDGM-sequenced diagnoses, what's ordered, medications, the payer-optimized
// visit plan (ordered frequencies verbatim when present; otherwise the AI's
// planning estimate — the same precedence visitPlanEstimator enforces),
// Medicare coverage snapshot, draft OASIS responses, the sample admission
// narrative, still-needed items, and links to the source referral + admission
// packet — so the nurse doesn't have to read the entire referral.
//
// Deliberate constraints:
//   - SUBJECT carries patient INITIALS only (subjects surface in inbox
//     previews/notifications outside the mail body).
//   - No case-mix weights and no dollar figures — payer/LUPA guidance is
//     phrased as scheduling instructions (the app's financial-visibility rule).
//   - Every AI-derived section is labeled to verify against the source.
//
// Pure + offline (unit-tested with `node --test`); no React, no Base44 SDK,
// no `@/` imports so the colocated Node test resolves without Vite.

import { buildVisitPlan, formatOrder, DISCIPLINE_NAMES } from "./visitPlanEstimator.js";
import { generateDiagnosisCodes, codeLabel } from "./diagnosisCodeGenerator.js";
import { assessMedicareEligibility } from "./medicareEligibility.js";
import { referralToF2FInput, validateFaceToFace } from "./faceToFaceValidator.js";
import { buildSocVisitPrep, socVisitPrepLines } from "./socVisitPrep.js";
import { collectComorbidityCapture } from "./comorbidityCapture.js";

const MAX_MEDICATIONS = 15;

const clean = (v) => {
  const s = String(v ?? "").trim();
  if (!s) return "";
  return /^not documented( in referral)?\.?$/i.test(s) || /^unknown$/i.test(s) || /^n\/?a$/i.test(s) ? "" : s;
};

/** "Jane Q. Doe" → "J.D." — subjects must not carry the full patient name. */
export function patientInitials(fullName) {
  const parts = clean(fullName).split(/[\s,]+/).filter(Boolean);
  if (parts.length === 0) return "patient";
  // "Last, First" order still yields both initials; single names yield one.
  const initials = [parts[0], parts.length > 1 ? parts[parts.length - 1] : ""]
    .filter(Boolean)
    .map((p) => p[0].toUpperCase());
  return `${initials.join(".")}.`;
}

/** "m1800_grooming" → "M1800 Grooming"; "gg0170_mobility" → "GG0170 Mobility";
 *  other keys humanize plainly. */
export function oasisItemLabel(key) {
  const m = /^(m|gg)(\d{4}[a-z]?)_(.+)$/i.exec(String(key || ""));
  const rest = (m ? m[3] : String(key || "")).replace(/_/g, " ");
  const title = rest.replace(/\b\w/g, (c) => c.toUpperCase());
  return m ? `${m[1].toUpperCase()}${m[2].toUpperCase()} ${title}` : title;
}

/** Render one OASIS draft value as briefing text. Objects (the GG item groups,
 *  M1311 wound counts) render as "A. Eating: 04 …" entries instead of JSON. */
export function formatOasisValue(value) {
  if (value == null) return "";
  if (typeof value === "string") return clean(value);
  if (Array.isArray(value)) return value.join("; ");
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([k, v]) => {
        const s = typeof v === "string" ? clean(v) : v == null ? "" : String(v);
        if (!s) return "";
        const label = k
          .replace(/^([a-z]{1,2})_/i, (_, p) => `${p.toUpperCase()}. `)
          .replace(/_/g, " ");
        return `${label}: ${s}`;
      })
      .filter(Boolean)
      .join(" · ");
  }
  return String(value);
}

// The full documented GG scale: 06–01 performance codes plus the
// activity-not-attempted codes (07 refused, 09 not applicable, 10 environmental
// limitation, 88 medical condition/safety) — exactly the scale the extraction
// prompt specifies.
const GG_VALID_CODES = new Set(["01", "02", "03", "04", "05", "06", "07", "09", "10", "88"]);

/**
 * Deterministic audit of the AI-drafted Section GG items: flags any code
 * outside the documented GG scale, and any code drafted without the quoted
 * referral basis the extraction prompt requires — so a fabricated or malformed
 * draft can never read as a clean pre-fill in the briefs.
 */
export function auditGgDraft(oasis = {}) {
  const issues = [];
  for (const groupKey of ["gg0130_self_care", "gg0170_mobility"]) {
    const group = oasis?.[groupKey];
    if (!group || typeof group !== "object" || Array.isArray(group)) continue;
    for (const [itemKey, raw] of Object.entries(group)) {
      const s = clean(raw);
      if (!s) continue;
      const label = `${oasisItemLabel(groupKey)} — ${itemKey
        .replace(/^([a-z]{1,2})_/i, (_, p) => `${p.toUpperCase()}. `)
        .replace(/_/g, " ")}`;
      const m = /^(\d{1,2})\s*(?:-\s*(.*))?$/.exec(s);
      const code = m ? m[1].padStart(2, "0") : null;
      if (!code || !GG_VALID_CODES.has(code)) {
        issues.push(`${label}: "${s}" is not on the GG scale (01–06, 07, 09, 10, 88) — ignore this draft and score at SOC.`);
      } else if (!m[2] || !m[2].trim()) {
        issues.push(`${label}: code ${code} was drafted without a quoted basis from the referral — verify before use.`);
      }
    }
  }
  return issues;
}

function section(title, lines) {
  const body = (Array.isArray(lines) ? lines : [lines]).map((l) => String(l ?? "")).filter((l) => l.trim());
  if (body.length === 0) return null;
  return `== ${title} ==\n${body.join("\n")}`;
}

const bullet = (label, value) => {
  const v = clean(value);
  return v ? `- ${label}: ${v}` : "";
};

/** Nurse-relevant payer scheduling notes (no weights, no dollars). */
function payerSchedulingNotes(plan) {
  const notes = [];
  if (plan.payer.payer === "medicare_ffs") {
    notes.push(
      "Medicare FFS (PDGM): the 60-day cert bills as two 30-day periods. Keep EACH period at or above its LUPA visit threshold (2–6 visits depending on grouping — all disciplines count) or the period drops to per-visit payment."
    );
    for (const l of plan.lupa || []) {
      notes.push(`Period ${l.period}${l.estimate ? " (estimate)" : ""}: ${l.message}`);
    }
    notes.push("Front-load week 1–2 for clinical stability; added visits beyond clinical need do not increase the period payment.");
  } else if (plan.payer.payer === "medicare_advantage") {
    notes.push("Medicare Advantage: confirm prior authorization and the approved visit counts BEFORE the SOC visit; visits beyond the auth are unpaid. Coverage criteria mirror Medicare (homebound, skilled need, F2F).");
  } else if (plan.payer.payer === "medicaid") {
    notes.push("Medicaid: verify state coverage/authorization before SOC; match scheduled visits to the authorized amount.");
  } else if (plan.payer.payer === "commercial") {
    notes.push("Commercial plan: verify benefits, visit limits, and authorization before SOC; track authorized visit counts per discipline.");
  } else {
    notes.push("Payer not identified from the referral — intake is verifying coverage; confirm before scheduling beyond the SOC visit.");
  }
  return notes;
}

/**
 * Build the admission-briefing email.
 *
 * @param {object} params
 * @param {object} params.referralData   extracted referral (referralExtraction.js shape)
 * @param {object} [params.analysis]     ReferralAnalyzer AI result (patient_summary,
 *   visit_estimates, risk_flags, scheduling_recommendations, missing_information, …)
 * @param {string} [params.admissionNote] sample admission narrative to embed
 *   (falls back to referralData.admission_note_template)
 * @param {string} [params.sourceFileUrl] URL of the uploaded referral document
 * @param {string} [params.packetUrl]     URL of the generated admission packet PDF
 * @param {string} [params.nurseName]     recipient display name
 * @param {string} [params.senderName]    intake coordinator display name
 * @returns {{ subject: string, body: string }}
 */
export function buildAdmissionBriefEmail({
  referralData,
  analysis = null,
  admissionNote = "",
  sourceFileUrl = "",
  packetUrl = "",
  nurseName = "",
  senderName = "",
} = {}) {
  const ex = referralData?.extracted_data || referralData || {};
  const demo = ex.demographics || {};
  const dx = ex.diagnoses || {};
  const plan = buildVisitPlan(referralData || {}, analysis?.visit_estimates);
  // The diagnosis harvester expects the extraction at the top level, so hand it
  // the unwrapped shape (the visit-plan/eligibility modules unwrap themselves).
  const coding = generateDiagnosisCodes(ex);
  const f2fInput = referralToF2FInput(referralData);
  const f2f = f2fInput ? validateFaceToFace(f2fInput) : null;
  const eligibility = assessMedicareEligibility(referralData || {}, f2f);
  const summary = analysis?.patient_summary || {};

  const fullName = clean(demo.full_name) || "the patient";
  const subject = `Admission briefing: ${patientInitials(demo.full_name)} — home health SOC`;

  const sections = [];

  // ── header ──
  sections.push(
    [
      "CONFIDENTIAL — PROTECTED HEALTH INFORMATION. For the assigned care team only.",
      "AI-assisted briefing generated from the uploaded referral — verify all values against the source document before clinical or billing use.",
      "",
      `ADMISSION BRIEFING — ${fullName}`,
      nurseName ? `To: ${nurseName}` : "",
      senderName ? `Prepared by: ${senderName} (intake)` : "",
      `Payer: ${plan.payer.label}`,
    ]
      .filter((l) => l !== "")
      .join("\n")
  );

  // ── patient snapshot ──
  const snapshotNarrative =
    clean(summary.narrative) ||
    [clean(dx.primary_diagnosis) && `Referred for ${clean(dx.primary_diagnosis)}.`, clean(ex.admission_details?.referral_reason)]
      .filter(Boolean)
      .join(" ");
  sections.push(
    section("PATIENT SNAPSHOT", [
      snapshotNarrative,
      Array.isArray(summary.key_conditions) && summary.key_conditions.length > 0
        ? `Key conditions: ${summary.key_conditions.join("; ")}`
        : "",
      bullet("Functional", summary.functional_snapshot || ex.functional_status?.ambulation),
      bullet("Home & support", summary.support_and_home || ex.psychosocial?.social_determinants?.living_situation),
      bullet("DOB", demo.date_of_birth),
      bullet("Address", demo.address),
      bullet("Phone", demo.phone),
      bullet(
        "Emergency contact",
        [clean(demo.emergency_contact), clean(demo.emergency_relationship), clean(demo.emergency_phone)]
          .filter(Boolean)
          .join(", ")
      ),
      bullet("Referring provider", [clean(demo.referring_physician), clean(demo.referring_physician_contact)].filter(Boolean).join(", ")),
      bullet("Admission source", ex.admission_details?.admission_source),
      bullet("Requested start", ex.admission_details?.admission_date || referralData?.estimated_start_date),
    ])
  );

  // ── alerts ──
  const riskFlags = Array.isArray(analysis?.risk_flags) ? analysis.risk_flags : [];
  const rankedRisks = [...riskFlags].sort(
    (a, b) => ["High", "Medium", "Low"].indexOf(a?.severity) - ["High", "Medium", "Low"].indexOf(b?.severity)
  );
  const wounds = Array.isArray(ex.wound_details) ? ex.wound_details : [];
  const highRiskMeds = Array.isArray(ex.oasis_assessment?.m2010_high_risk_drugs) ? ex.oasis_assessment.m2010_high_risk_drugs : [];
  sections.push(
    section("ALERTS", [
      bullet("Allergies", dx.allergies),
      ...rankedRisks.map((r) => `- [${r.severity || "?"}] ${clean(r.risk_type) || "Risk"}: ${clean(r.description)}`),
      wounds.length > 0
        ? `- Wounds (${wounds.length}): ${wounds
            .map((w) => [clean(w.wound_type), clean(w.stage), clean(w.location)].filter(Boolean).join(" "))
            .filter(Boolean)
            .join("; ")}`
        : "",
      bullet("Fall risk", ex.functional_status?.fall_risk),
      bullet("Swallowing", ex.nutritional_status?.swallowing_difficulties),
      bullet("Infection status", ex.clinical_info?.infection_status),
      bullet("Environmental hazards", ex.safety_concerns?.environmental_hazards),
      Array.isArray(ex.safety_concerns?.high_risk_conditions) && ex.safety_concerns.high_risk_conditions.length > 0
        ? `- High-risk conditions: ${ex.safety_concerns.high_risk_conditions.join("; ")}`
        : "",
      highRiskMeds.length > 0 ? `- High-risk medications: ${highRiskMeds.join("; ")}` : "",
    ])
  );

  // ── diagnoses (PDGM-sequenced, codes only — never invented) ──
  sections.push(
    section("DIAGNOSES (PDGM-SEQUENCED)", [
      ...coding.sequenced.map((d) =>
        d.role === "primary" ? `M1021 Primary: ${codeLabel(d)}` : `M1023: ${codeLabel(d)}`
      ),
      coding.sequenced.length === 0 ? bullet("Primary (uncoded)", dx.primary_diagnosis) : "",
      coding.uncoded.length > 0
        ? `Documented without ICD-10 codes (coder to assign): ${coding.uncoded.map((u) => u.description).join("; ")}`
        : "",
    ])
  );

  // ── what's ordered ──
  const sk = ex.skilled_needs || {};
  const ot = ex.orders_treatments || {};
  sections.push(
    section("WHAT'S ORDERED", [
      Array.isArray(sk.services_ordered) && sk.services_ordered.length > 0
        ? `Services: ${sk.services_ordered.join("; ")}`
        : "",
      bullet("Ordered frequency/duration", sk.frequency_duration),
      Array.isArray(sk.specific_interventions) && sk.specific_interventions.length > 0
        ? `Interventions: ${sk.specific_interventions.join("; ")}`
        : "",
      Array.isArray(ot.physician_orders) && ot.physician_orders.length > 0
        ? `Physician orders: ${ot.physician_orders.join("; ")}`
        : "",
      Array.isArray(sk.dme_supplies) && sk.dme_supplies.length > 0 ? `DME/Supplies: ${sk.dme_supplies.join("; ")}` : "",
      bullet("Diet", ot.diet),
      bullet("Activity restrictions", ot.activity_restrictions),
      bullet("Goals of care", sk.goals_of_care),
    ])
  );

  // ── medications ──
  const meds = Array.isArray(ex.medications) ? ex.medications : [];
  sections.push(
    section(`MEDICATIONS (${meds.length})`, [
      ...meds.slice(0, MAX_MEDICATIONS).map((m) => {
        const parts = [clean(m.name), clean(m.dosage), clean(m.frequency), clean(m.route)].filter(Boolean);
        return parts.length > 0 ? `- ${parts.join(" · ")}` : "";
      }),
      meds.length > MAX_MEDICATIONS ? `(+${meds.length - MAX_MEDICATIONS} more — see the attached referral)` : "",
    ])
  );

  // ── visit plan (payer-optimized) ──
  const visitLines = [];
  if (plan.hasOrderedFrequencies) {
    visitLines.push("Ordered frequencies (authoritative — from the referral):");
    const byDiscipline = plan.orders.reduce((acc, o) => {
      (acc[o.discipline] ||= []).push(o);
      return acc;
    }, {});
    for (const [d, orders] of Object.entries(byDiscipline)) {
      visitLines.push(`- ${DISCIPLINE_NAMES[d] || d}: ${orders.map(formatOrder).join(" → ")}`);
    }
    if (plan.periods) {
      visitLines.push(
        `30-day period plan: Period 1 ≈ ${plan.periods.period1} visits; Period 2 ≈ ${plan.periods.period2} visits${
          plan.periods.complete ? "" : " (some orders open-ended — counts are a floor)"
        }.`
      );
    }
  } else if (plan.aiEstimates) {
    const est = plan.aiEstimates;
    visitLines.push("No frequencies are ordered in the referral. Suggested plan (AI planning estimate — confirm with the physician and at SOC):");
    if (est.suggestedFrequency) visitLines.push(`- Suggested frequency: ${est.suggestedFrequency}`);
    if (est.nursingFirst30 != null) visitLines.push(`- Nursing: ~${est.nursingFirst30} visits days 1–30${est.nursingDays31to60 != null ? `, ~${est.nursingDays31to60} visits days 31–60` : ""}`);
    const therapy = [
      est.pt != null && `PT ~${est.pt}`,
      est.ot != null && `OT ~${est.ot}`,
      est.st != null && `ST ~${est.st}`,
      est.msw != null && `MSW ~${est.msw}`,
      est.aide != null && `Aide ~${est.aide}`,
    ].filter(Boolean);
    if (therapy.length > 0) visitLines.push(`- Other disciplines (60-day episode): ${therapy.join("; ")}`);
    if (est.rationale) visitLines.push(`- Rationale: ${est.rationale}`);
  } else {
    visitLines.push("No frequencies are ordered and no estimate is available yet — obtain ordered frequencies from the referring physician.");
  }
  visitLines.push(...payerSchedulingNotes(plan));
  sections.push(section(`VISIT PLAN — ${plan.payer.label.toUpperCase()}`, visitLines));

  // ── Medicare coverage snapshot ──
  const statusWord = { met: "OK", needs_review: "REVIEW", not_met: "GAP" };
  sections.push(
    section("MEDICARE COVERAGE SNAPSHOT", [
      ...eligibility.criteria.map((c) => `- [${statusWord[c.status] || c.status}] ${c.label}: ${c.detail}`),
      !eligibility.applicable ? `(Payer is ${eligibility.payer.label} — shown for reference; plan rules apply.)` : "",
    ])
  );

  // ── draft OASIS responses ──
  const oasis = ex.oasis_assessment || {};
  const oasisLines = Object.entries(oasis)
    .filter(([key]) => /^(?:m|gg)\d{4}/i.test(key))
    .map(([key, value]) => {
      const v = formatOasisValue(value);
      return v ? `- ${oasisItemLabel(key)}: ${v}` : "";
    });
  const verification = Array.isArray(oasis.items_needing_verification) ? oasis.items_needing_verification : [];
  const ggIssues = auditGgDraft(oasis);
  sections.push(
    section("DRAFT OASIS RESPONSES (AI pre-fill — verify every item at SOC)", [
      ...oasisLines,
      ...ggIssues.map((i) => `- VERIFY: ${i}`),
      verification.length > 0 ? `Items flagged for verification: ${verification.join("; ")}` : "",
      clean(oasis.confidence_notes) ? `AI confidence notes: ${clean(oasis.confidence_notes)}` : "",
    ])
  );

  // ── first-visit prep checklist ──
  const prep = buildSocVisitPrep(referralData, analysis);
  sections.push(section("FIRST-VISIT PREP CHECKLIST", socVisitPrepLines(prep)));

  // ── documented-but-uncoded conditions to confirm at SOC ──
  // Clinical framing for the nurse: confirming these completes the diagnosis
  // picture (the coder handles the codes; no payment mechanics here).
  const capture = collectComorbidityCapture(referralData);
  if (capture.opportunities.length > 0) {
    sections.push(
      section("CONFIRM & REPORT AT SOC — documented but not yet a coded diagnosis", [
        ...capture.opportunities.map(
          (o) => `- ${o.label}: suggested by ${o.evidence.map((e) => `${e.source} ("${e.text}")`).join("; ")} — confirm with the patient/physician so it can be coded.`
        ),
      ])
    );
  }

  // ── sample admission narrative ──
  const note = clean(admissionNote) || clean(ex.admission_note_template);
  sections.push(section("SAMPLE ADMISSION NARRATIVE (draft — rewrite to reflect your actual assessment)", note));

  // ── still needed / watch-outs ──
  const criticalMissing = Array.isArray(analysis?.missing_information?.critical_missing)
    ? analysis.missing_information.critical_missing
    : [];
  sections.push(
    section("STILL NEEDED / WATCH-OUTS", [
      ...criticalMissing.map((m) => `- Missing (critical): ${clean(m.field_name)}${clean(m.how_to_obtain) ? ` — ${clean(m.how_to_obtain)}` : ""}`),
      ...eligibility.missingForAdmission.map((m) => `- ${m}`),
      f2f && f2f.status !== "valid" ? `- F2F validation: ${f2f.reasons.join(" ")}` : "",
    ])
  );

  // ── documents ──
  sections.push(
    section("DOCUMENTS", [
      sourceFileUrl ? `Source referral document: ${sourceFileUrl}` : "",
      packetUrl ? `Admission packet PDF: ${packetUrl}` : "",
      !sourceFileUrl && !packetUrl ? "Referral documents are available in PennSync (Referral Processor)." : "",
    ])
  );

  sections.push(
    "This briefing was generated by PennSync from the uploaded referral to orient the admitting clinician. It is not a physician order and does not replace the source document."
  );

  return { subject, body: sections.filter(Boolean).join("\n\n") };
}
