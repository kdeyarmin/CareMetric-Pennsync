import test from "node:test";
import assert from "node:assert/strict";
import { buildSocVisitPrep, socVisitPrepLines } from "./socVisitPrep.js";

test("wound + catheter + oxygen orders drive supplies, assessments, and safety items", () => {
  const prep = buildSocVisitPrep({
    skilled_needs: { services_ordered: ["Wound care to sacrum", "Foley catheter change monthly"] },
    wound_details: [{ wound_type: "Pressure ulcer", stage: "Stage 3", location: "sacrum" }],
    clinical_info: { vital_signs: "O2 sat 92% on home oxygen at 2L" },
  });
  assert.ok(prep.bring.some((b) => b.includes("Wound care supplies")));
  assert.ok(prep.bring.some((b) => b.includes("Catheter supplies")));
  assert.ok(prep.assess.some((a) => a.includes("Measure, stage, and document each of the 1 documented wound")));
  assert.ok(prep.safety.some((s) => s.includes("Home oxygen safety")));
  assert.equal(prep.hasContent, true);
});

test("medication classes raise the right day-1 flags", () => {
  const prep = buildSocVisitPrep({
    medications: [
      { name: "Warfarin", dosage: "5 mg" },
      { name: "Insulin glargine (Lantus)", dosage: "20 units" },
      { name: "Oxycodone", dosage: "5 mg PRN" },
      { name: "Furosemide", dosage: "40 mg" },
    ],
  });
  const flags = prep.medFlags.join("\n");
  assert.match(flags, /Warfarin on board/);
  assert.match(flags, /Insulin — verify the exact sliding scale/);
  assert.match(flags, /Opioid — fall risk/);
  assert.match(flags, /Loop diuretic — daily weights/);
});

test("the deterministic drug-interaction rules feed critical/major flags", () => {
  // Warfarin + aspirin is a canonical major bleed-risk pair in the app's rules.
  const prep = buildSocVisitPrep({
    medications: [{ name: "Warfarin" }, { name: "Aspirin" }],
  });
  assert.ok(
    prep.medFlags.some((f) => f.startsWith("Interaction (") && /Warfarin/i.test(f) && /Aspirin/i.test(f)),
    `expected an interaction flag, got: ${prep.medFlags.join(" | ")}`
  );
});

test("fall risk and referral hazards populate the safety walkthrough; AI high risks carry over", () => {
  const prep = buildSocVisitPrep(
    {
      functional_status: { fall_risk: "High — two falls last month" },
      safety_concerns: { environmental_hazards: "Loose rugs in hallway" },
    },
    { risk_flags: [{ risk_type: "Caregiver burnout", severity: "High", mitigation_strategy: "MSW referral" }] }
  );
  assert.ok(prep.assess.some((a) => a.includes("fall-risk assessment")));
  assert.ok(prep.safety.some((s) => s.includes("Loose rugs in hallway")));
  assert.ok(prep.safety.some((s) => s.includes("Caregiver burnout") && s.includes("MSW referral")));
});

test("the compliance verifications always include the denial-proof items", () => {
  const prep = buildSocVisitPrep({});
  const verify = prep.verify.join("\n");
  assert.match(verify, /Reconcile every medication against the bottles/);
  assert.match(verify, /homebound narrative with BOTH elements/);
  assert.match(verify, /Face-to-Face note is on file/);
  assert.match(verify, /specific skilled service/);
});

test("CHF monitoring adds the scale check and daily-weights teaching", () => {
  const prep = buildSocVisitPrep({
    admission_details: { referral_reason: "CHF exacerbation, monitor daily weights" },
  });
  assert.ok(prep.bring.some((b) => b.includes("Scale availability")));
  assert.ok(prep.teach.some((t) => t.includes("Daily weights")));
});

test("socVisitPrepLines renders grouped plain-text lines and skips empty groups", () => {
  const lines = socVisitPrepLines({
    bring: ["Wound kit"],
    assess: [],
    teach: ["Hypoglycemia signs"],
    verify: ["Reconcile meds"],
    safety: [],
    medFlags: [],
  });
  assert.deepEqual(lines, [
    "Bring:",
    "- Wound kit",
    "Teach:",
    "- Hypoglycemia signs",
    "Verify & document (denial-proofing):",
    "- Reconcile meds",
  ]);
  assert.deepEqual(socVisitPrepLines(null), []);
});

test("handles the Referral entity extracted_data wrapper", () => {
  const prep = buildSocVisitPrep({ extracted_data: { wound_details: [{ wound_type: "Surgical wound" }] } });
  assert.ok(prep.bring.some((b) => b.includes("Wound care supplies")));
});
