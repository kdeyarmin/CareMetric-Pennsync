/**
 * Document AI analysis is paused until its write side has a purpose-bound,
 * binding-aware mutation broker. The private read broker can issue a short
 * download capability, but writing analysis directly to Document would reopen
 * the entity boundary and has no conditional/reconciliation contract.
 */
Deno.serve(() => Response.json({
  error: 'Document analysis is temporarily unavailable',
  code: 'document_analysis_private_write_broker_required',
}, {
  status: 503,
  headers: { 'Cache-Control': 'no-store' },
}));
