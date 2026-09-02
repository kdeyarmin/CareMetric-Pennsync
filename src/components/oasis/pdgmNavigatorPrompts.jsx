// All AI PDGM grouping, reimbursement prediction, and discrepancy-resolution
// prompts are intentionally unavailable. Keeping unsafe legacy prompt text in
// the client bundle made it too easy for a future call site to bypass the
// canonical default-off gate.

const UNAVAILABLE_MESSAGE =
  "AI-derived PDGM grouping and reimbursement guidance are unavailable pending a verified CMS HHGS 432-group grouper, protected assessment provenance, and CMS golden-case tests";

function refusePdgmAiPrompt(..._args) {
  throw new Error(UNAVAILABLE_MESSAGE);
}

export const buildNavigationRequest = refusePdgmAiPrompt;
export const buildFinancialPredictionRequest = refusePdgmAiPrompt;
export const buildResolutionWorkflowRequest = refusePdgmAiPrompt;
