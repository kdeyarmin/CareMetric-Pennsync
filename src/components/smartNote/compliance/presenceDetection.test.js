import test from "node:test";
import assert from "node:assert/strict";
import { detectPresence, computeGaps, computeCriticalGaps, computeCarryForward } from "./presenceDetection.js";
import { getRequiredElements } from "./requiredElements.js";

const reqs = getRequiredElements("home_health", "routine_visit");

test("detects a documented homebound statement with evidence", () => {
  const draft = "Patient is homebound, unable to leave without considerable and taxing effort. Wound care provided to right heel.";
  const results = detectPresence(draft, reqs);
  const homebound = results.find((r) => r.id === "homebound");
  assert.equal(homebound.present, true);
  assert.match(homebound.evidence, /taxing effort/i);
});

test("flags homebound as missing when absent", () => {
  const draft = "Reviewed medications. BP 132/80. Patient denies pain.";
  const results = detectPresence(draft, reqs);
  const homebound = results.find((r) => r.id === "homebound");
  assert.equal(homebound.present, false);
  assert.equal(homebound.evidence, null);
});

test("computeGaps returns only the missing elements", () => {
  const draft = "Patient homebound, requires taxing effort to leave. Skilled wound care performed.";
  const results = detectPresence(draft, reqs);
  const gapIds = computeGaps(results, reqs).map((e) => e.id);
  assert.ok(!gapIds.includes("homebound"));
  assert.ok(!gapIds.includes("skilled_need"));
  assert.ok(gapIds.includes("vitals")); // not documented in this draft
});

test("computeCriticalGaps surfaces only unanswered critical elements", () => {
  const draft = "Reviewed medications and taught the patient about diet.";
  const results = detectPresence(draft, reqs);
  const criticalGaps = computeCriticalGaps(results, reqs).map((e) => e.id);
  assert.deepEqual(criticalGaps.sort(), ["homebound", "skilled_need"]);
});

test("a fully documented draft has no critical gaps", () => {
  const draft =
    "Patient remains homebound, leaving home requires a considerable and taxing effort. " +
    "Skilled nursing assessment and wound care performed to the right heel.";
  const results = detectPresence(draft, reqs);
  assert.equal(computeCriticalGaps(results, reqs).length, 0);
});

test("carry-forward pre-fills stable elements from a prior note, never visit-specific ones", () => {
  const draft = "Skilled wound care performed."; // homebound + vitals are gaps
  const gaps = computeGaps(detectPresence(draft, reqs), reqs);
  const priorNote =
    "Patient is homebound, unable to leave without considerable and taxing effort. " +
    "BP 150/88, pain 4/10 this visit.";
  const prefill = computeCarryForward(priorNote, gaps);
  // homebound (stable) is carried with its prior evidence sentence...
  assert.ok(prefill.homebound);
  assert.match(prefill.homebound, /taxing effort/i);
  // ...but visit-specific findings (vitals, pain) are NOT carried forward.
  assert.equal(prefill.vitals, undefined);
  assert.equal(prefill.pain, undefined);
});

test("carry-forward returns nothing without a prior note", () => {
  const gaps = computeGaps(detectPresence("", reqs), reqs);
  assert.deepEqual(computeCarryForward("", gaps), {});
});

test("evidence is a clean single line for bullet drafts", () => {
  const draft = "BP 148/90, HR 82\nhomebound: unable to leave without taxing effort\nskilled wound care performed";
  const results = detectPresence(draft, reqs);
  const homebound = results.find((r) => r.id === "homebound");
  assert.equal(homebound.present, true);
  assert.ok(!homebound.evidence.includes("\n"), "evidence should not span multiple lines");
  assert.match(homebound.evidence, /taxing effort/i);
});

// ── Regression: keyword/pattern false-passes (2026-07 review) ───────────────

import { getRequiredElements as _getReq } from "./requiredElements.js";

test("short keywords no longer match inside unrelated words", () => {
  const req = _getReq("home_health", "routine_visit");
  const vitals = (text) => detectPresence(text, req).find((r) => r.id === "vitals");
  assert.equal(vitals("Patient attempted to ambulate with walker.").present, false, "'attempted' must not satisfy vitals via 'temp'");
  assert.equal(vitals("Reposition q2hr per care plan.").present, false, "'q2hr' must not satisfy vitals via 'hr'");
  assert.equal(vitals("BP 148/90, HR 82.").present, true);
});

test("wound drainage does not satisfy the discharge-reason critical gate", () => {
  const req = _getReq("home_health", "discharge");
  const row = (text) => detectPresence(text, req).find((r) => r.id === "discharge_reason");
  assert.equal(row("Incision clean and dry, no discharge or drainage noted.").present, false);
  assert.equal(row("Patient transferred to wheelchair with one assist.").present, false);
  assert.equal(row("Discharged from service — goals met; transfer to outpatient PT.").present, true);
});

test("a PRN medication does not satisfy the PRN visit-reason critical gate", () => {
  const req = _getReq("home_health", "prn");
  const row = (text) => detectPresence(text, req).find((r) => r.id === "visit_reason");
  assert.equal(row("Administered PRN oxycodone 5 mg for pain 6/10.").present, false);
  assert.equal(row("Family called to request an unscheduled visit for new confusion.").present, true);
});

test("an unrelated '6 months' does not satisfy the terminal-prognosis critical gate", () => {
  const req = _getReq("hospice", "recertification");
  const row = (text) => detectPresence(text, req).find((r) => r.id === "terminal_prognosis");
  assert.equal(row("Patient has had the sacral wound for 6 months.").present, false);
  assert.equal(row("Continued decline supports a prognosis of six months or less.").present, true);
});

