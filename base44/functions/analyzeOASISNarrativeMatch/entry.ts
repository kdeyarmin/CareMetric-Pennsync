import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

Deno.serve(() => Response.json({
  // This endpoint is entirely paused: respond with static status before auth,
  // request parsing, clinical-data access, or an LLM invocation.
  error: 'OASIS narrative scoring analysis unavailable',
  analysisAvailable: false,
  responseSuggestion: null,
  paymentAvailable: false,
  payment: null,
  message: 'Narrative evidence may not be converted into an OASIS response, score, or payment recommendation by this endpoint.',
  actionRequired: ['A clinician must select responses in the official OASIS workflow based on observed evidence.'],
}, { status: 409 }));
