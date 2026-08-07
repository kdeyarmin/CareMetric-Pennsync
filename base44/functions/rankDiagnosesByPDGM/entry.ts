import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


// Financial visibility gate. MIRRORS src/lib/permissions.canViewFinancials
// (isAdminLike) — backend Deno modules can't import src/lib, so the admin
// checks are duplicated here. Keep in sync (see listOASISUploads).
function canViewFinancials(user) {
  if (!user) return false;
  return (
    user.role === 'admin' ||
    user.account_type === 'agency_admin' ||
    user.account_type === 'super_admin'
  );
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // This endpoint returns reimbursement tiers / estimated payment ranges — the
    // exact financial data the FinancialGate hides from non-financial users
    // everywhere else. Enforce it server-side so a nurse can't call it directly.
    if (!canViewFinancials(user)) {
      return Response.json({ error: 'Forbidden: financial access required' }, { status: 403 });
    }

    const { diagnoses, patient_data } = await req.json();

    if (!diagnoses || diagnoses.length === 0) {
      return Response.json({ error: 'No diagnoses provided' }, { status: 400 });
    }

    // Use AI to rank diagnoses by PDGM reimbursement potential
    const result = await base44.integrations.Core.InvokeLLM({
      model: "automatic",
      prompt: `You are a Medicare PDGM reimbursement expert. Analyze and rank these diagnoses by their PDGM reimbursement potential.

DIAGNOSES TO RANK:
${diagnoses.map((d, i) => `${i + 1}. ${d}`).join('\n')}

PATIENT CONTEXT:
${JSON.stringify(patient_data || {}, null, 2)}

For each diagnosis, provide:
1. PDGM Clinical Group assignment
2. Estimated reimbursement tier (High, Medium, Low)
3. Key factors affecting reimbursement
4. Comorbidity adjustments that could apply
5. Documentation requirements for optimal reimbursement

Rank all diagnoses from highest to lowest reimbursement potential.`,
      response_json_schema: {
        type: "object",
        properties: {
          ranked_diagnoses: {
            type: "array",
            items: {
              type: "object",
              properties: {
                diagnosis: { type: "string" },
                rank: { type: "number" },
                pdgm_clinical_group: { type: "string" },
                reimbursement_tier: { type: "string" },
                estimated_payment_range: { type: "string" },
                key_factors: {
                  type: "array",
                  items: { type: "string" }
                },
                comorbidity_adjustments: {
                  type: "array",
                  items: { type: "string" }
                },
                documentation_requirements: {
                  type: "array",
                  items: { type: "string" }
                },
                rationale: { type: "string" }
              }
            }
          },
          optimal_primary_diagnosis: { type: "string" },
          recommended_secondary_diagnoses: {
            type: "array",
            items: { type: "string" }
          },
          pdgm_optimization_tips: {
            type: "array",
            items: { type: "string" }
          }
        }
      }
    });

    return Response.json({
      success: true,
      ...result
    });

  } catch (error) {
    console.error('Error ranking diagnoses:', error);
    return Response.json({
      error: 'Failed to rank diagnoses'
    }, { status: 500 });
  }
});