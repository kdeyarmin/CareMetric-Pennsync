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
    const user = await base44.auth.me().catch(() => null);
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    // Same admin gate as generateSignerToken/archiveSignedDocument —
    // role==='admin' alone rejected agency_admin/super_admin.
    if (!isAdminLike(user)) {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { patient_ids, template_ids, due_date } = await req.json();

    if (!patient_ids || !Array.isArray(patient_ids) || patient_ids.length === 0) {
      return Response.json({ error: 'At least one patient required' }, { status: 400 });
    }

    if (!template_ids || !Array.isArray(template_ids) || template_ids.length === 0) {
      return Response.json({ error: 'At least one template required' }, { status: 400 });
    }

    if (!due_date) {
      return Response.json({ error: 'Due date required' }, { status: 400 });
    }

    // Fetch all patients and templates up front in one batched read each,
    // instead of re-fetching the template inside the patient loop (P×T gets) and
    // fetching each patient serially.
    const [patients, templates] = await Promise.all([
      // Explicit limits: an unlimited filter() returns only the server's default
      // page (~50), so a bulk send to more than ~50 selected patients silently
      // built packages for the first page and reported success for the rest.
      base44.asServiceRole.entities.Patient.filter({ id: { $in: patient_ids } }, undefined, 5000),
      base44.asServiceRole.entities.DocumentTemplate.filter({ id: { $in: template_ids } }, undefined, 5000),
    ]);

    // Agency-scoped admins must not package arbitrary cross-agency patients via service role.
    if (user.account_type === 'agency_admin' && !user.agency_name) {
      return Response.json({ error: 'Forbidden: agency_name is required.' }, { status: 403 });
    }
    let agencyEmails = null;
    const isAgencyScopedAdmin = user.account_type !== 'super_admin'
      && user.agency_name
      && (user.account_type === 'agency_admin' || user.role === 'admin');
    if (isAgencyScopedAdmin) {
      const agencyUsers = await base44.asServiceRole.entities.User.list('-created_date', 5000).catch(() => []);
      agencyEmails = new Set(
        (agencyUsers || [])
          .filter((u) => u.agency_name === user.agency_name && u.email)
          .map((u) => u.email),
      );
    }
    const patientInAgency = (p) => {
      if (!agencyEmails) return true;
      if (p.created_by && agencyEmails.has(p.created_by)) return true;
      return Array.isArray(p.assigned_nurses) && p.assigned_nurses.some((e) => agencyEmails.has(e));
    };

    const patientMap = new Map(patients.filter(patientInAgency).map((p) => [p.id, p]));
    const templateMap = new Map(templates.map((t) => [t.id, t]));

    const createdPackages = [];
    const failures = [];
    for (const patientId of patient_ids) {
      if (!patientMap.has(patientId) && patients.some((p) => p.id === patientId)) {
        failures.push({ patient_id: patientId, error: 'Patient outside your agency' });
      }
    }
    // Create a package for each patient-template combination
    for (const patientId of patient_ids) {
      const patient = patientMap.get(patientId);
      if (!patient) continue;

      for (const templateId of template_ids) {
        const template = templateMap.get(templateId);
        if (!template) continue;

        // Isolate each combination so one bad row (e.g. a schema-invalid field)
        // doesn't abort the whole batch and orphan the packages already created.
        try {
          // Create document signature from template
          const signerName = patient.caregiver_name || `${patient.first_name} ${patient.last_name}`;
          const signerEmail = patient.caregiver_email || patient.email;
          const signature = await base44.asServiceRole.entities.DocumentSignature.create({
            patient_id: patientId,
            document_name: template.name,
            document_title: template.name,
            document_content: template.content || '',
            // template.category has many values outside DocumentSignature.document_type's
            // enum (skilled_nursing, oasis, discharge, …), which would reject the create;
            // pass it through only when valid, otherwise fall back to 'other'.
            document_type: ['consent', 'hipaa', 'treatment_agreement', 'financial_agreement', 'advance_directive', 'release', 'custom_request', 'other'].includes(template.category) ? template.category : 'other',
            status: 'pending',
            signers: [
              {
                // A stable id per signer row: the in-person signing page and
                // submitDocumentSignatures key signatures by signer.id —
                // id-less rows all collide on `undefined` for multi-signer
                // documents, attaching a signature to the wrong signer row.
                id: `signer_${crypto.randomUUID()}`,
                name: signerName,
                email: signerEmail || '',
                role: 'patient',
                required: true,
                status: 'pending',
              },
            ],
            signer_name: signerName,
            signer_email: signerEmail,
          });

          // Create document package
          const pkg = await base44.asServiceRole.entities.DocumentPackage.create({
            package_name: `${template.name} - ${patient.first_name} ${patient.last_name}`,
            patient_id: patientId,
            document_signatures: [signature.id],
            status: 'pending',
            due_date,
            signer_name: patient.caregiver_name || `${patient.first_name} ${patient.last_name}`,
            signer_email: patient.caregiver_email || patient.email,
            auto_reminder_enabled: true,
            sent_to_patient_at: new Date().toISOString(),
          });

          createdPackages.push(pkg);
        } catch (itemErr) {
          console.error('Failed to create document package:', itemErr.message);
          failures.push({ patient_id: patientId, template_id: templateId, error: itemErr.message });
        }
      }
    }

    return Response.json({
      success: true,
      packages_created: createdPackages.length,
      packages: createdPackages,
      failures,
    });
  } catch (error) {
    console.error('Error in bulkCreateDocumentPackages:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});