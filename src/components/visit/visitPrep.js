// visitPrep — the compact "what matters today" briefing a nurse reads before a
// visit, assembled deterministically from records PennSync already holds.
//
// WHY THIS EXISTS
// A field nurse arriving at a home needs the handful of facts that change what
// they do this visit: the allergy, the fall risk, the wound, the abnormal vital
// from last time, the unresolved provider question, the teaching that was left
// unfinished. Those facts exist across the chart, prior notes, tasks and care
// plans — and finding them meant opening several hubs on a phone in a driveway.
//
// DESIGN RULES
//  - Pure and deterministic. No LLM: a pre-visit briefing that could invent a
//    fact is worse than no briefing at all. Every line traces to a record.
//  - PROGRESSIVE DISCLOSURE by construction: items carry a priority, and the
//    caller shows the top band first. The module never returns a wall of text.
//  - It never asserts anything the source records do not say, and it never
//    claims a provider was notified — only that a follow-up is unresolved.
//  - Absence of data is reported as "not recorded in PennSync", never as
//    "none" — PennSync is not the EMR and does not hold the whole chart.
//
// Pure + offline so it runs under `node --test`. It may only import other plain
// `.js` modules with explicit extensions (never `.jsx`).

/** Priority bands, most urgent first. */
export const PREP_PRIORITIES = Object.freeze(["critical", "high", "routine"]);

const MS_PER_DAY = 86400000;

function toTime(value) {
  const t = value instanceof Date ? value.getTime() : Date.parse(String(value || ""));
  return Number.isFinite(t) ? t : null;
}

function daysAgo(value, now) {
  const t = toTime(value);
  if (t == null) return null;
  return Math.floor((now.getTime() - t) / MS_PER_DAY);
}

function item(priority, category, label, detail, extra = {}) {
  return { priority, category, label, detail, ...extra };
}

const AMBULATION_LABEL = {
  independent: "Independent",
  walker: "Uses a walker",
  cane: "Uses a cane",
  wheelchair: "Uses a wheelchair",
  bedbound: "Bedbound",
};

const ADL_LABEL = {
  independent: "Independent with ADLs",
  minimal_assist: "Minimal ADL assist",
  moderate_assist: "Moderate ADL assist",
  total_assist: "Total ADL assist",
};

const COGNITION_LABEL = {
  alert_oriented: "Alert and oriented",
  mild_confusion: "Mild confusion",
  moderate_impairment: "Moderate cognitive impairment",
  severe_impairment: "Severe cognitive impairment",
};

/**
 * Build the pre-visit briefing.
 *
 * @param {{
 *   patient?: object|null,
 *   priorVisits?: object[],
 *   openTasks?: object[],
 *   carePlans?: object[],
 *   oasisAssessments?: object[],
 *   alerts?: object[],
 *   now?: Date,
 * }} input
 * @returns {{
 *   patientName: string, items: object[], byPriority: object,
 *   counts: { critical: number, high: number, routine: number },
 *   missing: string[], generatedAt: string,
 * }}
 */
