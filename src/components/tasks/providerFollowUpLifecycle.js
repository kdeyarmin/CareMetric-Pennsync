// providerFollowUpLifecycle — the closed loop for a clinical provider follow-up.
//
// THE RULE THIS MODULE EXISTS TO ENFORCE
// "A task was created" and "the provider was notified" are DIFFERENT FACTS, and
// PennSync must never present the first as the second. A nurse who reads
// "provider notified" on a screen that only means "somebody clicked a button"
// will not chase the call — and a patient with a declining wound waits.
//
// So the lifecycle separates, at every step:
//   what PennSync DID           (created a task, sent a fax, placed a call)
//   what PennSync OBSERVED      (a delivery receipt, a portal submission)
//   what a HUMAN reported       (spoke to the office, left a message)
//   what is still UNKNOWN       (sent, but no confirmation of receipt)
//
// `contactMade` and `responseReceived` are computed from the state, never from
// the mere existence of a record, and `describeState` returns wording that is
// honest about which of the four categories a state belongs to.
//
// Pure + offline so it runs under `node --test`. It may only import other plain
// `.js` modules with explicit extensions (never `.jsx`).

/**
 * Lifecycle states in order. `contact` says whether the provider has actually
 * been reached, and it is FALSE for every state up to and including "sent" —
 * dispatching a fax is not the same as a person receiving it.
 */
export const FOLLOW_UP_STATES = Object.freeze([
  {
    id: "identified",
    label: "Identified",
    help: "PennSync flagged something that may need provider input. Nothing has been sent.",
    contact: false,
    terminal: false,
  },
  {
    id: "task_created",
    label: "Task created",
    help: "A follow-up task exists in PennSync. The provider has NOT been contacted.",
    contact: false,
    terminal: false,
  },
  {
    id: "contact_attempted",
    label: "Contact attempted",
    help: "Someone tried to reach the provider (call, fax, portal). No confirmation yet.",
    contact: false,
    terminal: false,
  },
  {
    id: "sent",
    label: "Sent",
    help: "A message was dispatched. Dispatch is not receipt — no delivery confirmation yet.",
    contact: false,
    terminal: false,
  },
  {
    id: "delivered",
    label: "Delivered",
    help: "Delivery was confirmed by the sending channel. The provider has not yet responded.",
    contact: true,
    terminal: false,
  },
  {
    id: "response_received",
    label: "Provider response received",
    help: "The provider responded. Record what they said and any resulting order.",
    contact: true,
    terminal: false,
  },
  {
    id: "new_order_received",
    label: "New order received",
    help: "A new or changed order came back. Enter it in your EMR and update the plan of care there.",
    contact: true,
    terminal: false,
  },
  {
    id: "nurse_followup_required",
    label: "Nurse follow-up required",
    help: "The response needs action from the nurse before this can close.",
    contact: true,
    terminal: false,
  },
  {
    id: "resolved",
    label: "Resolved",
    help: "The loop is closed. Document the communication in your EMR if agency policy requires it.",
    contact: true,
    terminal: true,
  },
  {
    id: "escalated",
    label: "Escalated",
    help: "Raised to a supervisor or on-call because the provider could not be reached in time.",
    contact: false,
    terminal: false,
  },
]);

const BY_ID = new Map(FOLLOW_UP_STATES.map((s) => [s.id, s]));

/** Ids in lifecycle order. */
export const FOLLOW_UP_STATE_IDS = FOLLOW_UP_STATES.map((s) => s.id);

/**
 * The reminder that PennSync is not the legal record of a communication.
 * Shown wherever a follow-up is worked or closed.
 */
export const EMR_DOCUMENTATION_REMINDER =
  "Document this communication in the EMR if required by agency policy.";

/**
 * Legal transitions. Deliberately NOT a simple "any forward move": a follow-up
 * can be escalated from any open state, a delivery can arrive after a response
 * was already phoned in, and a resolved item does not silently reopen.
 */
const TRANSITIONS = {
  identified: ["task_created", "contact_attempted", "escalated", "resolved"],
  task_created: ["contact_attempted", "sent", "escalated", "resolved"],
  contact_attempted: ["sent", "delivered", "response_received", "escalated", "resolved"],
  sent: ["delivered", "response_received", "contact_attempted", "escalated", "resolved"],
  delivered: ["response_received", "new_order_received", "nurse_followup_required", "escalated", "resolved"],
  response_received: ["new_order_received", "nurse_followup_required", "resolved", "escalated"],
  new_order_received: ["nurse_followup_required", "resolved"],
  nurse_followup_required: ["resolved", "escalated"],
  escalated: ["contact_attempted", "sent", "delivered", "response_received", "resolved"],
  resolved: [],
};

