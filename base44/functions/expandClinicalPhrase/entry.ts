import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: trustedCallerClaims — generated, edit base44/_shared/backendHelpers.mjs>>>
const PRIVILEGED_PROFILE_ACCOUNT_TYPES = new Set(['super_admin', 'agency_admin']);
const TRUSTED_CLAIM_AGENCY_STATUSES = new Set(['active', 'trial']);
const normalizeClaimEmail = (value) => String(value || '').trim().toLowerCase();
async function loadTrustedTenantClaim(base44, profileId, email) {
  if (!profileId || !email) return null;
  let membership = null;
  try {
    const rows = await base44.asServiceRole.entities.AgencyMembership.filter(
      { user_id: profileId, status: 'active' },
      undefined,
      2,
    );
    const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    if (row
      && String(row.user_id || '').trim() === profileId
      && String(row.status || '') === 'active'
      && normalizeClaimEmail(row.user_email_normalized) === email
      && typeof row.agency_id === 'string'
      && row.agency_id.trim()) {
      membership = row;
    }
  } catch {
    membership = null;
  }
  if (!membership) return null;
  try {
    const agencyId = membership.agency_id.trim();
    const rows = await base44.asServiceRole.entities.Agency.filter({ id: agencyId }, undefined, 2);
    const agency = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    const agencyName = String(agency?.agency_name || '').trim();
    if (!agency || agency.id !== agencyId || !TRUSTED_CLAIM_AGENCY_STATUSES.has(String(agency.status || ''))
      || !agencyName) {
      return null;
    }
    return { tenantRole: String(membership.tenant_role || ''), agencyId, agencyName };
  } catch {
    return null;
  }
}
async function withTrustedClaims(base44, profile) {
  if (!profile || typeof profile !== 'object') return profile;
  // Protected built-in admins (the platform owner included) already hold
  // platform-level RLS authority, so their legacy self-scoping claims cannot
  // widen access; leave them exactly as the handler saw them before.
  if (profile.role === 'admin') return profile;
  const email = normalizeClaimEmail(profile.email);
  const profileId = typeof profile.id === 'string' ? profile.id.trim() : '';
  const tenant = await loadTrustedTenantClaim(base44, profileId, email);
  const claimedType = String(profile.account_type || '');
  const baseType = PRIVILEGED_PROFILE_ACCOUNT_TYPES.has(claimedType) ? 'user' : claimedType;
  if (tenant) {
    return {
      ...profile,
      account_type: tenant.tenantRole === 'agency_admin' ? 'agency_admin' : baseType,
      agency_name: tenant.agencyName,
      agency_id: tenant.agencyId,
      is_approved: true,
    };
  }
  return { ...profile, account_type: baseType, agency_name: '', agency_id: '', is_approved: false };
}
// <<<END SHARED HELPER: trustedCallerClaims>>>

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// <<<BEGIN SHARED HELPER: requireAgencyAdminAgency — generated, edit base44/_shared/backendHelpers.mjs>>>
function agencyAdminMissingAgencyResponse(user) {
  if (user && user.account_type === 'agency_admin' && !String(user.agency_name || '').trim()) {
    return Response.json({ error: 'Forbidden: agency_name is required.' }, { status: 403 });
  }
  return null;
}
// <<<END SHARED HELPER: requireAgencyAdminAgency>>>

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
    const user = await withTrustedClaims(base44, await base44.auth.me());

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    {
      const _agencyAdminGate = agencyAdminMissingAgencyResponse(user);
      if (_agencyAdminGate) return _agencyAdminGate;
    }

    const { phrase, patientId, contextData } = await req.json();

    if (!phrase) {
      return Response.json({ error: 'Phrase is required' }, { status: 400 });
    }

    // Find matching template. Read as service role so a patient-bound phrase
    // authored by a teammate is reachable (RLS on ClinicalLibraryTemplate scopes
    // the CLIENT list to own/agency-wide). Because this bypasses RLS, any
    // patient-bound match MUST be re-authorized against patient access below.
    const templates = await base44.asServiceRole.entities.ClinicalLibraryTemplate.filter({
      phrase: phrase.toLowerCase().trim(),
      is_active: true
    }, undefined, 5000);

    // A phrase bound to THIS patient wins (e.g. that patient's specific wound-care
    // orders). Enforce patient access BEFORE honoring a patient-bound template: the
    // caller must be able to read the patient under their OWN RLS. Without this
    // gate, an authenticated user could supply another patient's id + a known
    // phrase and retrieve that patient's bound order text (the service-role read
    // and the early generic-branch return would otherwise skip any access check).
    const pid = patientId ? String(patientId) : '';
    let patientBound = pid
      ? templates.find(t => t.patient_id && String(t.patient_id) === pid)
      : undefined;
    if (patientBound) {
      const [accessiblePatient] = await base44.asServiceRole.entities.Patient
        .filter({ id: patientBound.patient_id }, '', 1).catch(() => []);
      const denied = await assertPatientAccess(base44, user, accessiblePatient);
      if (denied) patientBound = undefined;
    }

    // Agency-wide templates must be authored by someone in the caller's agency
    // (or the caller themselves). Without this, any is_agency_wide row from
    // another tenant matches first. Platform admin (super_admin or bare
    // role:admin without agency) may use any agency-wide row.
    let agencyEmailSet = null;
    const isPlatformWide = user.account_type === 'super_admin'
      || (user.role === 'admin' && !user.agency_name);
    if (!isPlatformWide && user.agency_name) {
      const agencyUsers = await base44.asServiceRole.entities.User
        .list('-created_date', 5000).catch(() => []);
      agencyEmailSet = new Set(
        (agencyUsers || [])
          .filter((u) => u.agency_name === user.agency_name && u.email)
          .map((u) => u.email),
      );
    }
    const agencyWideOk = (t) => {
      if (!t.is_agency_wide) return false;
      if (isPlatformWide) return true;
      if (!agencyEmailSet) return false;
      return t.created_by && agencyEmailSet.has(t.created_by);
    };

    let template =
      patientBound ||
      templates.find(t => !t.patient_id && (agencyWideOk(t) || t.created_by === user.email));

    if (!template) {
      // No exact match, use AI to generate expansion
      const prompt = `You are a home healthcare documentation assistant. Expand the following clinical phrase into a complete, Medicare-compliant narrative note.

Phrase: "${phrase}"
${patientId ? 'Note: This is for a specific patient, so personalize the documentation.' : ''}
${contextData ? `Context: ${JSON.stringify(contextData)}` : ''}

Generate a clear, professional clinical note that:
- Uses proper medical terminology
- Is Medicare-compliant
- Follows home health documentation standards
- Is specific and measurable
- Includes relevant patient education or interventions

Expanded documentation:`;

      const response = await base44.integrations.Core.InvokeLLM({
        model: "automatic",
        prompt,
        add_context_from_internet: false
      });

      return Response.json({
        expandedText: response,
        source: 'ai_generated',
        template: null
      });
    }

    // Template found
    if (template.template_type === 'generic') {
      // Increment usage count
      await base44.asServiceRole.entities.ClinicalLibraryTemplate.update(template.id, {
        usage_count: (template.usage_count || 0) + 1
      });

      return Response.json({
        expandedText: template.expanded_text,
        source: 'template',
        template: template
      });
    }

    // Patient-specific template
    if (!patientId) {
      return Response.json({ 
        error: 'Patient ID required for patient-specific template' 
      }, { status: 400 });
    }

    // Get patient data (explicit agency gate — Patient RLS is bare role:admin).
    const [patientData] = await base44.asServiceRole.entities.Patient
      .filter({ id: patientId }, '', 1).catch(() => []);
    const deniedPatient = await assertPatientAccess(base44, user, patientData);
    if (deniedPatient) return deniedPatient;

    // Build context for AI
    let patientContext = '';
    if (template.patient_data_fields && template.patient_data_fields.length > 0) {
      template.patient_data_fields.forEach(field => {
        if (patientData[field]) {
          patientContext += `${field}: ${JSON.stringify(patientData[field])}\n`;
        }
      });
    }

    // Generate personalized expansion using AI
    const prompt = `You are a home healthcare documentation assistant. Generate Medicare-compliant documentation based on this template and patient data.

Template Instructions: ${template.ai_prompt_instructions || template.expanded_text}

Patient Information:
${patientContext}

Additional Context: ${contextData ? JSON.stringify(contextData) : 'None'}

Generate a complete, personalized clinical note that:
- Uses the patient's specific information
- Is Medicare-compliant
- Follows home health documentation standards
- Is specific and measurable
- Includes dates, measurements, and observations

Expanded documentation:`;

    const expandedText = await base44.integrations.Core.InvokeLLM({
      model: "automatic",
      prompt,
      add_context_from_internet: false
    });

    // Increment usage count
    await base44.asServiceRole.entities.ClinicalLibraryTemplate.update(template.id, {
      usage_count: (template.usage_count || 0) + 1
    });

    return Response.json({
      expandedText,
      source: 'patient_specific_template',
      template: template,
      patientData: {
        name: `${patientData.first_name} ${patientData.last_name}`,
        id: patientData.id
      }
    });

  } catch (error) {
    console.error('Error expanding phrase:', error);
    return Response.json({ 
      error: 'Failed to expand clinical phrase' 
    }, { status: 500 });
  }
});