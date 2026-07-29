import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRingdown, nextRingdownTarget, isUnansweredHangup } from "./onCall.js";

test("buildRingdown orders primary → backups → office and dedupes", () => {
  const r = buildRingdown({
    primary: "+12155550111",
    others: ["+12155550122", "+12155550111", "  ", "+12155550133"], // dup + blank
    office: "+17244650440",
  });
  assert.deepEqual(r, [
    { to: "+12155550111", kind: "primary" },
    { to: "+12155550122", kind: "backup" },
    { to: "+12155550133", kind: "backup" },
    { to: "+17244650440", kind: "office" },
  ]);
});

test("buildRingdown caps the number of targets", () => {
  const r = buildRingdown({ primary: "+1a", others: ["+1b", "+1c", "+1d", "+1e"], office: "+1z", maxTargets: 2 });
  assert.equal(r.length, 2);
  assert.equal(r[0].kind, "primary");
});

test("buildRingdown dedupes the same number across E.164 / national formats", () => {
  // The nurse's cell and the configured office are the same line in two
  // spellings — it must ring once, not twice (which would also crowd out a
  // real backup nurse under the cap).
  const r = buildRingdown({
    primary: "+12155550100",
    others: ["2155550100", "+12155550122"],
    office: "(215) 555-0100",
  });
  assert.deepEqual(r, [
    { to: "+12155550100", kind: "primary" },
    { to: "+12155550122", kind: "backup" },
  ]);
});

test("buildRingdown tolerates a missing primary (office-only fallback)", () => {
  const r = buildRingdown({ primary: null, others: [], office: "+17244650440" });
  assert.deepEqual(r, [{ to: "+17244650440", kind: "office" }]);
  assert.deepEqual(buildRingdown({}), []);
});

test("nextRingdownTarget walks the list and stops at the end", () => {
  const t = buildRingdown({ primary: "+1a", office: "+1z" });
  assert.deepEqual(nextRingdownTarget(t, 0), { to: "+1a", kind: "primary" });
  assert.deepEqual(nextRingdownTarget(t, 1), { to: "+1z", kind: "office" });
  assert.equal(nextRingdownTarget(t, 2), null);
  assert.equal(nextRingdownTarget(t, -1), null);
  assert.equal(nextRingdownTarget(null, 0), null);
});

test("isUnansweredHangup advances only on Telnyx callee-no-answer causes", () => {
  // Official Telnyx HangupCause values that mean the dialed party didn't answer.
  for (const c of ["no_answer", "user_busy", "call_rejected", "timeout", "not_found", "originator_cancel"]) {
    assert.equal(isUnansweredHangup(c), true, c);
    assert.equal(isUnansweredHangup(c.toUpperCase()), true, c);
  }
  // Answered-then-cleared / duration-cap / unknown — do NOT keep ringing.
  for (const c of ["normal_clearing", "time_limit", "unspecified", ""]) {
    assert.equal(isUnansweredHangup(c), false, c);
  }
  // FreeSWITCH-era leftovers must not be treated as Telnyx vocabulary.
  assert.equal(isUnansweredHangup("unallocated_number"), false);
  assert.equal(isUnansweredHangup("no_user_response"), false);
  assert.equal(isUnansweredHangup("recovery_on_timer_expire"), false);
  assert.equal(isUnansweredHangup(undefined), false);
});
