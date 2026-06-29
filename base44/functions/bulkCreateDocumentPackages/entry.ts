import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
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
      base44.asServiceRole.entities.Patient.filter({ id: { $in: patient_ids } }),
      base44.asServiceRole.entities.DocumentTemplate.filter({ id: { $in: template_ids } }),
    ]);
    const patientMap = new Map(patients.map((p) => [p.id, p]));
    const templateMap = new Map(templates.map((t) => [t.id, t]));

    const createdPackages = [];
    const failures = [];

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
            document_type: template.category,
            status: 'pending',
            signers: [
              {
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
          console.error(`Failed to create package for patient ${patientId} / template ${templateId}:`, itemErr.message);
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
    return Response.json({ error: error.message }, { status: 500 });
  }
});