/** @param {string} id */
export function getFollowUpState(id) {
  return BY_ID.get(id) || BY_ID.get("identified");
}

/** Whether a move is allowed. */
export function canTransition(from, to) {
  const allowed = TRANSITIONS[BY_ID.has(from) ? from : "identified"];
  return Array.isArray(allowed) && allowed.includes(to);
}

/**
 * Advance a follow-up, appending to its audit trail.
 *
 * @param {{ state?: string, history?: Array<object> }} current
 * @param {string} nextState
 * @param {{ actorEmail?: string|null, at?: string, method?: string, note?: string, observed?: boolean }} [meta]
 *        `observed` marks a state PennSync OBSERVED (a delivery receipt, a portal
 *        submission) as opposed to one a human reported. The distinction is kept
 *        in the record so an audit can tell them apart.
 * @returns {{ ok: boolean, reason?: string, state: string, history: Array<object> }}
 */
export function advanceFollowUp(current, nextState, meta = {}) {
  const history = Array.isArray(current?.history) ? [...current.history] : [];
  const from = BY_ID.has(current?.state) ? current.state : "identified";
  if (!BY_ID.has(nextState)) {
    return { ok: false, reason: `Unknown follow-up state: ${nextState}`, state: from, history };
  }
  if (!canTransition(from, nextState)) {
    return {
      ok: false,
      reason: `Cannot move from "${BY_ID.get(from).label}" to "${BY_ID.get(nextState).label}".`,
      state: from,
      history,
    };
  }
  history.push({
    state: nextState,
    at: meta.at || new Date().toISOString(),
    by: meta.actorEmail || null,
    method: meta.method || null,
    note: meta.note || "",
    // False by default: unless the channel confirmed it, this is a human's word.
    observed_by_pennsync: !!meta.observed,
  });
  return { ok: true, state: nextState, history };
}

/**
 * Plain-language summary of where a follow-up stands, worded so that no caller
 * can render it as "the provider was notified" when that is not established.
 *
 * @param {{ state?: string, history?: Array<object> }} followUp
 */
export function describeFollowUp(followUp) {
  const state = getFollowUpState(followUp?.state);
  const history = Array.isArray(followUp?.history) ? followUp.history : [];
  const last = history[history.length - 1] || null;
  return {
    state: state.id,
    label: state.label,
    help: state.help,
    // The single most important field in this module.
    providerContactEstablished: state.contact,
    contactStatement: state.contact
      ? "The provider has been reached."
      : "PennSync has no confirmation that the provider was reached.",
    responseReceived: ["response_received", "new_order_received", "nurse_followup_required", "resolved"].includes(state.id),
    open: !state.terminal,
    lastUpdate: last?.at || null,
    lastBy: last?.by || null,
    observed: !!last?.observed_by_pennsync,
    emrReminder: EMR_DOCUMENTATION_REMINDER,
  };
}

/** Age in whole hours since the last lifecycle update. */
function hoursSince(iso, now) {
  const t = Date.parse(String(iso || ""));
  if (!Number.isFinite(t)) return null;
  return Math.floor((now.getTime() - t) / 3600000);
}

/**
 * Build the unresolved-follow-up queue: open items, most urgent first.
 *
 * Ordering is deterministic — severity, then how long the item has sat without
 * movement — so two people looking at the queue see the same order.
 *
 * @param {Array<object>} followUps
 * @param {{ now?: Date, stalledHours?: number }} [options]
 */
export function buildUnresolvedQueue(followUps, { now = new Date(), stalledHours = 24 } = {}) {
  const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
  return (Array.isArray(followUps) ? followUps : [])
    .filter(Boolean)
    .map((f) => {
      const described = describeFollowUp(f);
      const idle = hoursSince(described.lastUpdate || f.created_at || f.created_date, now);
      return {
        ...f,
        ...described,
        idleHours: idle,
        // "Stalled" is about elapsed time with no movement, not about blame.
        stalled: described.open && idle != null && idle >= stalledHours,
      };
    })
    .filter((f) => f.open)
    .sort((a, b) => {
      const sev = (SEVERITY_RANK[a.severity] ?? 2) - (SEVERITY_RANK[b.severity] ?? 2);
      if (sev !== 0) return sev;
      return (b.idleHours ?? 0) - (a.idleHours ?? 0);
    });
}

/**
 * Map a follow-up state onto the Task entity's own status enum, so a PennSync
 * Task row stays consistent with the lifecycle without inventing enum values.
 * @param {string} state
 * @returns {"pending"|"in_progress"|"completed"}
 */
export function taskStatusFor(state) {
  if (state === "resolved") return "completed";
  if (state === "identified" || state === "task_created") return "pending";
  return "in_progress";
}
