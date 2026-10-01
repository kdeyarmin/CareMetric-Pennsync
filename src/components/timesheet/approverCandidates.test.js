import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { APPROVER_TENANT_ROLES, approverOptions, mayApprove } from "./approverCandidates.js";

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

test("the role set is the one the contract validates against", () => {
  // Re-derived from the migration rather than trusted from the comment beside the
  // constant. Divergence 4 of the submit is what refuses a nominee, and if its
  // role set ever moves, this list has to move with it or the form starts
  // offering people the submit refuses again — which is the whole defect.
  const migration = readFileSync(new URL(
    "../../../services/authority-store/supabase/record-migrations/"
    + "20260920360000_contract_timesheet.sql", import.meta.url), "utf8");
  const gate = /if v_manager\.tenant_role not in \(([^)]*)\) then/.exec(migration);
  assert.ok(gate, "the submit's approver role gate must be findable");
  const roles = [...gate[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...roles].sort(), [...APPROVER_TENANT_ROLES].sort());

  // And the REVIEW gate's named-approver leg must admit the same role, or a
  // colleague this list offers could be sent a sheet they cannot then review.
  const review = /or \(v_role = '([a-z_]+)' and v_email is not null/.exec(migration)
    ?? /or \(v_role = '([a-z_]+)' and v_email is not null/.exec(readFileSync(new URL(
      "../../../services/authority-store/supabase/record-migrations/"
      + "20260920730000_timesheet_review_approver_role.sql", import.meta.url), "utf8"));
  assert.ok(review, "the review gate's named-approver role must be findable");
  assert.ok(APPROVER_TENANT_ROLES.includes(review[1]),
    `the review gate names ${review[1]}, which this list does not offer`);
});
