import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


// <<<BEGIN SHARED HELPER: isAdminLike — generated, edit base44/_shared/backendHelpers.mjs>>>
const isAdminLike = (u) => !!u && (
  u.role === 'admin' || u.account_type === 'agency_admin' ||
  u.account_type === 'super_admin'
);
// <<<END SHARED HELPER: isAdminLike>>>

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    if (!isAdminLike(user)) {
      return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
    }

    // Recalculate quality scores. Scope to the caller's agency so an
    // agency_admin cannot rewrite completeness fields on every tenant.
    let [patients, users, visits] = await Promise.all([
      base44.asServiceRole.entities.Patient.filter({ status: 'active' }, '-created_date', 5000),
      base44.asServiceRole.entities.User.list('-created_date', 5000),
      base44.asServiceRole.entities.Visit.filter({ status: 'completed' }, '-visit_date', 5000),
    ]);

    if (user.account_type === 'agency_admin' && !user.agency_name) {
      return Response.json({ error: 'Forbidden: agency_name is required.' }, { status: 403 });
    }
    if (user.account_type !== 'super_admin' && user.agency_name) {
      users = (Array.isArray(users) ? users : []).filter((u) =>
        u.account_type === 'super_admin' || u.agency_name === user.agency_name
      );
      const agencyEmails = new Set(users.map((u) => u?.email).filter(Boolean));
      patients = (Array.isArray(patients) ? patients : []).filter((p) =>
        (p.created_by && agencyEmails.has(p.created_by))
        || (Array.isArray(p.assigned_nurses) && p.assigned_nurses.some((e) => agencyEmails.has(e)))
      );
      const patientIds = new Set(patients.map((p) => p.id));
      visits = (Array.isArray(visits) ? visits : []).filter((v) => patientIds.has(v.patient_id));
    }

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
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});