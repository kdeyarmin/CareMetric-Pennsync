import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get('file');

    if (!file) {
      return Response.json({ error: 'No file provided' }, { status: 400 });
    }

    // Upload file to extract data
    const uploadResponse = await base44.integrations.Core.UploadFile({ file });
    const fileUrl = uploadResponse.file_url;

    // Define patient schema for extraction
    const patientSchema = {
      type: "object",
      properties: {
        first_name: { type: "string" },
        last_name: { type: "string" },
        date_of_birth: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        address: { type: "string" },
        medical_record_number: { type: "string" },
        primary_diagnosis: { type: "string" },
        payor: { type: "string" }
      }
    };

    // Extract data from file
    const extractResponse = await base44.integrations.Core.ExtractDataFromUploadedFile({
      file_url: fileUrl,
      json_schema: patientSchema
    });

    if (extractResponse.status !== 'success') {
      return Response.json({
        success: false,
        error: extractResponse.details || 'Failed to extract data from file'
      }, { status: 400 });
    }

    const patients = Array.isArray(extractResponse.output) 
      ? extractResponse.output 
      : [extractResponse.output];

    // Validate and create patients
    const created = [];
    const errors = [];

    for (let i = 0; i < patients.length; i++) {
      try {
        const patient = patients[i];

        // Basic validation
        if (!patient.first_name || !patient.last_name) {
          errors.push({
            row: i + 1,
            error: 'First and last names are required'
          });
          continue;
        }

        // Create patient
        const newPatient = await base44.entities.Patient.create({
          first_name: patient.first_name?.trim(),
          last_name: patient.last_name?.trim(),
          date_of_birth: patient.date_of_birth || null,
          email: patient.email || null,
          phone: patient.phone || null,
          address: patient.address || null,
          medical_record_number: patient.medical_record_number || null,
          primary_diagnosis: patient.primary_diagnosis || null,
          payor: patient.payor || null
        });

        created.push({
          id: newPatient.id,
          name: `${patient.first_name} ${patient.last_name}`
        });
      } catch (error) {
        errors.push({
          row: i + 1,
          error: error.message || 'Failed to create patient'
        });
      }
    }

    return Response.json({
      success: true,
      created: created.length,
      failed: errors.length,
      patients: created,
      errors: errors
    });
  } catch (error) {
    console.error('Batch import error:', error);
    return Response.json({
      success: false,
      error: error.message || 'Failed to process import'
    }, { status: 500 });
  }
});