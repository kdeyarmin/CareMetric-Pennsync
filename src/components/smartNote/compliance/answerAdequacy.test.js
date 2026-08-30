import test from "node:test";
import assert from "node:assert/strict";
import { checkAnswerAdequacy, elementsWithAdequacyRules, findInadequateCritical, findInadequateCriticalEvidence } from "./answerAdequacy.js";
import { REQUIRED_ELEMENTS, VISIT_TYPES, getCriticalElements, getRequiredElements } from "./requiredElements.js";
import { detectPresence } from "./presenceDetection.js";
import { elementsJudgedByGuardrail, runDenialGuardrail } from "../../compliance/denialGuardrailEngine.js";

test("flags a conclusory homebound restatement", () => {
  const r = checkAnswerAdequacy("homebound", "Patient is homebound.");
  assert.equal(r.adequate, false);
  assert.ok(r.tip);
});

test("accepts a specific homebound answer with cause + taxing effort", () => {
  const r = checkAnswerAdequacy(
    "homebound",
    "Homebound due to severe dyspnea; requires a walker and one-person assist to ambulate and tires after a few steps.",
  );
  assert.equal(r.adequate, true);
});

test("flags a bare skilled-need restatement", () => {
  assert.equal(checkAnswerAdequacy("skilled_need", "Skilled nursing.").adequate, false);
});

test("accepts a specific skilled-need answer", () => {
  const r = checkAnswerAdequacy(
    "skilled_need",
    "Performed skilled wound assessment and sterile dressing change to the sacral ulcer.",
  );
  assert.equal(r.adequate, true);
});

test("flags education without confirmation of understanding", () => {
  const r = checkAnswerAdequacy("education", "Talked about the diet.");
  assert.equal(r.adequate, false);
});

test("accepts education with teach-back", () => {
  const r = checkAnswerAdequacy(
    "education",
    "Taught low-sodium diet; patient verbalized understanding and named foods to avoid via teach-back.",
  );
  assert.equal(r.adequate, true);
});

test("has no opinion on elements without a rule", () => {
  assert.equal(checkAnswerAdequacy("vitals", "x").adequate, true);
  assert.equal(checkAnswerAdequacy("medication", "n/a").adequate, true);
});

test("empty answer is not flagged (gating owns emptiness)", () => {
  assert.equal(checkAnswerAdequacy("homebound", "").adequate, true);
  assert.equal(checkAnswerAdequacy("homebound", "   ").adequate, true);
});

test("every listed rule id returns a tip when given a too-short answer", () => {
  for (const id of elementsWithAdequacyRules()) {
    const r = checkAnswerAdequacy(id, "ok");
    assert.equal(r.adequate, false, `${id} should flag a trivial answer`);
    assert.ok(r.tip, `${id} should provide a tip`);
  }
});

const required = [
  { id: "homebound", severity: "critical", label: "Homebound status" },
  { id: "skilled_need", severity: "critical", label: "Skilled need" },
  { id: "pain", severity: "required", label: "Pain" },
];

test("findInadequateCritical flags a conclusory critical answer", () => {
  const out = findInadequateCritical(required, { homebound: "patient is homebound", skilled_need: "Performed skilled wound assessment and dressing change." });
  assert.deepEqual(out.map((e) => e.id), ["homebound"]);
  assert.ok(out[0].tip);
});

test("findInadequateCritical ignores empty answers (gating owns emptiness)", () => {
  // homebound unanswered → not returned here (the hard gate handles it)
  const out = findInadequateCritical(required, { homebound: "" });
  assert.equal(out.length, 0);
});

test("findInadequateCritical never flags non-critical elements", () => {
  const out = findInadequateCritical(required, { pain: "ok" });
  assert.equal(out.length, 0);
});

test("findInadequateCritical returns nothing when critical answers are specific", () => {
  const out = findInadequateCritical(required, {
    homebound: "Homebound due to severe dyspnea; requires a walker and one-person assist to ambulate.",
    skilled_need: "Skilled observation and assessment of unstable CHF with lung auscultation.",
  });
  assert.equal(out.length, 0);
});

test("every CRITICAL required element has an adequacy rule", () => {
  // Adequacy drives the soft-confirm nudge before generation. A critical element
  // without a rule silently accepts a conclusory answer on the exact fields
  // Medicare denies most, so this is a contract for new critical elements.
  const withRules = new Set(elementsWithAdequacyRules());
  const missing = new Set();
  for (const line of Object.keys(REQUIRED_ELEMENTS)) {
    for (const vt of VISIT_TYPES) {
      for (const e of getCriticalElements(line, vt)) {
        if (!withRules.has(e.id)) missing.add(`${e.id} (${line}/${vt})`);
      }
    }
  }
  assert.deepEqual([...missing], [], "critical elements without an adequacy rule");
});

