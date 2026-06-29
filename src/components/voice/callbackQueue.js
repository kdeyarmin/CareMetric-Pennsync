/**
 * callbackQueue — pure helpers that turn the call log into a prioritized "who
 * needs a call back" worklist. Builds on the CallLog fields surfaced in the
 * Phone Center (status, disposition, has_voicemail) so missed calls, requested
 * callbacks, and voicemails don't fall through the cracks. Pure and unit-tested,
 * like the other voice/messaging utils.
 */

// Dispositions that mean the call is handled — these drop out of the queue.
const RESOLVED = new Set(["resolved", "no_action"]);

// Reason + priority (lower sorts first) for why a call needs a callback.
const REASONS = {
  callback_requested: { label: "Callback requested", priority: 1 },
  voicemail: { label: "Voicemail", priority: 2 },
  follow_up_needed: { label: "Follow-up needed", priority: 3 },
  missed: { label: "Missed call", priority: 4 },
};

/**
 * Why this call needs a callback, or null if it doesn't. An explicit
 * resolved/no-action disposition always clears it. Otherwise an explicit
 * disposition wins, then a voicemail, then an unanswered inbound masked call.
 */
export function callbackReason(call) {
  if (!call) return null;
  if (RESOLVED.has(call.disposition)) return null;
  if (call.disposition === "callback_requested") return REASONS.callback_requested.label;
  if (call.disposition === "follow_up_needed") return REASONS.follow_up_needed.label;
  if (call.has_voicemail) return REASONS.voicemail.label;
  const missed = call.status === "no_answer" || call.status === "failed";
  if (missed && call.direction === "inbound" && call.call_mode === "masked_bridge") return REASONS.missed.label;
  return null;
}

/** True when the call belongs in the callback queue. */
export function needsCallback(call) {
  return callbackReason(call) !== null;
}

function priorityOf(call) {
  if (call.disposition === "callback_requested") return REASONS.callback_requested.priority;
  if (call.disposition === "follow_up_needed") return REASONS.follow_up_needed.priority;
  if (call.has_voicemail) return REASONS.voicemail.priority;
  return REASONS.missed.priority;
}

/**
 * Build the callback worklist: keep only calls that need a callback, annotate
 * each with { reason, priority }, and sort by priority (callback requests first)
 * then most-recent first.
 */
export function buildCallbackQueue(calls) {
  return (Array.isArray(calls) ? calls : [])
    .filter(needsCallback)
    .map((call) => ({ ...call, reason: callbackReason(call), priority: priorityOf(call) }))
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return new Date(b.created_date).getTime() - new Date(a.created_date).getTime();
    });
}

/** Count of calls needing a callback (for a tab badge). */
export function callbackCount(calls) {
  return (Array.isArray(calls) ? calls : []).filter(needsCallback).length;
}