test("'ambulated toward the bathroom' does not satisfy care-plan progress", () => {
  const req = _getReq("home_health", "routine_visit");
  const row = (text) => detectPresence(text, req).find((r) => r.id === "care_plan_progress");
  assert.equal(row("Patient ambulated toward the bathroom.").present, false);
  assert.equal(row("Progress toward the mobility goal noted.").present, true);
});

// ── negation guard on negationSensitive elements ──

test("a negated homebound/skilled-need mention is not evidence", () => {
  // Regression: the engine's own "…was not documented" fallback lines and
  // "Patient is not homebound" satisfied the detector, so a note explicitly
  // stating the elements were missing scanned as compliant.
  const negated = detectPresence(
    "Homebound status was not documented this visit. Skilled need was not documented this visit.",
    reqs,
  );
  assert.equal(negated.find((r) => r.id === "homebound").present, false);
  assert.equal(negated.find((r) => r.id === "skilled_need").present, false);

  const denial = detectPresence(
    "Patient is NOT homebound. No wound care or skilled service was needed today.",
    reqs,
  );
  assert.equal(denial.find((r) => r.id === "homebound").present, false);
  assert.equal(denial.find((r) => r.id === "skilled_need").present, false);
});

test("a POST-term negation is not evidence either", () => {
  // Regression: the guard only looked BEHIND the matched term, so the two
  // commonest ways a nurse records an element as absent — the label form
  // ("Homebound: no.") and the verb form ("Wound care declined by patient.") —
  // both counted as evidence that the element was PRESENT, silencing a
  // hard-blocking eligibility gate.
  const label = detectPresence("Homebound: no. Skilled need — none.", reqs);
  assert.equal(label.find((r) => r.id === "homebound").present, false);
  assert.equal(label.find((r) => r.id === "skilled_need").present, false);

  const verb = detectPresence(
    "Patient is homebound. Wound care declined by patient.",
    reqs.filter((r) => r.id === "skilled_need"),
  );
  assert.equal(verb[0].present, false);
});

test("an affirmative clause followed by an unrelated negative still detects", () => {
  // The suffix guard must not swallow real documentation: "no complications"
  // qualifies the care that WAS delivered, it does not deny it.
  const res = detectPresence(
    "Patient is homebound due to severe dyspnea. Wound care: no complications noted.",
    reqs,
  );
  assert.equal(res.find((r) => r.id === "homebound").present, true);
  assert.equal(res.find((r) => r.id === "skilled_need").present, true);
});

test("affirmative homebound/skilled-need statements still detect", () => {
  const res = detectPresence(
    "Patient is homebound due to severe dyspnea; requires a walker to leave home. Performed skilled wound care to the sacral ulcer.",
    reqs,
  );
  assert.equal(res.find((r) => r.id === "homebound").present, true);
  assert.equal(res.find((r) => r.id === "skilled_need").present, true);
});

test("clinical negative findings on ordinary elements still count as evidence", () => {
  // "denies pain" is valid pain-assessment documentation — the negation guard
  // must stay scoped to the negationSensitive eligibility elements.
  const painElem = reqs.find((r) => /pain/i.test(r.id) || /pain/i.test(r.label));
  if (painElem) {
    const res = detectPresence("Patient denies pain this visit.", [painElem]);
    assert.equal(res[0].present, true);
  }
});

// ── Unfilled template placeholders are not documentation ───────────────────
// The routine-SN template seeds these exact lines. Untouched, they used to
// satisfy homebound/skilled-need/vitals, so the nurse was never asked and the
// blanks rode into the generated note.
const UNTOUCHED_TEMPLATE = [
  "Vital signs: BP _/_,  HR _, RR _, O2 _% on RA, Temp _°F, Wt _ lbs",
  "Homebound status: patient unable to leave home without considerable effort due to [diagnosis]",
  "Skilled need: [wound care / medication management / disease management teaching]",
  "Patient educated on: [topic] — patient verbalized understanding",
].join("\n");

test("an untouched template does not mark required elements documented", () => {
  const elements = getRequiredElements("home_health", "routine_visit");
  const presence = detectPresence(UNTOUCHED_TEMPLATE, elements);
  const present = presence.filter((p) => p.present).map((p) => p.id);
  assert.deepEqual(present, [], `placeholder lines must not count as evidence (got ${present.join(", ")})`);
});

test("filling the template in makes those elements documented again", () => {
  const elements = getRequiredElements("home_health", "routine_visit");
  const filled = [
    "Vital signs: BP 148/90, HR 82, RR 16, O2 95% on RA, Temp 98.6, Wt 180 lbs",
    "Homebound status: patient unable to leave home without considerable effort due to severe exertional dyspnea",
    "Skilled need: wound care to the sacral ulcer",
    "Patient educated on medication schedule — patient verbalized understanding",
  ].join("\n");
  const present = detectPresence(filled, elements).filter((p) => p.present).map((p) => p.id);
  for (const id of ["vitals", "homebound", "skilled_need", "education"]) {
    assert.ok(present.includes(id), `${id} should be documented once the blanks are filled`);
  }
});

test("a placeholder on one line does not suppress a complete line elsewhere", () => {
  const elements = getRequiredElements("home_health", "routine_visit");
  const mixed = [
    "Homebound status: unable to leave home due to [diagnosis]",
    "Skilled need: sterile dressing change to the stage 3 sacral ulcer.",
  ].join("\n");
  const presence = detectPresence(mixed, elements);
  const byId = Object.fromEntries(presence.map((p) => [p.id, p.present]));
  assert.equal(byId.homebound, false, "the placeholder line is still a gap");
  assert.equal(byId.skilled_need, true, "the completed line is still evidence");
});
