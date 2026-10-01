import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { APPROVER_TENANT_ROLES, approverOptions, mayApprove, reconcileApprover } from "./approverCandidates.js";

/** A roster page as the OWNED store answers it: a tenant role, no `role`. */
const owned = (email, tenant_role, extra = {}) =>
  ({ email, tenant_role, full_name: `Synthetic ${email}`, ...extra });
/** The same person as BASE44 answers it: the carried profile's own labels. */
const carried = (email, extra = {}) => ({ email, full_name: `Synthetic ${email}`, ...extra });

test("the owned path offers exactly the two roles the submit accepts", () => {
  const roster = [
    owned("admin@x.invalid", "agency_admin"),
    owned("manager@x.invalid", "manager"),
    owned("nurse@x.invalid", "clinician"),
    owned("office@x.invalid", "office_staff"),
    owned("social@x.invalid", "social_worker"),
    owned("spiritual@x.invalid", "spiritual_care"),
  ];
  assert.deepEqual(approverOptions(roster, "nobody@x.invalid").map((a) => a.email),
    ["admin@x.invalid", "manager@x.invalid"]);
});

test("a self-asserted label cannot put somebody on the owned list", () => {
  // The case the list used to get wrong. All three of the old predicate's fields
  // are set on a clinician's row, and the authoritative `tenant_role` beside them
  // says clinician — so a reader consulting the labels would offer this person,
  // and the submit would refuse them.
  const lying = owned("nurse@x.invalid", "clinician", {
    role: "admin", account_type: "agency_admin", is_manager: true,
  });
  assert.equal(mayApprove(lying), false);
  assert.deepEqual(approverOptions([lying], "other@x.invalid"), []);
});

test("the Base44 path keeps its superset, because nothing authoritative reaches it", () => {
  // Not a narrowing opportunity: that path's `User.list` returns only the carried
  // profile row, so there is no better predicate available in the browser, and its
  // own submit re-derives the nominee through `withTrustedClaims`. Changing this
  // half would make it differently wrong, not more correct.
  assert.equal(mayApprove(carried("a@x.invalid", { role: "admin" })), true);
  assert.equal(mayApprove(carried("b@x.invalid", { account_type: "agency_admin" })), true);
  assert.equal(mayApprove(carried("c@x.invalid", { is_manager: true })), true);
  assert.equal(mayApprove(carried("d@x.invalid", { is_manager: false })), false);
  assert.equal(mayApprove(carried("e@x.invalid")), false);
  // `is_manager` must be the boolean, not anything truthy, which is what the old
  // predicate's `=== true` was already careful about.
  assert.equal(mayApprove(carried("f@x.invalid", { is_manager: "yes" })), false);
});

test("the two branches are chosen by the presence of a tenant role, not by its value", () => {
  // An owned row for somebody holding NO approver role must not fall through to
  // the carried labels. `typeof === "string"` rather than truthiness: a role of
  // `""` would be falsy and is still an answer from the owned store.
  const refused = owned("nurse@x.invalid", "clinician", { role: "admin" });
  assert.equal(mayApprove(refused), false, "a present tenant_role is the whole answer");
  assert.equal(mayApprove({ ...refused, tenant_role: "" }), false);
  // And an unprivileged roster row, where every projected detail is null, offers
  // nobody rather than throwing.
  assert.equal(mayApprove({ email: "x@x.invalid", tenant_role: null, role: null }), false);
});

test("a caller is never offered themselves, and a row with no address is dropped", () => {
  const roster = [
    owned("me@x.invalid", "manager"),
    owned("them@x.invalid", "manager"),
    { tenant_role: "manager" },
  ];
  assert.deepEqual(approverOptions(roster, "me@x.invalid").map((a) => a.email),
    ["them@x.invalid"]);
  assert.deepEqual(approverOptions(null, "me@x.invalid"), []);
});

test("the option carries a name, and the roles the form may label with", () => {
  const [base44Option] = approverOptions([carried("a@x.invalid", { role: "admin" })], "me@x.invalid");
  assert.equal(base44Option.name, "Synthetic a@x.invalid");
  assert.equal(base44Option.role, "admin", 'the form draws "(Admin)" from this');
  const [ownedOption] = approverOptions([owned("b@x.invalid", "agency_admin")], "me@x.invalid");
  assert.equal(ownedOption.role, undefined,
    "D23 keeps the self-editable `role` off the roster, so the label is absent there");
  assert.equal(ownedOption.tenant_role, "agency_admin",
    "and the authoritative value is carried through so a consumer can label with it");
  // The name falls back to the address rather than being blank, which is what the
  // roster needs for a colleague whose name is not recorded.
  const [nameless] = approverOptions([{ email: "c@x.invalid", tenant_role: "manager" }], "me@x.invalid");
  assert.equal(nameless.name, "c@x.invalid");
});

const recordMigration = (name) => readFileSync(new URL(
  `../../../services/authority-store/supabase/record-migrations/${name}`,
  import.meta.url), "utf8");

