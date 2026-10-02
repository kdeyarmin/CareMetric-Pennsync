import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { APPROVER_TENANT_ROLES, approverOptions, mayApprove, reconcileApprover } from "./approverCandidates.js";

/**
 * The leave request form's half of the shared approver predicate.
 *
 * `src/pages/TimeOff.jsx` carried `u.role === "admin" || u.account_type ===
 * "agency_admin" || u.is_manager === true` byte for byte with `Timesheets.jsx`.
 * This change moves THIS screen to the module; the timesheet moves in its own,
 * and the two are independent with no ordering between them, so on this branch
 * that file is still on the inline copy. The module's own branch behaviour is
 * covered here as well as beside the timesheet, deliberately: either change can
 * land first, and a module arriving without the assertions that describe it is
 * how a shared predicate goes quietly wrong for the second caller.
 */
const recordMigration = (name) => readFileSync(new URL(
  `../../../services/authority-store/supabase/record-migrations/${name}`,
  import.meta.url), "utf8");

/** A roster page as the OWNED store answers it: a tenant role, no `role`. */
const owned = (email, tenant_role, extra = {}) =>
  ({ email, tenant_role, full_name: `Synthetic ${email}`, ...extra });
/** The same person as BASE44 answers it: the carried profile's own labels. */
const carried = (email, extra = {}) => ({ email, full_name: `Synthetic ${email}`, ...extra });

test("the owned path offers exactly the two roles the leave submit accepts", () => {
  const roster = [
    owned("admin@x.invalid", "agency_admin"),
    owned("manager@x.invalid", "manager"),
    owned("nurse@x.invalid", "clinician"),
    owned("office@x.invalid", "office_staff"),
    owned("social@x.invalid", "social_worker"),
  ];
  assert.deepEqual(approverOptions(roster, "nobody@x.invalid").map((a) => a.email),
    ["admin@x.invalid", "manager@x.invalid"]);
});

test("a self-asserted label cannot put somebody on the leave form's list", () => {
  // The case the list used to get wrong, and the reason the leave form's own
  // submit refuses `PENNSYNC_TIME_OFF_APPROVER_INVALID` for this person: all
  // three of the old predicate's fields are set on a clinician's row, and the
  // authoritative `tenant_role` beside them says clinician.
  const lying = owned("nurse@x.invalid", "clinician", {
    role: "admin", account_type: "agency_admin", is_manager: true,
  });
  assert.equal(mayApprove(lying), false);
  assert.deepEqual(approverOptions([lying], "other@x.invalid"), []);
  // And the branch is chosen by the PRESENCE of a tenant role, not its value, so
  // an owned row for an unprivileged colleague never falls through to the labels.
  assert.equal(mayApprove({ ...lying, tenant_role: "" }), false);
  assert.equal(mayApprove({ email: "x@x.invalid", tenant_role: null, role: "admin" }), true,
    "null is absence, so the carried labels are the only answer available");
});

test("the Base44 path keeps its superset, because nothing authoritative reaches it", () => {
  assert.equal(mayApprove(carried("a@x.invalid", { role: "admin" })), true);
  assert.equal(mayApprove(carried("b@x.invalid", { account_type: "agency_admin" })), true);
  assert.equal(mayApprove(carried("c@x.invalid", { is_manager: true })), true);
  assert.equal(mayApprove(carried("d@x.invalid", { is_manager: "yes" })), false,
    "`=== true`, which the old predicate was already careful about");
  assert.equal(mayApprove(carried("e@x.invalid")), false);
  assert.equal(mayApprove({ tenant_role: "manager" }), false, "a row with no address is dropped");
});

