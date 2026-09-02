import { Info } from "lucide-react";
import { ACTIVE_OASIS_SPEC } from "./specs/registry.js";
import { clinicalReviewStatus, responseSetStatus, sourceCheckStatus } from "./specs/verification.js";

/**
 * The standing scope statement for every OASIS surface.
 *
 * PennSync is NOT the official OASIS completion or submission system — the
 * agency completes and submits OASIS in its EMR / iQIES. PennSync reviews,
 * explains and cross-checks what staff entered there. This notice is deliberately
 * always visible rather than tucked behind a disclosure: it is the sentence that
 * stops the OASIS Center reading as the official assessment.
 *
 * It also states the version PennSync's guidance is patterned after, that
 * PennSync's internal item set is abbreviated, and how much of that set a
 * qualified OASIS reviewer has actually signed off — so no one mistakes a
 * screening question for the CMS instrument, and the sign-off gap is visible
 * in the product rather than only in a document.
 */
export default function OasisScopeNotice({ className = "" }) {
  const review = clinicalReviewStatus();
  const source = sourceCheckStatus();
  const responses = responseSetStatus();
  return (
    <div
      role="note"
      className={`flex items-start gap-2 rounded-xl border border-navy-200 bg-navy-50 px-3 py-2.5 text-xs text-navy-900 ${className}`}
    >
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-navy-600" aria-hidden="true" />
      <div className="space-y-1">
        <p>
          <strong>PennSync assists with OASIS review — it is not the official assessment.</strong>{" "}
          Complete and submit the official OASIS in your agency&apos;s EMR. Nothing here is
          transmitted to CMS or iQIES.
        </p>
        <p className="text-navy-700">
          Guidance is patterned after <strong>{ACTIVE_OASIS_SPEC.label}</strong> (effective{" "}
          {ACTIVE_OASIS_SPEC.effective_date}). PennSync&apos;s internal item set is abbreviated and
          is not the CMS instrument — confirm item wording and response sets in your EMR.
        </p>
        {/* The sign-off gap belongs on screen, not only in an audit document:
            a classification nobody qualified has confirmed must not read as
            settled just because it is rendered confidently. */}
        {/* A CMS source check on 2026-09-01 found item numbers in PennSync's
            internal set that are retired or appear in no CMS manual. Those
            questions are kept as internal prompts, but a nurse must not go
            looking for them on the official assessment. */}
        {source.problems.length > 0 && (
          <p className="text-amber-900">
            <strong>
              {source.problems.length} of {source.total} items
            </strong>{" "}
            are retired CMS items or are not CMS item numbers. They are PennSync prompts only —
            enter official responses in your EMR.
          </p>
        )}
        {/* The response sets HAVE now been read against the CMS instrument
            (2026-09-01), so this no longer says they are unverified — it says
            what the read found, which is worse and more useful. The count is
            computed, never hardcoded, so it cannot drift from the registry. */}
        <p className="text-navy-700">
          Item numbers and titles are verified against the CMS manual, and answer choices have
          been read against it option by option.{" "}
          {responses.conflicts > 0 && (
            <strong className="text-amber-900">
              {responses.conflicts} of {responses.comparable} items have at least one answer
              choice that means something different on the official assessment — answer those from
              the wording in your EMR rather than copying the code.
            </strong>
          )}
          {review.complete && " Clinical use of these items is signed off by the agency."}
        </p>
      </div>
    </div>
  );
}
