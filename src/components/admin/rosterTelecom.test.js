import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasPersonalCell, personalCellTail } from "./rosterTelecom.js";

/**
 * The two roster shapes, and the four screens that read them.
 *
 * The cases below are split the way the defect was: the helpers answer
 * correctly for either shape, and the last two cases are about the SCREENS,
 * because a correct helper nobody calls is what this review found.
 */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * Neither fixture carries the other's keys, which is the point. A helper that
 * happened to read both would pass against a merged fixture and still invert in
 * the browser, since the owned projection omits the raw column entirely.
 */
const owned = (over = {}) => ({
  email: "nurse@example.invalid",
  has_personal_cell: true,
  personal_cell_masked: "(•••) •••-0199",
  ...over,
});
const base44 = (over = {}) => ({ email: "nurse@example.invalid", personal_cell_e164: "+15555550199", ...over });

test("hasPersonalCell reads the owned roster's boolean", () => {
  assert.equal(hasPersonalCell(owned()), true);
  assert.equal(hasPersonalCell(owned({ has_personal_cell: false, personal_cell_masked: "" })), false);
});

test("hasPersonalCell falls back to the raw column on the Base44 shape", () => {
  assert.equal(hasPersonalCell(base44()), true);
  assert.equal(hasPersonalCell(base44({ personal_cell_e164: "" })), false);
});

// The defect this module was extracted for. On the owned path the raw key is
// absent, so a truthiness test on it answers `false` for somebody the store has
// just said IS provisioned. That is not a blank field, it is an inversion, and
// it lands on exactly the people a provisioning screen is counting.
test("hasPersonalCell does not invert on a provisioned owned row", () => {
  const row = owned();
  assert.equal(row.personal_cell_e164, undefined);
  assert.equal(!!row.personal_cell_e164, false);
  assert.equal(hasPersonalCell(row), true);
});

test("hasPersonalCell treats an unreadable null as not provisioned", () => {
  // `null` is not a boolean, so this does take the fallback. What the case pins
  // is that the fallback cannot invent a cell out of an absent column.
  assert.equal(hasPersonalCell(owned({ has_personal_cell: null, personal_cell_masked: null })), false);
});

test("hasPersonalCell answers for a missing row rather than throwing", () => {
  assert.equal(hasPersonalCell(undefined), false);
  assert.equal(hasPersonalCell(null), false);
});

test("personalCellTail returns the owned roster's mask as it arrives", () => {
  assert.equal(personalCellTail(owned()), "(•••) •••-0199");
});

test("personalCellTail masks the raw column in the browser on the Base44 shape", () => {
  const shown = personalCellTail(base44());
  assert.notEqual(shown, "");
  assert.ok(!shown.includes("5555550199"), "the full number must not survive the mask");
  assert.ok(shown.includes("0199"), "the last four digits are what the screens print");
});

test("personalCellTail shows nothing when there is nothing to show", () => {
  assert.equal(personalCellTail(owned({ has_personal_cell: false, personal_cell_masked: "" })), "");
  assert.equal(personalCellTail(undefined), "");
});

test("personalCellTail never returns the full number from either shape", () => {
  assert.ok(!personalCellTail(owned()).includes("+1"));
  assert.ok(!personalCellTail(base44()).includes("+15555550199"));
});

/**
 * The screens, read as source.
 *
 * Asserting the absence from source rather than rendering each one is
 * deliberate: three of the four reads sat inside a `useMemo` or a JSX branch
 * that a shallow render does not reach, so a render-based test would have passed
 * for every version of this, including the broken one.
 */
const CONSUMERS = [
  "./NumberPoolPanel.jsx",
  "./PhoneProvisioningPanel.jsx",
  "./TelnyxSetupProgress.jsx",
  "./phoneAnalytics.js",
];

test("the screens ask about a personal cell through this module, not the raw column", () => {
  for (const path of CONSUMERS) {
    const source = read(path);
    assert.match(
      source,
      /from "(@\/components\/admin\/|\.\/)(rosterTelecom|numberPoolAssign)(\.js)?"/,
      `${path} should read the cell through the shared module`,
    );
    assert.doesNotMatch(
      source,
      /\bu(ser)?\??\.personal_cell_e164\b/,
      `${path} still reads the raw column, which the owned roster does not send`,
    );
  }
});

test("the screens ask the roster for an ordering it can serve", () => {
  // `full_name` is refused by `rosterOrder` before `listAgencyRoster` runs, and
  // can never be served: the carried user table has no name column at all. The
  // accepted set is READ from the route rather than retyped, so widening or
  // narrowing it there moves this case with it.
  const route = read("../../lib/independentEntityRoutes.js");
  const block = /const ROSTER_SORTS = Object\.freeze\(Object\.assign\(Object\.create\(null\), \{([\s\S]*?)\}\)\);/.exec(route);
  assert.ok(block, "ROSTER_SORTS could not be located in independentEntityRoutes.js");
  const accepted = [...block[1].matchAll(/(?:'([^']*)'|([A-Za-z_][\w]*))\s*:/g)].map((m) => m[1] ?? m[2]);
  assert.ok(accepted.includes("email"), `expected email among ${JSON.stringify(accepted)}`);
  assert.ok(!accepted.includes("full_name"), "full_name is servable after all — this case needs rewriting");

  for (const path of ["./NumberPoolPanel.jsx", "./PhoneProvisioningPanel.jsx", "./TelnyxSetupProgress.jsx"]) {
    const calls = [...read(path).matchAll(/User\.list\(\s*"([^"]*)"/g)].map((m) => m[1]);
    assert.ok(calls.length > 0, `${path} no longer lists users — this case needs rewriting`);
    for (const sort of calls) {
      assert.ok(accepted.includes(sort), `${path} sorts by ${sort}, which the roster refuses`);
    }
  }
});
