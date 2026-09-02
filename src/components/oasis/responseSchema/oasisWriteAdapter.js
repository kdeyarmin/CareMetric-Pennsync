// Browser OASIS persistence is intentionally unavailable. OASISAssessment is
// source-locked to service-role writes, and the hosted app does not yet have a
// server-owned tenant + patient/chart authorization broker. Client-side flags,
// User agency fields, and direct entity calls are not authorization boundaries.

const pausedResult = () => ({
  ok: false,
  reason: "tenant_security_validation_pending",
  detail: "OASIS response saving is temporarily unavailable pending tenant and patient-access security validation.",
});

/**
 * Future v2 adapter. Deliberately performs no browser invocation or entity I/O.
 */
export async function saveOfficialResponses() {
  return pausedResult();
}

/**
 * Legacy drafts are also paused: a direct browser entity write would bypass
 * the protected boundary and is denied by OASISAssessment write RLS.
 */
export async function saveLegacyScreeningDraft() {
  return pausedResult();
}
