// Retired endpoint: some hosted service-to-service calls retain its published
// revision. The tenant dispatcher now targets computeOutcomeMeasuresV2.
// Keep this name closed and remove its legacy unscoped automation on deploy.
Deno.serve(() => Response.json(
  { error: 'This outcome worker is retired' },
  { status: 503 },
));
