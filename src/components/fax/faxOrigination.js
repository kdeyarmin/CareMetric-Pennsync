/**
 * faxOrigination — which number an outbound fax is sent FROM.
 *
 * The product owner wants every return fax to reach the office machine
 * (2026-10-09). A receiving machine redials the calling NUMBER, not the
 * display name, so presenting the office number only as `from_display_name`
 * (the "blind line" masking) still let returns land on the Telnyx line. Telnyx
 * accepts a non-Telnyx `from` once it is a Verified Number on the account —
 * otherwise the fax fails `unverified_origination_number` (OpenAPI spec, read
 * 2026-10-09; `GET /v2/verified_numbers/{phone_number}` answers `data.verified_at`).
 *
 * So a sender asks Telnyx whether the office number is verified and sends from
 * it when it is; otherwise it keeps today's behaviour exactly (the blind line
 * plus the office display name) and reports a non-PHI warning category.
 *
 * Single source of truth for the `faxOrigination` shared helper:
 * base44/_shared/backendHelpers.mjs generates the inlined copy in sendFax,
 * sendBatchFax and sendAuthorizedReferralFax from these functions' source.
 */

export const FAX_ORIGINATION_UNVERIFIED = "office_fax_number_unverified";
export const FAX_ORIGINATION_UNAVAILABLE = "office_fax_verification_unavailable";

/**
 * The origination decision before any provider lookup. `lookup` is true only
 * when there is a distinct office number that could replace the blind line.
 * With no blind line the office number is itself the Telnyx line (the legacy,
 * pre-split configuration), so there is nothing to verify.
 */
export function faxOriginationPlan(officeE164, blindE164) {
  const office = typeof officeE164 === "string" && officeE164 ? officeE164 : null;
  const blind = typeof blindE164 === "string" && blindE164 ? blindE164 : null;
  if (!blind) return { from: office, office: null, lookup: false };
  if (!office || office === blind) return { from: blind, office: null, lookup: false };
  return { from: blind, office, lookup: true };
}

/**
 * A GET /v2/verified_numbers/{n} body proves the office number usable as `from`
 * only when it names exactly that number and carries a verification time.
 */
export function isVerifiedOriginationRecord(body, officeE164) {
  const data = body && typeof body === "object" && !Array.isArray(body) ? body.data : null;
  return !!data && typeof data === "object" && !Array.isArray(data)
    && typeof officeE164 === "string" && !!officeE164
    && data.phone_number === officeE164
    && typeof data.verified_at === "string"
    && Number.isFinite(Date.parse(data.verified_at));
}
