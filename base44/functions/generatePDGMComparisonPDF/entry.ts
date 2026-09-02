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
  // Never parse caller-supplied revenueData or produce an authoritative-looking
  // PDF from it. Reject before auth, service access, or PDF initialization.
  error: 'PDGM comparison export unavailable',
  exportAvailable: false,
}), { status: 409 }));
