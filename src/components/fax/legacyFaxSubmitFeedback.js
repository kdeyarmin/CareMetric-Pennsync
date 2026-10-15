/**
 * Toast copy for the legacy `sendFax` path.
 *
 * That sender still accepts a caller-supplied document URL and records no
 * provider-submission authority, so handleTelnyxStatusWebhook / pollFaxStatuses
 * acknowledge its events without writing (untracked_fax_row /
 * invalid_status_poll_authority). Callers must not claim the fax was
 * "delivered" or that delivery "is tracked". Status tracking requires
 * sendBatchFax / the authorized referral fax brokers.
 *
 * Also surfaces the non-PHI origination_warning categories sendFax already
 * returns when the office number is not a Telnyx Verified Number.
 */

import {
  FAX_ORIGINATION_UNAVAILABLE,
  FAX_ORIGINATION_UNVERIFIED,
} from "./faxOrigination.js";

export const LEGACY_FAX_SUBMITTED_TOAST =
  "Fax submitted — check the fax log for delivery status.";

/**
 * Body copy for the durable in-page submission confirmation
 * (LegacyFaxSubmissionNotice). Same honesty rule as the toast: the legacy
 * path was submitted to Telnyx; delivery is NOT tracked in-app, and the fax
 * log entry for this path stays "Sending" by design.
 */
export const LEGACY_FAX_SUBMISSION_DETAIL =
  "This send hands the fax to Telnyx and is not tracked to delivery inside PennSync — the fax log entry stays \"Sending\". Confirm arrival at the destination (for example, the receiving office's fax inbox).";

/**
 * Human copy for a sendFax/sendBatchFax origination_warning category, or null
 * when the code is absent / unknown (never invent a warning from silence).
 */
export function legacyFaxOriginationWarning(code) {
  if (code === FAX_ORIGINATION_UNVERIFIED) {
    return "Office fax number is not verified with Telnyx — this fax sent from the blind line. Verify the office number so returns reach the office machine.";
  }
  if (code === FAX_ORIGINATION_UNAVAILABLE) {
    return "Could not confirm whether the office fax number is verified with Telnyx — this fax sent from the blind line.";
  }
  return null;
}

/**
 * Success toast for a legacy sendFax accept, plus an optional warning when the
 * response carries an origination_warning category.
 *
 * @param {{ success: Function, warning?: Function }} toast
 * @param {{ origination_warning?: string } | null | undefined} [result]
 */
export function announceLegacyFaxSubmit(toast, result) {
  toast.success(LEGACY_FAX_SUBMITTED_TOAST);
  const warning = legacyFaxOriginationWarning(result?.origination_warning);
  if (warning && typeof toast.warning === "function") {
    toast.warning(warning);
  }
}
