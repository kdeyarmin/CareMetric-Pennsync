import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: isAdminLike — generated, edit base44/_shared/backendHelpers.mjs>>>
const isAdminLike = (u) => !!u && (
  u.role === 'admin' || u.account_type === 'agency_admin' ||
  u.account_type === 'super_admin'
);
// <<<END SHARED HELPER: isAdminLike>>>

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    if (!isAdminLike(user)) {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }
    if (user.account_type === 'agency_admin' && !user.agency_name) {
      return Response.json({ error: 'Forbidden: agency_name is required.' }, { status: 403 });
    }

    const { template_id, patient_id, custom_values } = await req.json();

    if (!template_id || !patient_id) {
      return Response.json({ error: 'Missing template_id or patient_id' }, { status: 400 });
    }

    // Fetch template
    const template = await base44.asServiceRole.entities.DocumentTemplate.get(template_id);
    if (!template) {
      return Response.json({ error: 'Template not found' }, { status: 404 });
    }

    // Fetch patient and enforce agency access. Service-role get bypasses RLS, so
    // without this check any admin could mint signature packages for another
    // tenant's charts.
    const patient = await base44.asServiceRole.entities.Patient.get(patient_id);
    if (!patient) {
      return Response.json({ error: 'Patient not found' }, { status: 404 });
    }
    // Agency-scoped facility admins (agency_admin OR role:admin + agency_name)
    // — not only "has agency_name". Platform admin = super_admin or bare role:admin.
    const isSuperAdmin = user.account_type === 'super_admin';
    const isAgencyScopedAdmin = user.account_type === 'agency_admin'
      || (user.role === 'admin' && !!user.agency_name && !isSuperAdmin);
    if (isAgencyScopedAdmin) {
      const agencyUsers = await base44.asServiceRole.entities.User
        .filter({ agency_name: user.agency_name }, '-created_date', 5000)
        .catch(() => []);
      const agencyEmails = new Set(
        (Array.isArray(agencyUsers) ? agencyUsers : [])
          .map((u) => u?.email)
          .filter(Boolean)
      );
      const inAgency = (patient.created_by && agencyEmails.has(patient.created_by))
        || (Array.isArray(patient.assigned_nurses)
          && patient.assigned_nurses.some((e) => agencyEmails.has(e)));
      if (!inAgency) {
        return Response.json({ error: 'Forbidden: patient is outside your agency' }, { status: 403 });
      }
    }

    // Build substitution map
    const substitutions = {
      patient_name: `${patient.first_name} ${patient.last_name}`,
      patient_first_name: patient.first_name,
      patient_last_name: patient.last_name,
      patient_date_of_birth: patient.date_of_birth,
      patient_medical_record_number: patient.medical_record_number,
      patient_address: patient.address,
      patient_phone: patient.phone,
      patient_email: patient.email,
      date: new Date().toISOString().split('T')[0],
      today: new Date().toLocaleDateString(),
      ...custom_values,
    };

    // Populate template content
    let populatedContent = template.content || '';
    (template.placeholders || []).forEach((placeholder) => {
      const value = substitutions[placeholder.key] || '';
      populatedContent = populatedContent.replace(
        new RegExp(`{{${placeholder.key}}}`, 'g'),
        value
      );
    });

    // Generate PDF (using UploadFile to store as document)
    const docName = `${template.name}_${patient.first_name}_${patient.last_name}_${Date.now()}`;
    
    // Create DocumentSignature
    const signature = await base44.asServiceRole.entities.DocumentSignature.create({
      patient_id: patient_id,
      document_name: `${template.name}`,
      document_title: `${template.name}`,
      document_content: populatedContent,
      document_type: template.category,
      status: 'pending',
      signers: [
        {
          name: `${patient.first_name} ${patient.last_name}`,
          email: patient.email || '',
          role: 'patient',
          required: true,
          status: 'pending',
        },
      ],
      // signer_email / signer_name / requires_signature are legacy flats not in the
      // DocumentSignature schema (silently dropped) — the signer identity is already
      // captured in the signers[] array above.
    });

    // Create DocumentVersion with populated content
    const version = await base44.asServiceRole.entities.DocumentVersion.create({
      document_signature_id: signature.id,
      package_id: '', // Will be set when added to package
      version_number: 1,
      document_name: template.name,
      document_type: template.category,
      pdf_url: '', // Would be populated with actual PDF URL in production
      uploaded_by: user.email,
      uploaded_at: new Date().toISOString(),
      is_current: true,
      template_content: populatedContent, // Store populated content
    });

    return Response.json({
      success: true,
      signature_id: signature.id,
      version_id: version.id,
      populated_content: populatedContent,
      document_name: docName,
    });
  } catch (error) {
    console.error('generateDocumentPackageFromTemplate failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});