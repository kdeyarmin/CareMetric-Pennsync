Deno.serve(() => {
  // A browser mount is not a trustworthy authentication event and can be
  // replayed indefinitely. Keep login telemetry unavailable until Base44 can
  // supply a provider-authenticated, idempotent session event.
  return Response.json({
    error: 'Login telemetry is unavailable pending provider-auth event integration',
  }, {
    status: 503,
    headers: { 'Cache-Control': 'no-store' },
  });
});