test("the role set is the one BOTH contracts validate against", () => {
  // Re-derived from the migrations rather than trusted from the comment beside
  // the constant. Each submit is what refuses a nominee, and if either role set
  // moves, this list has to move with it or that form starts offering people its
  // submit refuses again — which is the whole defect.
  //
  // Both are asserted because they are INDEPENDENT declarations in SQL. Nothing
  // in the store makes them move together, and a check of only the timesheet's
  // would pass while the leave form drifted, which is the shape this module
  // exists to stop.
  const timesheet = recordMigration("20260920360000_contract_timesheet.sql");
  const gate = /if v_manager\.tenant_role not in \(([^)]*)\) then/.exec(timesheet);
  assert.ok(gate, "the timesheet submit's approver role gate must be findable");
  const roles = [...gate[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...roles].sort(), [...APPROVER_TENANT_ROLES].sort());

  const timeOff = recordMigration("20260920230000_contract_time_off.sql");
  const leave = /if v_manager_role not in \(([^)]*)\) then/.exec(timeOff);
  assert.ok(leave, "the leave submit's approver role gate must be findable");
  const leaveRoles = [...leave[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...leaveRoles].sort(), [...APPROVER_TENANT_ROLES].sort());

  // And the REVIEW gate's named-approver leg must admit the same role, or a
  // colleague this list offers could be sent a sheet they cannot then review.
  const review = /or \(v_role = '([a-z_]+)' and v_email is not null/.exec(timesheet)
    ?? /or \(v_role = '([a-z_]+)' and v_email is not null/.exec(
      recordMigration("20260920730000_timesheet_review_approver_role.sql"));
  assert.ok(review, "the review gate's named-approver role must be findable");
  assert.ok(APPROVER_TENANT_ROLES.includes(review[1]),
    `the review gate names ${review[1]}, which this list does not offer`);
});

/**
 * `reconcileApprover`, and the two states an empty list conflates.
 *
 * The cases are written against the FORM'S question — what value survives — and
 * not against the set arithmetic, because the defect was never the arithmetic.
 * It was that nobody asked the question at all once the list arrived.
 */
const option = (email) => ({ email, name: email });
const OFFERED = [option("manager@example.invalid"), option("admin@example.invalid")];

test("an offered choice survives, and a stale one is cleared", () => {
  assert.equal(reconcileApprover({ current: "manager@example.invalid", offered: OFFERED }),
    "manager@example.invalid");
  // The demoted manager: still on the profile, no longer on the list. Left in
  // place the control shows its placeholder and submits this anyway, and the
  // contract refuses it naming somebody the employee never picked.
  assert.equal(reconcileApprover({ current: "demoted@example.invalid", offered: OFFERED }), "");
});

test("an EMPTY list changes nothing, because it is not an answer", () => {
  // Before the query resolves, and when the roster read is not permitted, the
  // list is `[]` either way — so clearing on empty would wipe a valid default on
  // every first render and break the route-to-administrators fallback.
  assert.equal(reconcileApprover({ current: "anybody@example.invalid", offered: [] }),
    "anybody@example.invalid");
  assert.equal(reconcileApprover({ current: "", offered: [], fallback: "boss@example.invalid" }),
    "boss@example.invalid");
});

test("the profile default is pre-selected only when the list offers it", () => {
  assert.equal(reconcileApprover({ current: "", offered: OFFERED, fallback: "admin@example.invalid" }),
    "admin@example.invalid");
  assert.equal(reconcileApprover({ current: "", offered: OFFERED, fallback: "demoted@example.invalid" }),
    "");
});

test("a choice the employee made is never replaced by the profile default", () => {
  assert.equal(reconcileApprover({
    current: "manager@example.invalid", offered: OFFERED, fallback: "admin@example.invalid",
  }), "manager@example.invalid");
});

test("it answers for the shapes a form actually hands it", () => {
  assert.equal(reconcileApprover(), "");
  assert.equal(reconcileApprover({ offered: null }), "");
  // An option with no address cannot be picked, so it cannot keep a value alive.
  assert.equal(reconcileApprover({ current: "x@example.invalid", offered: [{ name: "No address" }] }),
    "x@example.invalid", "a list of unpickable options is still an empty list of addresses");
});

test("the timesheet form reconciles rather than carrying a stale default", () => {
  const form = readFileSync(new URL("../timesheet/MyTimesheetForm.jsx", import.meta.url), "utf8");
  assert.match(form, /reconcileApprover\(\{/, "the form must ask the shared reducer");
  // The pre-select that used to stand alone is gone: it set the profile default
  // without consulting the list, which is the defect. And `editing` is now a
  // dependency rather than a guard, so loading a saved sheet reconciles too.
  assert.doesNotMatch(form, /if \(defaultManagerEmail && !editing\)/);
  assert.match(form, /\}, \[approvers, defaultManagerEmail, editing\]\);/);
});
