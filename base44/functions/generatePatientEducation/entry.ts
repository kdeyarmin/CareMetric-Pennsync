/**
 * Security quarantine: the historical generator wrote PHI-derived output to a
 * PatientEducationDelivery sink that is not tenant-owned. Keep the hosted route
 * fail closed until that sink has an agency key, brokered authorization, and an
 * idempotent all-or-nothing write contract.
 *
 * This pause deliberately happens without constructing a Base44 client,
 * reading a chart, invoking a model, logging request data, or touching a sink.
 */

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

Deno.serve((req) => {
  if (req.method !== 'POST') {
    return Response.json(
      { success: false, error: 'Method not allowed' },
      { status: 405, headers: { ...NO_STORE_HEADERS, Allow: 'POST' } },
    );
  }
  return Response.json(
    {
      success: false,
      paused: true,
      code: 'PATIENT_EDUCATION_GENERATION_PAUSED',
      error: 'Patient education generation is temporarily unavailable pending tenant-safe storage',
    },
    { status: 503, headers: NO_STORE_HEADERS },
  );
});
