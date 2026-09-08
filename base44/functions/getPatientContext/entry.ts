const RETIRED_ENDPOINT = 'getPatientContext';

Deno.serve(() => Response.json(
  {
    error: 'Legacy patient context endpoint retired',
    code: 'legacy_patient_context_retired',
    reason: 'purpose_bound_immutable_tenant_read_brokers_required',
    endpoint: RETIRED_ENDPOINT,
  },
  {
    status: 410,
  },
));
