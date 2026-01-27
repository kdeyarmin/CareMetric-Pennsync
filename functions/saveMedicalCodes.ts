import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { patient_id, visit_id, codes, note_excerpt } = await req.json();

    if (!patient_id || !codes || codes.length === 0) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Save each code to MedicalCode entity
    const savedCodes = [];
    for (const code of codes) {
      try {
        const medicalCode = await base44.asServiceRole.entities.MedicalCode.create({
          patient_id,
          visit_id,
          code_type: code.type,
          code: code.code.code,
          description: code.code.description,
          category: code.code.category,
          specificity: code.code.specificity,
          billable: code.code.billable ?? true,
          rvu: code.code.rvu,
          modifiers: code.code.modifiers,
          selected_by: user.email,
          note_content_excerpt: note_excerpt?.substring(0, 200),
          status: 'pending_review'
        });

        savedCodes.push({
          id: medicalCode.id,
          code: code.code.code,
          status: 'saved'
        });

        // Log to audit trail
        await base44.asServiceRole.entities.AuditTrail.create({
          timestamp: new Date().toISOString(),
          user_email: user.email,
          action: 'code_selected',
          entity_type: 'MedicalCode',
          entity_id: medicalCode.id,
          details: {
            code: code.code.code,
            code_type: code.type,
            patient_id,
            visit_id
          }
        });
      } catch (error) {
        console.error(`Error saving code ${code.code.code}:`, error);
        savedCodes.push({
          code: code.code.code,
          status: 'error',
          error: error.message
        });
      }
    }

    return Response.json({
      success: true,
      saved_count: savedCodes.filter(c => c.status === 'saved').length,
      total_count: codes.length,
      codes: savedCodes,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in saveMedicalCodes:', error);
    return Response.json({
      error: error.message,
      success: false
    }, { status: 500 });
  }
});