import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: isAdminLike — generated, edit base44/_shared/backendHelpers.mjs>>>
const SUPER_ADMIN_EMAIL = ((typeof Deno !== 'undefined' && Deno.env.get('SUPER_ADMIN_EMAIL')) || '').trim().toLowerCase();
const sameEmail = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const isAdminLike = (u) => !!u && (
  u.role === 'admin' || u.account_type === 'agency_admin' ||
  u.account_type === 'super_admin' || (SUPER_ADMIN_EMAIL !== '' && sameEmail(u.email, SUPER_ADMIN_EMAIL))
);
// <<<END SHARED HELPER: isAdminLike>>>

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!isAdminLike(user)) {
      return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
    }

    const results = {
      patients_updated: 0,
      visits_updated: 0,
      errors: []
    };

    // Migrate patients - add quality scores and defaults
    const patients = await base44.asServiceRole.entities.Patient.filter({ status: 'active' }, '-created_date', 5000);
    
    for (const patient of patients) {
      const criticalFields = ['emergency_contact_name', 'emergency_contact_phone', 'physician_name', 'phone', 'date_of_birth', 'address'];
      const missing = criticalFields.filter(f => !patient[f] || patient[f] === '');
      const score = ((criticalFields.length - missing.length) / criticalFields.length * 100).toFixed(0);

      const updates = {
        data_completeness_score: parseInt(score),
        missing_critical_fields: missing,
        secondary_diagnoses: patient.secondary_diagnoses || [],
        current_medications: patient.current_medications || [],
        past_medical_history: patient.past_medical_history || [],
        past_hospitalizations: patient.past_hospitalizations || [],
        goals_of_care: patient.goals_of_care || [],
        wounds: patient.wounds || [],
        enhanced_notes_history: patient.enhanced_notes_history || [],
        assigned_nurses: patient.assigned_nurses || []
      };

      try {
        await base44.asServiceRole.entities.Patient.update(patient.id, updates);
        results.patients_updated++;
      } catch (error) {
        results.errors.push({
          entity: 'Patient',
          id: patient.id,
          error: error.message
        });
      }
    }

    // Migrate visits - extract homebound justifications from notes
    const visits = await base44.asServiceRole.entities.Visit.filter({ status: 'completed' }, '-created_date', 5000);
    
    for (const visit of visits) {
      const updates = {
        ai_tags: visit.ai_tags || []
      };

      // Try to extract homebound justification from notes
      if (visit.nurse_notes && !visit.homebound_justification) {
        const homeboundMatch = visit.nurse_notes.match(/(homebound|cannot leave home|mobility limitation|requires assistance|confined to home)[^.]*\./gi);
        if (homeboundMatch && homeboundMatch.length > 0) {
          updates.homebound_justification = homeboundMatch[0];
          updates.homebound_status_verified = true;
        }
      }

      // Calculate compliance score
      const issues = [];
      if (!visit.homebound_justification && !updates.homebound_justification) {
        issues.push('Missing homebound justification');
      }
      if (!visit.nurse_notes || visit.nurse_notes.length < 100) {
        issues.push('Insufficient documentation');
      }
      
      const score = ((2 - issues.length) / 2 * 100).toFixed(0);
      updates.compliance_score = parseInt(score);
      updates.compliance_issues = issues;

      try {
        await base44.asServiceRole.entities.Visit.update(visit.id, updates);
        results.visits_updated++;
      } catch (error) {
        results.errors.push({
          entity: 'Visit',
          id: visit.id,
          error: error.message
        });
      }
    }

    return Response.json({
      success: true,
      summary: {
        patients_updated: results.patients_updated,
        visits_updated: results.visits_updated,
        total_errors: results.errors.length
      },
      errors: results.errors.slice(0, 20),
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Data migration error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});