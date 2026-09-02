import test from "node:test";
import assert from "node:assert/strict";
import {
  EMR_DOCUMENTATION_REMINDER,
  FOLLOW_UP_STATES,
  FOLLOW_UP_STATE_IDS,
  advanceFollowUp,
  buildUnresolvedQueue,
  canTransition,
  describeFollowUp,
  getFollowUpState,
  taskStatusFor,
} from "./providerFollowUpLifecycle.js";

const NOW = new Date("2026-08-31T12:00:00.000Z");
const hoursBefore = (n) => new Date(NOW.getTime() - n * 3600000).toISOString();

// ── The rule this module exists to enforce ─────────────────────────────────

test("creating a task NEVER counts as the provider having been contacted", () => {
  const created = advanceFollowUp({ state: "identified" }, "task_created");
  const described = describeFollowUp(created);
  assert.equal(described.providerContactEstablished, false);
  assert.match(described.contactStatement, /no confirmation that the provider was reached/i);
  assert.match(described.help, /provider has NOT been contacted/i);
});

test("no state up to and including 'sent' claims the provider was reached", () => {
  for (const id of ["identified", "task_created", "contact_attempted", "sent"]) {
    assert.equal(getFollowUpState(id).contact, false, `${id} must not assert contact`);
  }
});

test("'sent' says plainly that dispatch is not receipt", () => {
  assert.match(getFollowUpState("sent").help, /Dispatch is not receipt/i);
});

test("no state label anywhere says the provider was notified", () => {
  for (const s of FOLLOW_UP_STATES) {
    assert.ok(
      !/provider (?:was )?notified/i.test(s.label),
      `"${s.label}" must not assert notification`,
    );
  }
});

test("delivery confirmed by the channel does establish contact", () => {
  assert.equal(getFollowUpState("delivered").contact, true);
  assert.equal(describeFollowUp({ state: "delivered" }).providerContactEstablished, true);
});

test("escalation does not imply the provider was reached", () => {
  // Escalating because nobody could be reached must not flip the contact flag.
  assert.equal(getFollowUpState("escalated").contact, false);
});

// ── Structure ──────────────────────────────────────────────────────────────

test("the documented lifecycle states are present", () => {
  for (const id of [
    "identified", "task_created", "contact_attempted", "sent", "delivered",
    "response_received", "new_order_received", "nurse_followup_required",
    "resolved", "escalated",
  ]) {
    assert.ok(FOLLOW_UP_STATE_IDS.includes(id), `missing state ${id}`);
  }
});

test("an unknown state id resolves to identified rather than throwing", () => {
  assert.equal(getFollowUpState("nonsense").id, "identified");
  assert.equal(getFollowUpState(undefined).id, "identified");
});

// ── Transitions ────────────────────────────────────────────────────────────

test("a legal transition appends an audit entry", () => {
  const out = advanceFollowUp({ state: "task_created" }, "contact_attempted", {
    actorEmail: "nurse@example.com",
    at: "2026-08-31T13:00:00.000Z",
    method: "phone",
    note: "Left a message with the office.",
  });
  assert.equal(out.ok, true);
  assert.equal(out.state, "contact_attempted");
  assert.deepEqual(out.history[0], {
    state: "contact_attempted",
    at: "2026-08-31T13:00:00.000Z",
    by: "nurse@example.com",
    method: "phone",
    note: "Left a message with the office.",
    observed_by_pennsync: false,
  });
});

test("a human-reported step is recorded as NOT observed by PennSync", () => {
  const reported = advanceFollowUp({ state: "sent" }, "response_received", { note: "MD called back" });
  assert.equal(reported.history[0].observed_by_pennsync, false);

  const observed = advanceFollowUp({ state: "sent" }, "delivered", { observed: true });
  assert.equal(observed.history[0].observed_by_pennsync, true);
});

test("an illegal transition is rejected and leaves the record untouched", () => {
  const start = { state: "identified", history: [{ state: "identified" }] };
  const out = advanceFollowUp(start, "new_order_received");
  assert.equal(out.ok, false);
  assert.equal(out.state, "identified");
  assert.equal(out.history.length, 1, "a rejected move must not append history");
  assert.match(out.reason, /Cannot move from/);
});

test("a resolved follow-up does not silently reopen", () => {
  const out = advanceFollowUp({ state: "resolved" }, "contact_attempted");
  assert.equal(out.ok, false);
  assert.equal(out.state, "resolved");
});

