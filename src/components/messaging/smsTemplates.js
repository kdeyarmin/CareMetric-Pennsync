/**
 * smsTemplates — reusable SMS templates with safe merge fields.
 *
 * Templates go beyond the one-tap quick replies: a nurse picks a template and
 * it is rendered with the current patient/nurse context before landing in the
 * compose box (the nurse always reviews and can edit before sending). Keeping
 * the rendering here — pure and unit-tested — mirrors smsUtils / smsQuickReplies.
 *
 * Merge fields are limited to low-sensitivity identifiers (a first name is
 * routine in appointment texting); templates must still avoid clinical detail.
 * Unknown tokens are left untouched so an authoring typo is visible rather than
 * silently dropped.
 */

/** The merge fields a template may reference, with a human label for the UI. */
export const MERGE_FIELDS = [
  { token: "{first_name}", label: "Patient first name" },
  { token: "{last_name}", label: "Patient last name" },
  { token: "{nurse_name}", label: "Your name" },
  { token: "{office}", label: "Main office number" },
];

const KNOWN_TOKENS = MERGE_FIELDS.map((f) => f.token.slice(1, -1).toLowerCase());

/** PHI-safe starter templates; an agency can override via AgencySettings.sms_templates. */
export const DEFAULT_TEMPLATES = [
  { label: "Appointment reminder", body: "Hi {first_name}, this is a reminder of your upcoming home visit. Reply here with any questions." },
  { label: "On my way", body: "Hi {first_name}, this is {nurse_name} from your care team. I'm on my way to your home now." },
  { label: "Missed you", body: "Hi {first_name}, I stopped by but wasn't able to reach you. Please call the office at {office} to reschedule." },
  { label: "Follow-up check-in", body: "Hi {first_name}, checking in from your care team. Let us know if you need anything before your next visit." },
];

/**
 * Render a template body against a context, replacing known {tokens}
 * case-insensitively. Missing context values become an empty string; unknown
 * tokens are left as-is. Collapses the double spaces an empty value can leave.
 */
export function renderTemplate(body, context = {}) {
  if (!body) return "";
  // Normalize context keys to lowercase for case-insensitive lookup.
  const ctx = {};
  for (const [k, v] of Object.entries(context)) ctx[k.toLowerCase()] = v == null ? "" : String(v);
  const rendered = String(body).replace(/\{([a-z0-9_]+)\}/gi, (match, name) => {
    const key = name.toLowerCase();
    if (KNOWN_TOKENS.includes(key)) return ctx[key] ?? "";
    return match; // leave unknown tokens visible
  });
  return rendered.replace(/[ \t]{2,}/g, " ").replace(/ +([,.!?])/g, "$1").trim();
}

/**
 * Build the merge context from the available objects. Only fields we can
 * populate are included; anything absent renders as empty.
 */
export function buildTemplateContext(input) {
  const src = input || {};
  return {
    first_name: src.patient?.first_name || "",
    last_name: src.patient?.last_name || "",
    nurse_name: src.user?.full_name || "",
    office: src.settings?.main_office_number_e164 || "",
  };
}

/**
 * Resolve the templates to offer. Accepts agency-configured templates as either
 * { label, body } objects or "Label | body" strings; falls back to the
 * built-in defaults when none are configured. Drops anything without a body.
 */
export function getTemplates(settings) {
  const configured = settings?.sms_templates;
  const source = Array.isArray(configured) && configured.length > 0 ? configured : DEFAULT_TEMPLATES;
  return source
    .map((item) => {
      if (typeof item === "string") {
        const idx = item.indexOf("|");
        if (idx === -1) {
          const body = item.trim();
          if (!body) return null;
          return { label: body.length > 24 ? `${body.slice(0, 24)}…` : body, body };
        }
        const label = item.slice(0, idx).trim();
        const body = item.slice(idx + 1).trim();
        if (!body) return null;
        return { label: label || (body.length > 24 ? `${body.slice(0, 24)}…` : body), body };
      }
      const body = (item?.body || "").trim();
      if (!body) return null;
      return { label: (item.label || body).trim(), body };
    })
    .filter(Boolean);
}