test("a caller is never offered themselves, and the option carries what the form draws", () => {
  const roster = [owned("me@x.invalid", "manager"), owned("them@x.invalid", "manager")];
  assert.deepEqual(approverOptions(roster, "me@x.invalid").map((a) => a.email),
    ["them@x.invalid"]);
  assert.deepEqual(approverOptions(null, "me@x.invalid"), []);
  const [option] = approverOptions([carried("a@x.invalid", { role: "admin" })], "me@x.invalid");
  assert.equal(option.name, "Synthetic a@x.invalid");
  assert.equal(option.role, "admin", 'the form draws "(Admin)" from this');
  const [nameless] = approverOptions([{ email: "c@x.invalid", tenant_role: "manager" }], "me@x.invalid");
  assert.equal(nameless.name, "c@x.invalid", "the name falls back to the address, never blank");
});

test("the role set is the one BOTH submits validate against", () => {
  // Re-derived from the migrations rather than trusted from the comment beside
  // the constant, and BOTH are asserted because they are independent
  // declarations in SQL. Nothing in the store makes them move together, and a
  // check of only one would pass while the other form drifted — which is the
  // shape this module exists to stop.
  const timeOff = recordMigration("20260920230000_contract_time_off.sql");
  const leave = /if v_manager_role not in \(([^)]*)\) then/.exec(timeOff);
  assert.ok(leave, "the leave submit's approver role gate must be findable");
  assert.deepEqual([...leave[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort(),
    [...APPROVER_TENANT_ROLES].sort());

  const timesheet = recordMigration("20260920360000_contract_timesheet.sql");
  const sheet = /if v_manager\.tenant_role not in \(([^)]*)\) then/.exec(timesheet);
  assert.ok(sheet, "the timesheet submit's approver role gate must be findable");
  assert.deepEqual([...sheet[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort(),
    [...APPROVER_TENANT_ROLES].sort());
});

test("the leave REVIEW gate names a role this list offers", () => {
  // The defect from the other end. If the review gate admitted a role the form
  // does not offer, or the form offered one review refuses, somebody would be
  // sent a request they cannot then decide — which is what the forward migration
  // in this change is fixing in the store.
  const forward = recordMigration("20260920740000_time_off_review_approver_role.sql");
  const review = /or \(v_role = '([a-z_]+)'\n\s+and coalesce\(v_row\."manager_email"/.exec(forward);
  assert.ok(review, "the review gate's named-approver role must be findable");
  assert.ok(APPROVER_TENANT_ROLES.includes(review[1]),
    `the review gate names ${review[1]}, which this list does not offer`);
});

test("the leave page asks the module and no longer reads the profile labels", () => {
  // Read from the source rather than rendered, because what matters is that the
  // old predicate is GONE from the page: a page that imported the module and
  // kept its own filter beside it would pass every assertion above.
  const page = readFileSync(new URL("../../pages/TimeOff.jsx", import.meta.url), "utf8");
  assert.match(page, /import \{ approverOptions \} from "@\/components\/approvals\/approverCandidates"/);
  assert.match(page, /return approverOptions\(scoped, currentUser\?\.email\);/);
  // The labels still appear elsewhere on the page — `isApprover` reads
  // `is_manager` to decide which TAB a person sees, which is a view concern and
  // not an authorization one — so the assertion is scoped to the candidate
  // query's own predicate rather than to the whole file.
  assert.doesNotMatch(page,
    /u\.role === "admin" \|\| u\.account_type === "agency_admin" \|\| u\.is_manager === true/,
    "the old candidate predicate must be gone, not merely unused");
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
  // list is `[]` either way — so clearing on empty would wipe a valid default
  // on every first render and break the route-to-administrators fallback.
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

test("the leave form reconciles rather than carrying a stale default", () => {
  const form = readFileSync(new URL("../timeoff/RequestTimeOffForm.jsx", import.meta.url), "utf8");
  assert.match(form, /reconcileApprover\(\{/, "the form must ask the shared reducer");
  // The pre-select that used to stand alone is gone: it set the profile default
  // without consulting the list, which is the defect.
  assert.doesNotMatch(form, /prev\.manager_email \? prev : \{ \.\.\.prev, manager_email: defaultManagerEmail \}/);
});
