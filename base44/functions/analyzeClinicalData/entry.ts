/**
 * Unified clinical data analysis (event extraction, event analysis, trends).
 *
 * Paused 2026-09-10 (owner-approved). Nothing in the app calls this function,
 * and its patient gate treated the self-editable User.account_type claim as
 * platform-admin authority, so any signed-in account could self-promote and run
 * service-role analysis over another agency's patient, visit, and clinical-event
 * rows. Its extract_events action also ran service-role AI over caller text for
 * any account. Fail before SDK construction, authentication, request parsing,
 * data reads, or AI work until a tenant-authorized broker replaces it. The prior
 * implementation is in git history (commit 343d0151).
 */
Deno.serve(() => Response.json({
  error: 'Clinical data analysis is unavailable pending a tenant-authorized broker',
  code: 'CLINICAL_DATA_ANALYSIS_PAUSED',
  available: false,
}, {
  status: 503,
  headers: { 'Cache-Control': 'no-store' },
}));
