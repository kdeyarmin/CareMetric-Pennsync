// Maps a backend "<provider> ... not configured" error into a clear,
// user-facing message telling the user the feature needs an administrator to
// configure it. Several Base44 edge functions (audio transcription, AI fax
// cover pages, training course/video generation, telehealth tokens) return an
// HTTP 500 with a body like { error: "OpenAI API key not configured" } when the
// required API key / credential is missing. Without this helper that raw,
// technical string leaks straight to the end user.
//
// Returns a friendly admin-facing string when the error matches, otherwise
// null so callers can fall back to their existing error handling.

const SERVICE_LABELS = {
  openai: "audio transcription and AI documentation",
  anthropic: "AI fax cover-page generation",
  heygen: "AI training-video generation",
  telnyx: "telehealth and messaging",
};

/**
 * @param {unknown} err - Error object, Base44 SDK error, or raw string.
 * @returns {string|null} Admin-facing message, or null if not a config error.
 */
export function configNotReadyMessage(err) {
  const raw =
    err?.response?.data?.error ||
    err?.data?.error ||
    err?.message ||
    (typeof err === "string" ? err : "");

  if (!raw) return null;

  const match = /(openai|anthropic|heygen|telnyx)[\s\S]*?not configured/i.exec(raw);
  if (!match) return null;

  const label = SERVICE_LABELS[match[1].toLowerCase()] || "this AI feature";
  return `This ${label} feature isn't set up yet. Please ask an administrator to configure it.`;
}