test("discharge reason: a bare date is inadequate, a real reason is adequate", () => {
  assert.equal(checkAnswerAdequacy("discharge_reason", "Discharged on 3/12.").adequate, false);
  assert.equal(
    checkAnswerAdequacy(
      "discharge_reason",
      "Discharged with all care-plan goals met; patient independently performs her own dressing changes.",
    ).adequate,
    true,
  );
});

test("PRN visit reason: 'PRN visit' alone is inadequate, a prompting symptom is adequate", () => {
  assert.equal(checkAnswerAdequacy("visit_reason", "PRN visit today.").adequate, false);
  assert.equal(
    checkAnswerAdequacy(
      "visit_reason",
      "Daughter called reporting new shortness of breath and a 4 lb weight gain over two days.",
    ).adequate,
    true,
  );
});

// ── Adequacy over DRAFT EVIDENCE (not just typed answers) ──────────────────
const draftEvidence = (note, visitType, serviceLine = "home_health") => {
  const required = getRequiredElements(serviceLine, visitType);
  return { required, presence: detectPresence(note, required) };
};

test("flags a conclusory discharge reason that came from the draft", () => {
  // "Discharged on 3/12" satisfies presence, so no gap answer is ever created and
  // findInadequateCritical (answers-only) never sees it.
  const { required, presence } = draftEvidence("Discharged on 3/12. Paperwork left with the family.", "discharge");
  assert.equal(presence.find((p) => p.id === "discharge_reason").present, true, "presence is satisfied");
  assert.deepEqual(findInadequateCritical(required, {}), [], "the answers-only check sees nothing");

  const flagged = findInadequateCriticalEvidence(required, presence, {});
  assert.deepEqual(flagged.map((f) => f.id), ["discharge_reason"]);
  assert.match(flagged[0].tip, /date alone is not a reason/i);
});

test("does not flag draft evidence that states a real reason", () => {
  const { required, presence } = draftEvidence(
    "Discharged with all care-plan goals met; patient independently performs her own dressing changes.",
    "discharge",
  );
  assert.deepEqual(findInadequateCriticalEvidence(required, presence, {}), []);
});

test("a typed answer supersedes the draft evidence", () => {
  const { required, presence } = draftEvidence("Discharged on 3/12. Paperwork left with the family.", "discharge");
  // findInadequateCritical owns the answered case; this must not double-report it.
  const answers = { discharge_reason: "Discharged with all goals met; patient self-manages her wound care." };
  assert.deepEqual(findInadequateCriticalEvidence(required, presence, answers), []);
});

test("skipIds suppresses elements another judge already covers", () => {
  const { required, presence } = draftEvidence("PRN visit today. Saw the patient at home.", "prn");
  assert.deepEqual(findInadequateCriticalEvidence(required, presence, {}).map((f) => f.id), ["visit_reason"]);
  assert.deepEqual(findInadequateCriticalEvidence(required, presence, {}, { skipIds: ["visit_reason"] }), []);
});

test("an absent element is not flagged — that is the hard gate's job", () => {
  const { required, presence } = draftEvidence("Saw the patient at home and reviewed how the week went.", "discharge");
  assert.equal(presence.find((p) => p.id === "discharge_reason").present, false);
  assert.deepEqual(findInadequateCriticalEvidence(required, presence, {}), []);
});

test("the guardrail claims exactly the elements it judges the quality of", () => {
  // The reviewer feeds these ids to skipIds, so a drift here would either
  // double-warn (homebound in both voices) or silently drop a check.
  const findings = runDenialGuardrail({
    noteText: "Patient is homebound. Provided nursing care.",
    serviceLine: "home_health",
    visitType: "routine_visit",
  }).findings;
  assert.deepEqual(elementsJudgedByGuardrail(findings).sort(), ["homebound", "skilled_need", "comfort_skilled_need"].sort());

  // A discharge visit has neither cluster, so nothing is suppressed there.
  const dischargeFindings = runDenialGuardrail({
    noteText: "Discharged on 3/12.", serviceLine: "home_health", visitType: "discharge",
  }).findings;
  assert.deepEqual(elementsJudgedByGuardrail(dischargeFindings), []);
  assert.deepEqual(elementsJudgedByGuardrail([]), []);
});
