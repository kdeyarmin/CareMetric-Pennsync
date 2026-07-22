export const UX_STATE_TYPES = Object.freeze(["empty", "loading", "success", "error", "destructive_confirmation"]);

export const DEFAULT_UX_STATE_COPY = Object.freeze({
  empty: { title: "No records yet", actionLabel: "Create or import a record", tone: "neutral" },
  loading: { title: "Loading records", actionLabel: null, tone: "neutral" },
  success: { title: "Changes saved", actionLabel: "View details", tone: "success" },
  error: { title: "We could not complete that action", actionLabel: "Try again", tone: "error" },
  destructive_confirmation: { title: "Confirm this change", actionLabel: "Confirm", tone: "warning" },
});

export function getUxStateCopy(type, overrides = {}) {
  const base = DEFAULT_UX_STATE_COPY[type] || DEFAULT_UX_STATE_COPY.empty;
  return { ...base, ...overrides, type: UX_STATE_TYPES.includes(type) ? type : "empty" };
}

export function validateUxStateCopy(copy = {}) {
  const missing = [];
  if (!UX_STATE_TYPES.includes(copy.type)) missing.push("type");
  if (!copy.title) missing.push("title");
  if (["empty", "error", "destructive_confirmation"].includes(copy.type) && !copy.actionLabel) missing.push("actionLabel");
  if (!copy.tone) missing.push("tone");
  return { valid: missing.length === 0, missing };
}
