import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const base44Client = createClientFromRequest(new Request('http://localhost'));

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { file_urls, document_type = 'clinical_note', patient_context = null } = body;

    if (!file_urls || !Array.isArray(file_urls) || file_urls.length === 0) {
      return Response.json({ error: 'No files provided' }, { status: 400 });
    }

    console.log('[analyzePatientDocument] Analyzing', file_urls.length, 'document(s)');

    const analysisPrompt = `You are an expert medical document analyzer. Carefully analyze the provided medical document(s) and extract all relevant clinical information.

DOCUMENT TYPE: ${document_type}
${patient_context ? `PATIENT CONTEXT: ${JSON.stringify(patient_context)}` : ''}

Extract and structure the following information if present:

1. DEMOGRAPHICS: patient name, DOB, MRN, gender, contact info
2. DIAGNOSES: primary and secondary diagnoses with ICD-10 codes if visible
3. MEDICATIONS: medication names, dosages, frequencies, start dates
4. ALLERGIES: known allergies and adverse reactions (mark NKDA if none documented)
5. VITAL_SIGNS: blood pressure, heart rate, temperature, respiratory rate, O2 saturation, weight
6. LAB_RESULTS: any lab values with dates and normal ranges
7. CLINICAL_SUMMARY: key clinical findings and observations
8. ASSESSMENT: overall assessment/impression from document
9. PLAN: treatment plan, recommendations, follow-up instructions
10. ENCOUNTERS: visit date, visit type, provider name

Return ONLY valid JSON matching this schema. For missing fields, use null. For arrays with no data, use empty array.

Ensure accuracy - do NOT guess or infer information not explicitly stated in the document.`;

    const result = await base44.integrations.Core.InvokeLLM({
      prompt: analysisPrompt,
      file_urls: file_urls,
      add_context_from_internet: false,
      response_json_schema: {
        type: 'object',
        properties: {
          demographics: {
            type: 'object',
            properties: {
              patient_name: { type: 'string' },
              date_of_birth: { type: 'string' },
              medical_record_number: { type: 'string' },
              gender: { type: 'string' },
              email: { type: 'string' },
              phone: { type: 'string' },
              address: { type: 'string' }
            }
          },
          diagnoses: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                diagnosis: { type: 'string' },
                icd10_code: { type: 'string' },
                is_new: { type: 'boolean' }
              }
            }
          },
          medications: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                dosage: { type: 'string' },
                frequency: { type: 'string' },
                prescriber: { type: 'string' },
                start_date: { type: 'string' },
                is_new: { type: 'boolean' }
              }
            }
          },
          allergies: {
            type: 'array',
            items: { type: 'string' }
          },
          vital_signs: {
            type: 'object',
            properties: {
              blood_pressure_systolic: { type: 'number' },
              blood_pressure_diastolic: { type: 'number' },
              heart_rate: { type: 'number' },
              respiratory_rate: { type: 'number' },
              temperature: { type: 'number' },
              oxygen_saturation: { type: 'number' },
              weight: { type: 'number' },
              height: { type: 'number' }
            }
          },
          lab_results: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                test_name: { type: 'string' },
                value: { type: 'string' },
                unit: { type: 'string' },
                normal_range: { type: 'string' },
                test_date: { type: 'string' }
              }
            }
          },
          clinical_summary: { type: 'string' },
          assessment: { type: 'string' },
          plan: { type: 'string' },
          encounters: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                visit_date: { type: 'string' },
                visit_type: { type: 'string' },
                provider_name: { type: 'string' }
              }
            }
          },
          confidence_level: {
            type: 'string',
            enum: ['high', 'medium', 'low']
          },
          extraction_notes: { type: 'string' }
        }
      }
    });

    // Save analysis to database
    const analysis = {
      provider_email: user.email,
      document_type,
      file_count: file_urls.length,
      file_names: file_urls,
      analysis_summary: result.clinical_summary || `Analysis of ${document_type}`,
      full_analysis: result,
      extracted_at: new Date().toISOString()
    };

    const savedAnalysis = await base44.asServiceRole.entities.DocumentAnalysisHistory.create(analysis);
    console.log('[analyzePatientDocument] Analysis saved:', savedAnalysis.id);

    return Response.json({
      success: true,
      analysis_id: savedAnalysis.id,
      extracted_data: result,
      file_count: file_urls.length
    });
  } catch (error) {
    console.error('[analyzePatientDocument] Error:', error.message);
    return Response.json({
      error: 'Document analysis failed',
      details: error.message
    }, { status: 500 });
  }
});