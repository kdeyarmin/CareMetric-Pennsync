import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { narrative, data_type, patient_id, visit_type } = await req.json();

        if (!narrative || !data_type) {
            return Response.json({ error: 'narrative and data_type are required' }, { status: 400 });
        }

        // Get patient context if provided
        let patientContext = '';
        if (patient_id) {
            const patient = await base44.entities.Patient.get(patient_id);
            if (patient) {
                patientContext = `
**Patient Context:**
- Name: ${patient.first_name} ${patient.last_name}
- Primary Diagnosis: ${patient.primary_diagnosis || 'Not specified'}
- Current Medications: ${patient.current_medications?.map(m => m.name).join(', ') || 'None'}
- Allergies: ${patient.allergies || 'NKDA'}
`;
            }
        }

        // Define schemas based on data type
        const schemas = {
            vital_signs: {
                type: "object",
                properties: {
                    temperature: { type: "number" },
                    blood_pressure_systolic: { type: "number" },
                    blood_pressure_diastolic: { type: "number" },
                    heart_rate: { type: "number" },
                    respiratory_rate: { type: "number" },
                    oxygen_saturation: { type: "number" },
                    pain_level: { type: "number" },
                    weight: { type: "number" }
                }
            },
            oasis_m1800: {
                type: "object",
                properties: {
                    grooming: { type: "string" },
                    upper_body_dressing: { type: "string" },
                    lower_body_dressing: { type: "string" },
                    bathing: { type: "string" },
                    toileting: { type: "string" },
                    toileting_hygiene: { type: "string" },
                    transferring: { type: "string" },
                    ambulation: { type: "string" },
                    eating: { type: "string" }
                }
            },
            assessment_data: {
                type: "object",
                properties: {
                    mental_status: { type: "string" },
                    mood: { type: "string" },
                    behavior: { type: "string" },
                    cognitive_status: { type: "string" },
                    pain_assessment: { type: "string" },
                    functional_limitations: { type: "array", items: { type: "string" } },
                    safety_concerns: { type: "array", items: { type: "string" } }
                }
            },
            medication_data: {
                type: "object",
                properties: {
                    medications_reviewed: { type: "boolean" },
                    medication_changes: { type: "array", items: { type: "string" } },
                    adherence_issues: { type: "array", items: { type: "string" } },
                    side_effects_noted: { type: "array", items: { type: "string" } }
                }
            }
        };

        const targetSchema = schemas[data_type] || schemas.assessment_data;

        const extractionPrompt = `You are a clinical data extraction specialist. Extract structured data from the following clinical narrative.

${patientContext}

**Clinical Narrative:**
${narrative}

**Task:**
Extract all relevant data that matches the target schema. Be precise with numbers. If information is not mentioned in the narrative, omit that field (do not guess or make up data).

For vital signs:
- Extract exact numeric values only (e.g., "BP 120/80" → systolic: 120, diastolic: 80)
- Temperature in Fahrenheit
- Pain level 0-10 scale

For OASIS or assessment data:
- Use exact terminology from the narrative
- Be specific about functional status descriptions

Only include fields with actual evidence in the narrative.`;

        const extractedData = await base44.integrations.Core.InvokeLLM({
            prompt: extractionPrompt,
            response_json_schema: targetSchema
        });

        return Response.json({ 
            success: true,
            extracted_data: extractedData,
            data_type,
            confidence: 'high',
            fields_extracted: Object.keys(extractedData).length
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});