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

    // Recalculate quality scores for all entities
    const [patients, users, visits] = await Promise.all([
      base44.asServiceRole.entities.Patient.filter({ status: 'active' }),
      base44.asServiceRole.entities.User.list('-created_date', 500),
      base44.asServiceRole.entities.Visit.filter({ status: 'completed' }, '-visit_date', 200),
    ]);

    let updated = 0;

    // Update patient completeness scores
    for (const patient of patients) {
      const criticalFields = ['emergency_contact_name', 'emergency_contact_phone', 'physician_name', 'phone', 'date_of_birth', 'address'];
      const missing = criticalFields.filter(f => !patient[f] || patient[f] === '');
      const score = ((criticalFields.length - missing.length) / criticalFields.length * 100).toFixed(0);

      await base44.asServiceRole.entities.Patient.update(patient.id, {
        data_completeness_score: parseInt(score),
        missing_critical_fields: missing
      });
      updated++;
    }

    // Update user profile scores
    for (const userRecord of users) {
      const criticalFields = ['phone', 'care_scope', 'credential_type'];
      const missing = criticalFields.filter(f => !userRecord[f] || userRecord[f] === '');
      const score = ((criticalFields.length - missing.length) / criticalFields.length * 100).toFixed(0);

      await base44.asServiceRole.entities.User.update(userRecord.id, {
        profile_completeness_score: parseInt(score)
      });
      updated++;
    }

    // Update visit compliance scores
    for (const visit of visits) {
      const issues = [];
      if (!visit.homebound_justification) issues.push('Missing homebound justification');
      if (!visit.skilled_intervention_documented) issues.push('Skilled intervention not documented');
      if (!visit.nurse_notes || visit.nurse_notes.length < 100) issues.push('Insufficient documentation');
      
      const score = ((3 - issues.length) / 3 * 100).toFixed(0);

      await base44.asServiceRole.entities.Visit.update(visit.id, {
        compliance_score: parseInt(score),
        compliance_issues: issues
      });
      updated++;
    }

    return Response.json({
      success: true,
      records_updated: updated,
      patients_processed: patients.length,
      users_processed: users.length,
      visits_processed: visits.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Quality score calculation error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});