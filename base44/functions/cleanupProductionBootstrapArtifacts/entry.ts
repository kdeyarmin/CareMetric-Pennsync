/** One-time migration cleanup is complete. This endpoint is permanently retired. */
Deno.serve(() => Response.json({ error: 'Gone' }, {
  status: 410,
  headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
}));
