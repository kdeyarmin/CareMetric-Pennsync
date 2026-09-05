/**
 * Security conclusions derived from global, provenance-free UserActivity rows
 * are not trustworthy. Keep the audit unavailable until every inspected input
 * is tenant-bound and a purpose-scoped broker can prove the authorized cohort.
 * Fail before SDK construction, authentication, request parsing, or any read.
 */
Deno.serve(() => Response.json({
  error: 'Security audit is unavailable pending immutable tenant provenance',
  code: 'SECURITY_AUDIT_PAUSED',
  available: false,
}, {
  status: 503,
  headers: { 'Cache-Control': 'no-store' },
}));
