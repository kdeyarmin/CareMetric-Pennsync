/**
 * User activity and phone history cannot be released until every underlying
 * record has immutable tenant provenance and a purpose-bound broker can prove
 * the caller is authorized for that tenant. Fail before client construction,
 * authentication, request parsing, or any service-role read.
 */
Deno.serve(() => Response.json({
  error: 'User activity history is unavailable pending immutable tenant provenance',
  code: 'USER_ACTIVITY_LOG_PAUSED',
  available: false,
}, {
  status: 503,
  headers: { 'Cache-Control': 'no-store' },
}));
