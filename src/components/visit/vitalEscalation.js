// Deterministic critical-vital-sign thresholds for non-blocking escalation.
//
// IMPORTANT: this is an escalation/notification aid, NOT a data-entry gate. It
// never prevents saving a genuine abnormal-but-real reading; it only flags
// life-threatening values so a supervisor/physician can be looped in. Keep the
// rules conservative (clearly life-threatening) to avoid alert fatigue. Vital
// plausibility (catching unit/typo mistakes) is handled separately in the form.

const toNum = (x) => {
  if (x === null || x === undefined || x === "") return null;
  const n = parseFloat(x);
  return Number.isFinite(n) ? n : null;
};

// Vitals reach the shared visit state under TWO key conventions, both of which
// must be supported so escalation works regardless of which entry card is used:
//   - VitalSignsForm (workflow): blood_pressure_systolic / blood_pressure_diastolic,
//     oxygen_saturation, pain_level
//   - SmartVitalsInput (primary card): bp ("120/80" string), o2, pain
function readBloodPressure(v) {
  let systolic = toNum(v.blood_pressure_systolic);
  let diastolic = toNum(v.blood_pressure_diastolic);
  if ((systolic === null || diastolic === null) && typeof v.bp === "string") {
    // Anchor with digit lookarounds so a fat-fingered "1180/120" is rejected
    // rather than parsed as 180/120 (which would slip under the >180/120
    // hypertensive-crisis threshold and miss the escalation).
    const m = v.bp.match(/(?<!\d)(\d{2,3})\s*\/\s*(\d{2,3})(?!\d)/);
    if (m) {
      const s = toNum(m[1]);
      const d = toNum(m[2]);
      // Only accept physiologically plausible readings.
      const plausible = s !== null && d !== null && s >= 60 && s <= 300 && d >= 30 && d <= 200 && s > d;
      if (plausible) {
        if (systolic === null) systolic = s;
        if (diastolic === null) diastolic = d;
      }
    }
  }
  return { systolic, diastolic };
}
const readOxygen = (v) => toNum(v.oxygen_saturation) ?? toNum(v.o2);
const readPain = (v) => toNum(v.pain_level) ?? toNum(v.pain);

/**
 * Each rule: { id, label, severity, test(vitals) -> bool, describe(vitals) -> string }.
 * Thresholds match the agency-approved escalation defaults.
 */
export const CRITICAL_VITAL_RULES = [
  {
    id: "hypertensive_crisis",
    label: "Hypertensive crisis",
    severity: "critical",
    test: (v) => {
      const { systolic, diastolic } = readBloodPressure(v);
      return (systolic !== null && systolic > 180) || (diastolic !== null && diastolic > 120);
    },
    describe: (v) => {
      const { systolic, diastolic } = readBloodPressure(v);
      return `BP ${systolic ?? "?"}/${diastolic ?? "?"} mmHg (threshold >180/120)`;
    },
  },
  {
    id: "severe_hypoxia",
    label: "Severe hypoxia",
    severity: "critical",
    test: (v) => {
      const o = readOxygen(v);
      return o !== null && o > 0 && o < 88;
    },
    describe: (v) => `O2 saturation ${readOxygen(v)}% (threshold <88%)`,
  },
  {
    id: "severe_pain",
    label: "Severe pain",
    severity: "high",
    test: (v) => {
      const p = readPain(v);
      return p !== null && p >= 10;
    },
    describe: (v) => `Pain ${readPain(v)}/10 (threshold 10/10)`,
  },
];

/**
 * Returns the list of breached critical-vital rules for a vitals object.
 * Empty array when nothing is critical (or fields are blank/non-numeric).
 *
 * @param {Record<string, any>} vitals
 * @returns {{ id: string, label: string, severity: string, detail: string }[]}
 */
export function detectCriticalVitals(vitals = {}) {
  if (!vitals || typeof vitals !== "object") return [];
  return CRITICAL_VITAL_RULES.filter((rule) => {
    try {
      return rule.test(vitals);
    } catch {
      return false;
    }
  }).map((rule) => ({
    id: rule.id,
    label: rule.label,
    severity: rule.severity,
    detail: rule.describe(vitals),
  }));
}
