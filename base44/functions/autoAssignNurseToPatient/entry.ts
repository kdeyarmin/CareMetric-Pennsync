// Deliberately fail-closed. Creating a Visit is clinical documentation, not an
// authorization event: even a valid same-agency creator must not grant themself
// Patient PHI access by naming a patient_id. Care-team assignment needs its own
// explicitly authorized, audited server workflow before this trigger can ever
// be re-enabled.
Deno.serve(async (_req) => Response.json({
  success: true,
  skipped: 'automatic patient assignment disabled',
}));
