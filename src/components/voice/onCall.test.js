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

test("isUnansweredHangup advances only on callee-no-answer causes", () => {
  for (const c of ["no_answer", "user_busy", "call_rejected", "timeout", "originator_cancel"]) {
    assert.equal(isUnansweredHangup(c), true, c);
  }
  // A plain caller hangup should NOT keep ringing.
  assert.equal(isUnansweredHangup("normal_clearing"), false);
  assert.equal(isUnansweredHangup(""), false);
  assert.equal(isUnansweredHangup(undefined), false);
});
