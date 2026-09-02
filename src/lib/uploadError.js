/**
 * Turns a failed `base44.integrations.Core.UploadFile` call into a message that
 * tells the user what actually went wrong and what to do about it.
 *
 * Every uploader in the app used to collapse all of these into one line —
 * "Failed to upload file. Please try again." — which is unactionable for the
 * cases that will never resolve by retrying (expired session, missing
 * permission, a file the server rejects as too large) and is simply wrong for
 * the cases where the upload itself succeeded.
 *
 * The Base44 SDK rejects with a `Base44Error` carrying `status`, `message`, and
 * the raw response `data` (see `@base44/sdk/dist/utils/axios-client`), so the
 * status code is the reliable signal. A rejection with no `status` at all means
 * the request never got a response — offline, DNS, CORS, or a dropped
 * connection.
 *
 * Kept free of React and the SDK so it can be unit-tested in isolation.
 */

// Server error bodies are sometimes an HTML error page or a stack trace. Only
// echo a server string when it is short and looks like prose, so a proxy's
// 500-page never lands in a toast.
const MAX_ECHOED_SERVER_MESSAGE = 160;

/** Best-effort read of the server's own explanation, or "" when there isn't a usable one. */
export function readUploadErrorDetail(error) {
  const raw =
    error?.response?.data?.detail ||
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.data?.detail ||
    error?.data?.message ||
    error?.data?.error ||
    error?.message ||
    (typeof error === "string" ? error : "");

  const text = String(raw || "").trim();
  if (!text) return "";
  if (text.length > MAX_ECHOED_SERVER_MESSAGE) return "";
  if (/^\s*</.test(text) || /<\/?[a-z][\s\S]*>/i.test(text)) return "";
  // Axios' own generic strings say nothing a user can act on.
  if (/^(network error|request failed with status code \d+)$/i.test(text)) return "";
  return text;
}

/**
 * Map an upload rejection to a single user-facing sentence.
 *
 * @param {unknown} error - The rejection from UploadFile.
 * @param {object} [options]
 * @param {string} [options.noun="file"] - What the user was uploading ("referral document").
 * @param {boolean} [options.online] - Override the browser's online state (for tests).
 * @returns {string} A complete, user-facing sentence.
 */
export function uploadFailureMessage(error, { noun = "file", online } = {}) {
  const isOnline =
    online !== undefined
      ? online
      : typeof navigator === "undefined" || navigator.onLine !== false;

  if (!isOnline) {
    return `You appear to be offline. Reconnect, then upload the ${noun} again.`;
  }

  const status = error?.status ?? error?.response?.status;
  const detail = readUploadErrorDetail(error);
  const withDetail = (sentence) => (detail ? `${sentence} (${detail})` : sentence);

  if (!status) {
    return `Couldn't reach the server to upload the ${noun}. Check your connection and try again.`;
  }

  if (status === 401) {
    return `Your session has expired. Sign in again, then re-upload the ${noun}.`;
  }
  if (status === 403) {
    return withDetail("You don't have permission to upload files. Ask an administrator to check your access.");
  }
  if (status === 404) {
    return "The upload service isn't reachable for this app. Ask an administrator to check the app configuration.";
  }
  if (status === 413) {
    return `The server rejected this ${noun} as too large. Split the document or upload a smaller scan.`;
  }
  if (status === 415) {
    return "The server rejected this file type. Convert the document to PDF and try again.";
  }
  if (status === 402) {
    return "This app's file-storage quota has been reached. Ask an administrator to review the plan.";
  }
  if (status === 429) {
    return "Too many uploads at once. Wait a few seconds and try again.";
  }
  if (status >= 500) {
    return "The file service is temporarily unavailable. Try again in a moment.";
  }

  return withDetail(`Couldn't upload the ${noun}.`);
}

/**
 * A successful HTTP response that carries no `file_url` is an upload failure the
 * caller must not treat as success — writing `document_url: undefined` onto a
 * record silently loses the document.
 */
export const MISSING_FILE_URL_MESSAGE =
  "The upload finished but the server returned no file link. Please try again.";
