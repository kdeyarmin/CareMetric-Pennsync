/**
 * smsQuickReplies — PHI-safe canned text snippets a nurse can insert with one
 * tap. Defaults are generic on purpose (no diagnoses, names, or other PHI);
 * an agency may override the list via AgencySettings.sms_quick_replies (an
 * array of strings, or of { label, text } objects).
 */

export const DEFAULT_QUICK_REPLIES = [
  { label: "Running late", text: "Running about 15 minutes late, thank you for your patience." },
  { label: "On my way", text: "I'm on my way to your home now." },
  { label: "Confirm visit", text: "Confirming our visit for tomorrow. Reply here with any questions." },
  { label: "Please call back", text: "I tried to reach you. Please call your care team when you have a moment." },
  { label: "Got your message", text: "Your care team received your message and will follow up shortly." },
];

/**
 * Resolve the quick replies to show. Falls back to the defaults when the agency
 * hasn't configured any. Accepts either plain strings or { label, text } rows
 * and normalizes both to { label, text }, dropping anything blank.
 */
export function getQuickReplies(settings) {
  const configured = settings?.sms_quick_replies;
  const source = Array.isArray(configured) && configured.length > 0 ? configured : DEFAULT_QUICK_REPLIES;
  return source
    .map((item) => {
      if (typeof item === "string") {
        const text = item.trim();
        if (!text) return null;
        return { label: text.length > 24 ? `${text.slice(0, 24)}…` : text, text };
      }
      const text = (item?.text || "").trim();
      if (!text) return null;
      return { label: (item.label || text).trim(), text };
    })
    .filter(Boolean);
}
