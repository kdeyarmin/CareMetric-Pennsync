/**
 * Nurse performance conclusions previously combined provenance-free activity,
 * compliance, visit, training, and incident rows. Until those inputs can be
 * bound to one immutable tenant, fail before SDK construction or request work.
 */
Deno.serve(() => Response.json({
  error: 'Nurse performance analysis is unavailable pending immutable tenant provenance',
  code: 'NURSE_PERFORMANCE_ANALYSIS_PAUSED',
  available: false,
}, {
  status: 503,
  headers: { 'Cache-Control': 'no-store' },
}));
