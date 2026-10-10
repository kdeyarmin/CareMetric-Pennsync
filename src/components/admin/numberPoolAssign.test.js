import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assignPayload, cellOnFile, cellTail, searchResultDetail } from "./numberPoolAssign.js";

/**
 * The bridge-cell half of the number pool.
 *
 * The property this file exists for is the last one: a BLANK submission must
 * leave the nurse's stored mobile number alone. It became worth pinning when the
 * roster stopped carrying the full number
 * (`20260920720000_roster_phone_provisioned.sql`) and the panel's assign input
 * stopped being pre-filled with it. Pre-filling the MASK instead is the obvious
 * alternative, and the handler would answer 400 for it — so a test that only
 * checked "something is sent" would have passed for every version of this.
 */

/** A roster page as the OWNED store answers it: presence and a mask, no number. */
const OWNED = [
  { email: "nurse@example.invalid", has_personal_cell: true, personal_cell_masked: "(•••) •••-0199" },
  { email: "new@example.invalid", has_personal_cell: false, personal_cell_masked: null },
];
/** The same page as BASE44 answers it: the raw column, no presence key. */
const BASE44 = [
  { email: "nurse@example.invalid", personal_cell_e164: "+12155550199" },
  { email: "new@example.invalid", personal_cell_e164: null },
];

test("a cell on file is recognised on both backends", () => {
  for (const [name, users] of Object.entries({ owned: OWNED, base44: BASE44 })) {
    assert.equal(cellOnFile(users, "nurse@example.invalid"), true, name);
    assert.equal(cellOnFile(users, "new@example.invalid"), false, name);
    // A nurse not on this page at all is not "on file", and must not throw.
    assert.equal(cellOnFile(users, "absent@example.invalid"), false, name);
  }
});

test("a false presence key is an answer and is not read as a missing one", () => {
  // The owned store answers `false` for a nurse with no cell. A reader written
  // with `??` or `||` would fall through to `personal_cell_e164`, which is
  // absent from an owned roster row, and reach the same answer by luck. This
  // row makes the two disagree: presence says no and a stale raw column says
  // yes, and the authoritative key must win.
  const conflicting = [{
    email: "nurse@example.invalid",
    has_personal_cell: false,
    personal_cell_e164: "+12155550199",
  }];
  assert.equal(cellOnFile(conflicting, "nurse@example.invalid"), false);
});

test("an unprivileged roster row reads as no cell rather than throwing", () => {
  // Every telecom key is null for a caller the contract does not privilege. The
  // panel is admin-only, so this is the shape it should never see — and `null`
  // is not a boolean, so it falls through to the raw column and finds nothing.
  const unprivileged = [{
    email: "nurse@example.invalid", has_personal_cell: null, personal_cell_masked: null,
  }];
  assert.equal(cellOnFile(unprivileged, "nurse@example.invalid"), false);
  assert.equal(cellTail(unprivileged, "nurse@example.invalid"), "");
});

test("the tail is the store mask where there is one, and the browser mask otherwise", () => {
  assert.equal(cellTail(OWNED, "nurse@example.invalid"), "(•••) •••-0199");
  assert.equal(cellTail(BASE44, "nurse@example.invalid"), "(•••) •••-0199",
    "the browser fallback must agree with the store, or the panel would show two forms");
  assert.equal(cellTail(OWNED, "new@example.invalid"), "");
  assert.equal(cellTail(BASE44, "new@example.invalid"), "");
  assert.equal(cellTail(OWNED, "absent@example.invalid"), "");
});

test("the tail never contains the digits it is masking", () => {
  // The whole point of the change, asserted on the output rather than on the
  // implementation: whichever backend answered, what the panel renders carries
  // the last four digits and nothing before them.
  for (const users of [OWNED, BASE44]) {
    const shown = cellTail(users, "nurse@example.invalid");
    assert.ok(shown.endsWith("0199"));
    assert.ok(!shown.includes("2155"), `the exchange must not be shown: ${shown}`);
    assert.ok(!shown.includes("+1"), `nor the country code: ${shown}`);
  }
});

test("a blank submission omits the cell, which is what keeps the stored one", () => {
  // `managePhoneNumberPool`'s assign sets the column only when the key arrives
  // with a value it can normalize, so an ABSENT key is how the stored number
  // survives. Asserted with `hasOwn` rather than by value: a key present and
  // undefined serializes away in JSON and would pass a `=== undefined` check
  // while being a different payload.
  for (const cell of [undefined, null, "", "   ", "\t"]) {
    const payload = assignPayload({ id: "p1", email: "nurse@example.invalid", cell });
    assert.ok(!Object.hasOwn(payload, "personal_cell_e164"),
      `a ${JSON.stringify(cell)} cell must not reach the handler at all`);
    assert.deepEqual(payload, {
      action: "assign", id: "p1", target_user_email: "nurse@example.invalid",
    });
  }
});

test("an entered cell is trimmed and sent", () => {
  assert.deepEqual(assignPayload({ id: "p1", email: "n@x.invalid", cell: "  +12155550199 " }), {
    action: "assign", id: "p1", target_user_email: "n@x.invalid",
    personal_cell_e164: "+12155550199",
  });
});

test("the panel's assign input is never pre-filled, and the payload is this builder's", () => {
  // Two source reads, because the property is about what the COMPONENT does and
  // neither function above can see it.
  //
  // The mask is what a pre-fill would put there now, and the handler refuses it:
  // `normalizeE164` sees four digits, matches none of its length branches and
  // answers null, so the whole assign fails with 400 rather than writing the
  // mask. That makes a pre-fill break reassignment for every nurse who has a
  // cell on file — loudly, which is the only good thing about it.
  const panel = readFileSync(new URL("./NumberPoolPanel.jsx", import.meta.url), "utf8");
  assert.match(panel, /value=\{pickedCell\[n\.id\] \?\? ""\}/,
    "the assign cell input must start empty, with no fallback to a stored or masked value");
  assert.ok(!/value=\{pickedCell\[n\.id\] \?\? \(/.test(panel),
    "a parenthesised fallback is how the pre-fill was written; it must not come back");
  assert.match(panel, /call\(assignPayload\(vars\)\)/,
    "the assign payload must be this module's, so the omission above is the one that ships");

  // And the handler's own rule, read from its source: the column is written only
  // when a value survives normalization. If this line changes, the omission
  // above stops meaning "keep".
  const handler = readFileSync(
    new URL("../../../base44/functions/managePhoneNumberPool/entry.ts", import.meta.url), "utf8");
  assert.match(handler, /if \(cellNum\) update\.personal_cell_e164 = cellNum;/,
    "an absent personal_cell_e164 must leave the stored value alone");
});

test("a number-search result is described by place and cost, and by nothing it lacks", () => {
  assert.equal(
    searchResultDetail({ e164: "+12155550101", locality: "Philadelphia", region: "PA", monthly_cost: "1.00", upfront_cost: "1.00", currency: "USD" }),
    "Philadelphia, PA · $1.00/mo + $1.00 upfront",
  );
  assert.equal(searchResultDetail({ rate_center: "PHILADELPHIA", region: "PA", monthly_cost: "1.00", upfront_cost: "0.00", currency: "USD" }),
    "PHILADELPHIA, PA · $1.00/mo", "a zero upfront cost is not shown");
  assert.equal(searchResultDetail({ region: "ON", monthly_cost: "2.50", currency: "CAD" }), "ON · 2.50 CAD/mo");
  // An older backend answered with the number alone: nothing extra is shown.
  assert.equal(searchResultDetail({ e164: "+12155550101" }), "");
});
