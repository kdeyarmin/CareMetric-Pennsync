import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { file_url } = await req.json();

    if (!file_url) {
      return Response.json({ error: 'Missing file_url' }, { status: 400 });
    }

    // Use InvokeLLM with vision to extract patient metadata from the document
    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      model: "claude_opus_4_8",
      prompt: `You are a medical document OCR assistant. Analyze this medical document image/PDF and extract patient identifying information.

Extract the following fields if present:
- patient_name: Full name of the patient (first and last)
- date_of_birth: Date of birth in MM/DD/YYYY format
- mrn: Medical Record Number or Patient ID
- physician_name: Name of the ordering/referring physician
- date_of_service: Date of service or document date (MM/DD/YYYY)
- diagnosis: Primary diagnosis or reason for referral
- phone: Patient phone number
- address: Patient address

Return ONLY what you can clearly read. For any field you cannot find or read clearly, return null.
Do not guess or infer values not explicitly visible in the document.`,
      file_urls: [file_url],
      response_json_schema: {
        type: "object",
        properties: {
          patient_name: { type: ["string", "null"] },
          date_of_birth: { type: ["string", "null"] },
          mrn: { type: ["string", "null"] },
          physician_name: { type: ["string", "null"] },
          date_of_service: { type: ["string", "null"] },
          diagnosis: { type: ["string", "null"] },
          phone: { type: ["string", "null"] },
          address: { type: ["string", "null"] }
        }
      }
    });

    // Filter out null values
    const extracted = {};
    for (const [key, value] of Object.entries(result)) {
      if (value !== null && value !== undefined && value !== '') {
        extracted[key] = value;
      }
    }

    return Response.json({ success: true, extracted });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});