export function buildVisitPrep({
  patient = null,
  priorVisits = [],
  openTasks = [],
  carePlans = [],
  oasisAssessments = [],
  alerts = [],
  now = new Date(),
} = {}) {
  const items = [];
  const missing = [];

  // ── Safety first: allergies ──────────────────────────────────────────────
  const allergies = String(patient?.allergies || "").trim();
  if (allergies && !/^(none|nkda|no known)/i.test(allergies)) {
    items.push(item("critical", "allergies", "Allergies", allergies));
  } else if (allergies) {
    items.push(item("routine", "allergies", "Allergies", allergies));
  } else {
    missing.push("Allergies are not recorded in PennSync — confirm from the EMR.");
  }

  // ── Diagnoses ────────────────────────────────────────────────────────────
  if (patient?.primary_diagnosis) {
    items.push(item("high", "diagnosis", "Primary diagnosis", patient.primary_diagnosis));
  } else {
    missing.push("Primary diagnosis is not recorded in PennSync.");
  }
  const secondary = (patient?.secondary_diagnoses || []).filter(Boolean);
  if (secondary.length) {
    items.push(item("routine", "diagnosis", "Other diagnoses", secondary.slice(0, 5).join("; "), {
      overflow: Math.max(0, secondary.length - 5),
    }));
  }

  // ── Functional status / fall risk ────────────────────────────────────────
  const fs = patient?.functional_status || {};
  if (fs.fall_risk === "high") {
    items.push(item("critical", "safety", "High fall risk", fs.notes || "Documented high fall risk — review the environment and interventions."));
  } else if (fs.fall_risk) {
    items.push(item("routine", "safety", "Fall risk", `${fs.fall_risk} risk`));
  }
  const functionBits = [
    AMBULATION_LABEL[fs.ambulation],
    ADL_LABEL[fs.adl_independence],
    COGNITION_LABEL[fs.cognitive_status],
  ].filter(Boolean);
  if (functionBits.length) {
    items.push(item("routine", "function", "Functional status", functionBits.join(" · ")));
  }

  // ── Wounds ───────────────────────────────────────────────────────────────
  const wounds = (patient?.wounds || []).filter(Boolean);
  for (const w of wounds.slice(0, 3)) {
    const size = [w.size_length, w.size_width].filter((n) => Number.isFinite(n));
    const detail = [
      w.type,
      w.stage ? `stage ${w.stage}` : null,
      size.length === 2 ? `${size[0]}×${size[1]} cm` : null,
      w.treatment_plan,
    ].filter(Boolean).join(" · ");
    items.push(item("high", "wound", `Wound: ${w.location || "location not recorded"}`, detail || "No wound detail recorded in PennSync."));
  }

  // ── Medications ──────────────────────────────────────────────────────────
  const meds = (patient?.current_medications || []).filter((m) => m?.name);
  if (meds.length) {
    items.push(item("high", "medication", `Medications (${meds.length})`,
      meds.slice(0, 5).map((m) => [m.name, m.dosage, m.frequency].filter(Boolean).join(" ")).join("; "),
      { overflow: Math.max(0, meds.length - 5) }));
    // A medication started in the last 30 days is what actually changes the visit.
    const recent = meds.filter((m) => {
      const d = daysAgo(m.start_date, now);
      return d != null && d >= 0 && d <= 30;
    });
    if (recent.length) {
      items.push(item("high", "medication", "Recent medication changes",
        recent.map((m) => [m.name, m.dosage].filter(Boolean).join(" ")).join("; ")));
    }
  } else {
    missing.push("No medication list in PennSync — review the medication profile in the EMR.");
  }

  // ── Recent hospitalisation / ER ──────────────────────────────────────────
  const hospitalizations = (patient?.past_hospitalizations || []).filter(Boolean);
  for (const h of hospitalizations) {
    const d = daysAgo(h.date, now);
    if (d == null || d < 0 || d > 60) continue;
    items.push(item("critical", "acute_event", "Recent hospitalization",
      `${h.reason || "Reason not recorded"}${h.hospital ? ` — ${h.hospital}` : ""} (${d} day${d === 1 ? "" : "s"} ago)`));
  }

  // ── Prior visit: abnormal vitals and concerns ────────────────────────────
  const completed = priorVisits
    .filter((v) => v && (v.visit_date || v.created_date))
    .sort((a, b) => (toTime(b.visit_date || b.created_date) || 0) - (toTime(a.visit_date || a.created_date) || 0));
  const last = completed[0] || null;
  if (last) {
    const abnormal = abnormalVitals(last.vital_signs);
    if (abnormal.length) {
      items.push(item("critical", "vitals", "Abnormal vitals last visit", abnormal.join("; "), {
        visitId: last.id || null,
      }));
    }
    const issues = (last.compliance_issues || []).filter(Boolean);
    if (issues.length) {
      items.push(item("high", "prior_concern", "Concerns from the last visit", issues.slice(0, 3).join("; "), {
        visitId: last.id || null,
        overflow: Math.max(0, issues.length - 3),
      }));
    }
    const since = daysAgo(last.visit_date || last.created_date, now);
    if (since != null) {
      items.push(item("routine", "last_visit", "Last documented visit",
        `${since === 0 ? "Today" : `${since} day${since === 1 ? "" : "s"} ago`}${last.visit_type ? ` · ${String(last.visit_type).replace(/_/g, " ")}` : ""}`,
        { visitId: last.id || null }));
    }
  } else {
    missing.push("No prior visit recorded in PennSync for this patient.");
  }

  // ── Unresolved provider follow-up ────────────────────────────────────────
  const unresolved = openTasks.filter((t) => t && !["completed", "cancelled", "resolved"].includes(t.status));
  // Deliberately narrow. A bare /order/ match swept in ordinary supply and
  // scheduling tasks ("Order new dressing supplies") and reported them as
  // unresolved PROVIDER follow-ups — inflating the most urgent band with work
  // that has nothing to do with a provider.
  const PROVIDER_TASK = /\b(?:notify|notification|provider|physician|prescriber|md)\b|\b(?:new|verbal|telephone|clarif\w*)\s+order\b|\border\s+(?:clarification|received|needed|change)\b/i;
  const providerTasks = unresolved.filter((t) => PROVIDER_TASK.test(`${t.title || ""} ${t.type || ""}`));
  if (providerTasks.length) {
    items.push(item("critical", "provider_followup",
      `Unresolved provider follow-up (${providerTasks.length})`,
      providerTasks.slice(0, 3).map((t) => t.title).filter(Boolean).join("; "),
      {
        overflow: Math.max(0, providerTasks.length - 3),
        // Never implies the provider was reached — only that PennSync has an
        // open item.
        caveat: "A task exists in PennSync. It does not mean the provider was contacted or responded.",
      }));
  }
  const otherTasks = unresolved.filter((t) => !providerTasks.includes(t));
  if (otherTasks.length) {
    items.push(item("high", "task", `Open care tasks (${otherTasks.length})`,
      otherTasks.slice(0, 3).map((t) => t.title).filter(Boolean).join("; "),
      { overflow: Math.max(0, otherTasks.length - 3) }));
  }

  // ── Care-plan goals and teaching needs ───────────────────────────────────
  // CarePlan.status enum is active | met | not_met | revised. Excluding
  // "discontinued" and "completed" — values the enum does not contain — meant
  // goals already met, not met or revised were all presented to a nurse as
  // current. Match the enum by INCLUSION so a future value cannot silently
  // become "active" either.
  const activePlans = carePlans.filter((p) => p && (p.status === "active" || p.status == null));
  // CarePlan carries one `goal` string per problem row, not a goals array.
  const goals = activePlans
    .map((p) => [p.problem, p.goal].filter(Boolean).join(" — "))
    .filter(Boolean);
  if (goals.length) {
    items.push(item("routine", "care_plan", `Care-plan goals (${goals.length})`,
      goals.slice(0, 3).join("; "),
      { overflow: Math.max(0, goals.length - 3) }));
  }
  const teaching = (patient?.goals_of_care || []).filter(Boolean);
  if (teaching.length) {
    items.push(item("routine", "teaching", "Patient/family goals", teaching.slice(0, 3).join("; ")));
  }

  // ── Active alerts ────────────────────────────────────────────────────────
  for (const a of alerts.filter((x) => x && x.status !== "resolved").slice(0, 3)) {
    const severity = String(a.severity || a.priority || "").toLowerCase();
    items.push(item(severity === "critical" || severity === "high" ? "critical" : "high",
      "alert", a.title || a.alert_type || "Patient alert", a.description || a.message || ""));
  }

  // ── OASIS / reassessment ─────────────────────────────────────────────────
  const latestOasis = oasisAssessments
    .filter(Boolean)
    .sort((a, b) => (toTime(b.assessment_date || b.created_date) || 0) - (toTime(a.assessment_date || a.created_date) || 0))[0];
  if (latestOasis) {
    const d = daysAgo(latestOasis.assessment_date || latestOasis.created_date, now);
    // OASISAssessment carries `visit_type` (start_of_care, recertification, …).
    const kind = latestOasis.visit_type || latestOasis.assessment_type;
    items.push(item("routine", "oasis", "Most recent OASIS in PennSync",
      `${kind ? String(kind).replace(/_/g, " ") : "Assessment"}${d != null ? ` \u00b7 ${d} day${d === 1 ? "" : "s"} ago` : ""}`,
      { caveat: "PennSync's copy — the official assessment lives in your EMR." }));
  }

  // Recertification window: day 51-60 of a 60-day episode.
  const admissionDays = daysAgo(patient?.admission_date, now);
  if (admissionDays != null && admissionDays >= 0) {
    const dayInEpisode = admissionDays % 60;
    const episodesElapsed = Math.floor(admissionDays / 60);
    if (dayInEpisode >= 51 || (episodesElapsed > 0 && dayInEpisode <= 5)) {
      items.push(item("high", "recertification", "Recertification window",
        `Day ${dayInEpisode + 1} of the current 60-day episode — confirm the recertification schedule in your EMR.`));
    }
  }

  const byPriority = { critical: [], high: [], routine: [] };
  for (const i of items) byPriority[i.priority]?.push(i);

  return {
    patientName: [patient?.first_name, patient?.last_name].filter(Boolean).join(" ").trim() || "Patient",
    items,
    byPriority,
    counts: {
      critical: byPriority.critical.length,
      high: byPriority.high.length,
      routine: byPriority.routine.length,
    },
    missing,
    generatedAt: now.toISOString(),
  };
}

// Same thresholds the note escalation engine uses, kept local so this module
// stays dependency-free and node-testable.
const VITAL_RULES = [
  { key: "blood_pressure_systolic", label: "Systolic BP", low: 90, high: 180, unit: " mmHg" },
  { key: "blood_pressure_diastolic", label: "Diastolic BP", low: 50, high: 110, unit: " mmHg" },
  { key: "heart_rate", label: "Heart rate", low: 50, high: 120, unit: " bpm" },
  { key: "oxygen_saturation", label: "O2 saturation", low: 90, high: 101, unit: "%" },
  { key: "temperature", label: "Temperature", low: 95, high: 100.4, unit: "°F" },
  { key: "respiratory_rate", label: "Respiratory rate", low: 10, high: 24, unit: "/min" },
];

/**
 * Vitals outside the ordinary range, as display strings.
 * @param {object|null} vitals canonical Visit.vital_signs
 */
export function abnormalVitals(vitals) {
  if (!vitals) return [];
  const out = [];
  for (const rule of VITAL_RULES) {
    const value = vitals[rule.key];
    if (!Number.isFinite(value)) continue;
    if (value < rule.low || value > rule.high) out.push(`${rule.label} ${value}${rule.unit}`);
  }
  return out;
}
