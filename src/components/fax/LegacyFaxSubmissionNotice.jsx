import React from "react";
import { Link } from "react-router";
import { CheckCircle2, X } from "lucide-react";
import {
  LEGACY_FAX_SUBMISSION_DETAIL,
  legacyFaxOriginationWarning,
} from "./legacyFaxSubmitFeedback";

/**
 * Durable confirmation for a legacy `sendFax` submit.
 *
 * The legacy path's only other feedback is a transient toast, after which the
 * sender clears its form — a successful send read as "nothing happened" and
 * invited a duplicate re-send (observed live 2026-10-14: two real faxes from
 * one double submission). This panel instead stays on screen, naming the
 * recipient and the submission time, until the user starts a new fax or
 * dismisses it. Copy stays honest about the legacy design: the fax was
 * submitted to Telnyx; delivery is confirmed at the destination, not tracked
 * inside PennSync, and the fax log entry stays "Sending".
 *
 * @param {{ submission: { recipientNumber: string, submittedAt: Date,
 *   originationWarning?: string | null } | null,
 *   onDismiss: () => void }} props
 */
export default function LegacyFaxSubmissionNotice({ submission, onDismiss }) {
  if (!submission) return null;
  const { recipientNumber, submittedAt, originationWarning } = submission;
  const when = submittedAt instanceof Date ? submittedAt : new Date(submittedAt);
  const warning = legacyFaxOriginationWarning(originationWarning);
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-left"
    >
      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium text-emerald-900">
          Fax submitted to {recipientNumber}
        </p>
        <p className="text-sm text-emerald-800">
          Submitted{" "}
          <time dateTime={when.toISOString()}>{when.toLocaleString()}</time>
          {". "}
          {LEGACY_FAX_SUBMISSION_DETAIL}
        </p>
        {warning && <p className="text-sm text-amber-800">{warning}</p>}
        <div className="pt-1">
          <Link
            to="/SendFax?tab=logs"
            className="text-sm font-medium text-emerald-900 underline underline-offset-2"
          >
            View fax log
          </Link>
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss submission confirmation"
        className="rounded-full p-1 text-emerald-700 hover:bg-emerald-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
