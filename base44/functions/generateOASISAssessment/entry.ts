import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>



/** Explicit patient access — Patient RLS treats role:admin as platform-wide. */
async function assertPatientAccess(base44, user, patient) {
  if (!patient) return Response.json({ error: 'Patient not found' }, { status: 404 });
  const isSuperAdmin = user.account_type === 'super_admin';
  const isAgencyScopedAdmin =
    user.account_type === 'agency_admin'
    || (user.role === 'admin' && !!user.agency_name && !isSuperAdmin);
  const isPlatformAdmin = isSuperAdmin || (user.role === 'admin' && !user.agency_name);
  const isAssigned = Array.isArray(patient.assigned_nurses)
    && patient.assigned_nurses.includes(user.email);
  if (!isPlatformAdmin && !isAgencyScopedAdmin && patient.created_by !== user.email && !isAssigned) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (isAgencyScopedAdmin) {
    if (!user.agency_name) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    const agencyUsers = await base44.asServiceRole.entities.User
      .list('-created_date', 5000).catch(() => []);
    const agencyEmails = new Set(
      (agencyUsers || [])
        .filter((u) => u.agency_name === user.agency_name && u.email)
        .map((u) => u.email),
    );
    const inAgency = (patient.created_by && agencyEmails.has(patient.created_by))
      || (Array.isArray(patient.assigned_nurses)
        && patient.assigned_nurses.some((e) => agencyEmails.has(e)));
    if (!inAgency) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
  }
  return null;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    const { patient_id, visit_type, referral_data } = await req.json();

    if (!patient_id && !referral_data) {
      return Response.json({ error: 'Either patient_id or referral_data required' }, { status: 400 });
    }

    // Fetch patient data if patient_id provided
    let patientData = null;

    if (patient_id) {
      const [claimed] = await base44.asServiceRole.entities.Patient
        .filter({ id: patient_id }, '', 1).catch(() => []);
      const denied = await assertPatientAccess(base44, user, claimed);
      if (denied) return denied;
      patientData = claimed;
    } else if (referral_data) {
      // referral_data-only path still feeds PHI into the LLM — require admin
      // so a nurse cannot submit arbitrary referral payloads for another tenant.
      const isAdminLike = user.role === 'admin'
        || user.account_type === 'agency_admin'
        || user.account_type === 'super_admin';
      if (!isAdminLike) {
        return Response.json({ error: 'Forbidden: patient_id is required' }, { status: 403 });
      }
    }

    const contextData = referral_data || patientData;

    // Generate OASIS assessment using AI
    const result = await base44.integrations.Core.InvokeLLM({
      model: "automatic",
      prompt: `Generate a comprehensive OASIS assessment guide for this home health patient.

VISIT TYPE: ${visit_type || 'Start of Care'}

PATIENT DATA:
${JSON.stringify(contextData, null, 2)}

CRITICAL INSTRUCTIONS:
- Provide clear, complete responses without abbreviations or truncated text
- Write full words and sentences - do NOT use shortened text like "- & A s s e s s"
- Always write complete OASIS item names
- Use proper spacing between words
- Do NOT include administrative items M1000-M1060 (Medicare Number, Medicaid Number, Physician Name, Physician Phone)
- These administrative items are auto-generated in the EHR system

Generate:

1. KEY OASIS ITEMS: Identify the most relevant OASIS items based on diagnoses and clinical presentation (15-20 items)
   - Exclude M1000-M1060 administrative section
   - Focus on clinical assessment items only

2. PREPARATION FOR EACH ITEM — evidence and questions, NEVER an answer:
   - Item number and full description (not truncated)
   - The verbatim sentence(s) from the referral/record that relate to this item
   - Confidence that the record contains enough to answer it (High/Medium/Low)
   - What the record does and does not establish
   - Specific questions to ask the patient/caregiver in order to answer it
   - Documentation tips with complete sentences

3. ASSESSMENT PRIORITIES: What to assess first based on clinical urgency

4. MISSING DATA: What critical information is needed but not available

HARD RULES — these override anything else in this prompt:
- NEVER provide, suggest, recommend or imply an OASIS response, score or code.
  The clinician selects every official response themselves. If you are tempted
  to state a code, state the evidence and ask the question instead.
- NEVER consider or mention payment, reimbursement, revenue, PDGM or case-mix
  impact, and never suggest what would "maximize" any of them.

Focus on functional status, cognitive status, medications, wounds, and clinical factors affecting care.
Write everything clearly and completely - no truncated text.`,
      response_json_schema: {
        type: "object",
        properties: {
          oasis_items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                item_number: { type: "string" },
                item_name: { type: "string" },
                category: { type: "string" },
                // No `suggested_response`: the model does not choose an OASIS
                // response. `evidence` is the verbatim quote it is grounded in.
                evidence: { type: "string" },
                confidence_level: { type: "string" },
                rationale: { type: "string" },
                questions_to_ask: {
                  type: "array",
                  items: { type: "string" }
                },
                documentation_tips: {
                  type: "array",
                  items: { type: "string" }
                }
              }
            }
          },
          assessment_priorities: {
            type: "array",
            items: {
              type: "object",
              properties: {
                priority: { type: "string" },
                area: { type: "string" },
                rationale: { type: "string" }
              }
            }
          },
          missing_critical_data: {
            type: "array",
            items: { type: "string" }
          },
          // `pdgm_optimization_notes` and `estimated_pdgm_group` are removed:
          // both asked the model to reason about payment from clinical items.
          clinical_summary: { type: "string" }
        }
      }
    });

    return Response.json({
      success: true,
      visit_type: visit_type || 'Start of Care',
      ...result
    });

  } catch (error) {
    console.error('Error generating OASIS assessment:', error);
    // Do not leak internal error details (error.toString()/stack) to the
    // caller — could expose PHI or implementation details.
    return Response.json({
      error: 'Internal server error'
    }, { status: 500 });
  }
});