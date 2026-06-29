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

    const payload = await req.json();
    const { entity_type, entity_id } = payload;

    if (!entity_type || !entity_id) {
      return Response.json({ error: 'Missing entity_type or entity_id' }, { status: 400 });
    }

    let entity;
    let criticalFields = [];
    let score = 0;
    let missing = [];

    if (entity_type === 'Patient') {
      entity = await base44.asServiceRole.entities.Patient.get(entity_id);
      if (!entity) return Response.json({ error: 'Patient not found' }, { status: 404 });
      criticalFields = [
        'first_name', 'last_name', 'date_of_birth', 'phone', 'address',
        'emergency_contact_name', 'emergency_contact_phone', 
        'physician_name', 'primary_diagnosis'
      ];
      
      missing = criticalFields.filter(field => !entity[field] || entity[field] === '');
      score = ((criticalFields.length - missing.length) / criticalFields.length * 100).toFixed(0);

      // Update patient record with quality metrics
      await base44.asServiceRole.entities.Patient.update(entity_id, {
        data_completeness_score: parseInt(score),
        missing_critical_fields: missing
      });

    } else if (entity_type === 'User') {
      entity = await base44.asServiceRole.entities.User.get(entity_id);
      if (!entity) return Response.json({ error: 'User not found' }, { status: 404 });
      criticalFields = [
        'credential_type', 'phone', 'care_scope', 'license_number'
      ];
      
      missing = criticalFields.filter(field => !entity[field] || entity[field] === '');
      score = ((criticalFields.length - missing.length) / criticalFields.length * 100).toFixed(0);

      // Update user record with quality metrics
      await base44.asServiceRole.entities.User.update(entity_id, {
        profile_completeness_score: parseInt(score)
      });

    } else if (entity_type === 'Visit') {
      entity = await base44.asServiceRole.entities.Visit.get(entity_id);
      if (!entity) return Response.json({ error: 'Visit not found' }, { status: 404 });
      criticalFields = [
        'nurse_notes', 'homebound_justification', 'vital_signs', 'skilled_intervention_documented'
      ];
      
      missing = criticalFields.filter(field => {
        if (field === 'nurse_notes') return !entity.nurse_notes || entity.nurse_notes.length < 100;
        return !entity[field];
      });
      score = ((criticalFields.length - missing.length) / criticalFields.length * 100).toFixed(0);

      const complianceIssues = [];
      if (!entity.homebound_justification) complianceIssues.push('Missing homebound justification');
      if (!entity.skilled_intervention_documented) complianceIssues.push('Skilled intervention not documented');
      if (!entity.nurse_notes || entity.nurse_notes.length < 100) complianceIssues.push('Insufficient documentation');

      // Update visit record with compliance metrics
      await base44.asServiceRole.entities.Visit.update(entity_id, {
        compliance_score: parseInt(score),
        compliance_issues: complianceIssues
      });
    } else {
      // Unrecognized entity_type would otherwise fall through to a bogus
      // "success" with completeness_score 0; reject it explicitly.
      return Response.json({ error: `Unsupported entity_type: ${entity_type}` }, { status: 400 });
    }

    return Response.json({
      entity_type,
      entity_id,
      completeness_score: parseInt(score),
      missing_fields: missing,
      critical: missing.length >= 3,
      message: `Data quality metrics updated for ${entity_type}`
    });

  } catch (error) {
    console.error('Data completeness enforcement error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});