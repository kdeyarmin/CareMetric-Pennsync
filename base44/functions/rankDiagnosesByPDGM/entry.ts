import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// <<<BEGIN SHARED HELPER: pdgmReimbursementGate — generated, edit base44/_shared/backendHelpers.mjs>>>
const PDGM_REIMBURSEMENT_ENABLED = false;
const PDGM_REIMBURSEMENT_BLOCKER = 'The app does not yet use a verified CMS HHGS 432-group grouper with golden-case tests.';
const PDGM_REIMBURSEMENT_ACTION = 'Use the official EMR/CMS-approved grouper for billing and reimbursement decisions.';
function pdgmUnavailablePayload(extra = {}) {
  return {
    featureEnabled: PDGM_REIMBURSEMENT_ENABLED,
    calculationStatus: 'blocked',
    paymentAvailable: false,
    payment: null,
    totalPayment: null,
    caseMixWeight: null,
    reason: 'cms_verified_pdgm_grouper_unavailable',
    message: `PDGM reimbursement is unavailable — this is not a $0 result. ${PDGM_REIMBURSEMENT_BLOCKER}`,
    actionRequired: [PDGM_REIMBURSEMENT_ACTION],
    ...extra,
  };
}
// <<<END SHARED HELPER: pdgmReimbursementGate>>>

Deno.serve(() => Response.json(pdgmUnavailablePayload({
  // Return static gate metadata before auth, request parsing, service-role
  // access, or LLM work. No caller can ask PennSync to sequence diagnoses by
  // reimbursement while the verified grouper is unavailable.
  error: 'PDGM diagnosis ranking unavailable',
  diagnosisRankingAvailable: false,
  ranked_diagnoses: [],
  optimal_primary_diagnosis: null,
  recommended_secondary_diagnoses: [],
}), { status: 409 }));