test("an unknown target state is rejected", () => {
  const out = advanceFollowUp({ state: "sent" }, "provider_agreed");
  assert.equal(out.ok, false);
  assert.match(out.reason, /Unknown follow-up state/);
});

test("any open state can be escalated", () => {
  for (const id of ["identified", "task_created", "contact_attempted", "sent", "delivered"]) {
    assert.ok(canTransition(id, "escalated"), `${id} must be escalatable`);
  }
  assert.equal(canTransition("resolved", "escalated"), false);
});

test("a response phoned in before a delivery receipt is allowed", () => {
  // Real offices call back before the fax receipt lands; the model must not
  // force a delivery confirmation that may never arrive.
  assert.ok(canTransition("sent", "response_received"));
});

// ── Description ────────────────────────────────────────────────────────────

test("every description carries the EMR documentation reminder", () => {
  assert.match(EMR_DOCUMENTATION_REMINDER, /Document this communication in the EMR/i);
  for (const id of FOLLOW_UP_STATE_IDS) {
    assert.equal(describeFollowUp({ state: id }).emrReminder, EMR_DOCUMENTATION_REMINDER);
  }
});

test("responseReceived is only true once a response actually came back", () => {
  assert.equal(describeFollowUp({ state: "delivered" }).responseReceived, false);
  assert.equal(describeFollowUp({ state: "response_received" }).responseReceived, true);
  assert.equal(describeFollowUp({ state: "new_order_received" }).responseReceived, true);
});

test("only resolved closes the loop", () => {
  assert.equal(describeFollowUp({ state: "resolved" }).open, false);
  for (const id of FOLLOW_UP_STATE_IDS.filter((i) => i !== "resolved")) {
    assert.equal(describeFollowUp({ state: id }).open, true, `${id} must stay open`);
  }
});

// ── Queue ──────────────────────────────────────────────────────────────────

test("the unresolved queue excludes closed items", () => {
  const queue = buildUnresolvedQueue([
    { id: "a", state: "resolved" },
    { id: "b", state: "sent" },
  ], { now: NOW });
  assert.deepEqual(queue.map((q) => q.id), ["b"]);
});

test("the queue orders by severity, then by how long it has sat still", () => {
  const queue = buildUnresolvedQueue([
    { id: "old-high", severity: "high", state: "sent", history: [{ at: hoursBefore(50) }] },
    { id: "new-critical", severity: "critical", state: "sent", history: [{ at: hoursBefore(1) }] },
    { id: "new-high", severity: "high", state: "sent", history: [{ at: hoursBefore(2) }] },
  ], { now: NOW });
  assert.deepEqual(queue.map((q) => q.id), ["new-critical", "old-high", "new-high"]);
});

test("an item with no movement past the threshold is marked stalled", () => {
  const [stalled, fresh] = buildUnresolvedQueue([
    { id: "stalled", state: "sent", history: [{ at: hoursBefore(30) }] },
    { id: "fresh", state: "sent", history: [{ at: hoursBefore(2) }] },
  ], { now: NOW, stalledHours: 24 });
  assert.equal(stalled.stalled, true);
  assert.equal(stalled.idleHours, 30);
  assert.equal(fresh.stalled, false);
});

test("an item with no timestamps at all is not falsely marked stalled", () => {
  const [only] = buildUnresolvedQueue([{ id: "x", state: "sent" }], { now: NOW });
  assert.equal(only.idleHours, null);
  assert.equal(only.stalled, false);
});

test("the queue never throws on junk input", () => {
  assert.deepEqual(buildUnresolvedQueue(null), []);
  assert.deepEqual(buildUnresolvedQueue([null, undefined]), []);
});

// ── Task entity mapping ────────────────────────────────────────────────────

test("lifecycle states map onto the Task status enum without inventing values", () => {
  const allowed = new Set(["pending", "in_progress", "completed"]);
  for (const id of FOLLOW_UP_STATE_IDS) {
    assert.ok(allowed.has(taskStatusFor(id)), `${id} -> ${taskStatusFor(id)} is not a Task status`);
  }
  assert.equal(taskStatusFor("identified"), "pending");
  assert.equal(taskStatusFor("task_created"), "pending");
  assert.equal(taskStatusFor("sent"), "in_progress");
  assert.equal(taskStatusFor("resolved"), "completed");
});
