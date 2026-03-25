import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { 
      chief_complaint, 
      symptoms, 
      vital_signs, 
      patient_history,
      current_medications,
      physical_exam_findings,
      patient_id 
    } = await req.json();

    if (!chief_complaint && !symptoms) {
      return Response.json({ error: 'Chief complaint or symptoms required' }, { status: 400 });
    }

    // Fetch patient data for additional context if provided
    let patientContext = '';
    if (patient_id) {
      try {
        const patient = await base44.entities.Patient.get(patient_id);
        patientContext = `
Existing Patient Data:
- Age: ${patient.date_of_birth ? Math.floor((Date.now() - new Date(patient.date_of_birth)) / 31557600000) : 'Unknown'}
- Primary Diagnosis: ${patient.primary_diagnosis || 'N/A'}
- Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'N/A'}
- Allergies: ${patient.allergies || 'None documented'}
- Past Medical History: ${patient.past_medical_history?.join(', ') || 'N/A'}
- Current Medications: ${patient.current_medications?.map(m => m.name).join(', ') || 'N/A'}
`;
      } catch (e) {
        console.log('Could not fetch patient:', e.message);
      }
    }

    const prompt = `You are an expert clinical diagnostician with extensive knowledge in home health and hospice medicine. Provide a comprehensive differential diagnosis based on the following clinical presentation.

${patientContext}

Chief Complaint: ${chief_complaint || 'N/A'}

Presenting Symptoms:
${symptoms || 'N/A'}

Vital Signs:
${vital_signs ? JSON.stringify(vital_signs, null, 2) : 'N/A'}

Patient History:
${patient_history || 'N/A'}

Current Medications:
${current_medications || 'N/A'}

Physical Exam Findings:
${physical_exam_findings || 'N/A'}

Provide a differential diagnosis analysis with:

1. **Most Likely Diagnoses** (Top 3-5 ranked by probability)
   - For each: diagnosis name, probability level, key supporting factors, key features to look for

2. **Other Possible Diagnoses** (Consider but less likely)
   - Brief rationale for each

3. **Critical "Cannot Miss" Diagnoses** (Life-threatening conditions to rule out)
   - Red flags to watch for

4. **Recommended Diagnostic Tests/Workup**
   - Prioritized list with rationale

5. **Immediate Actions & Monitoring**
   - What to monitor, when to escalate to physician/hospital

6. **Clinical Reasoning**
   - Overall clinical impression and thought process

Focus on conditions relevant to home health/hospice settings and consider patient's existing conditions and medications.`;

    const response = await base44.integrations.Core.InvokeLLM({
      prompt,
      add_context_from_internet: false,
      response_json_schema: {
        type: "object",
        properties: {
          most_likely_diagnoses: {
            type: "array",
            items: {
              type: "object",
              properties: {
                diagnosis: { type: "string" },
                icd10_code: { type: "string" },
                probability: { type: "string", enum: ["Very High", "High", "Moderate"] },
                supporting_factors: { type: "array", items: { type: "string" } },
                key_features: { type: "array", items: { type: "string" } },
                clinical_reasoning: { type: "string" }
              }
            }
          },
          other_possible_diagnoses: {
            type: "array",
            items: {
              type: "object",
              properties: {
                diagnosis: { type: "string" },
                icd10_code: { type: "string" },
                rationale: { type: "string" }
              }
            }
          },
          cannot_miss_diagnoses: {
            type: "array",
            items: {
              type: "object",
              properties: {
                diagnosis: { type: "string" },
                red_flags: { type: "array", items: { type: "string" } },
                immediate_actions: { type: "string" }
              }
            }
          },
          recommended_workup: {
            type: "array",
            items: {
              type: "object",
              properties: {
                test: { type: "string" },
                priority: { type: "string", enum: ["Urgent", "High", "Moderate", "Low"] },
                rationale: { type: "string" }
              }
            }
          },
          monitoring_plan: {
            type: "object",
            properties: {
              vital_signs_to_monitor: { type: "array", items: { type: "string" } },
              frequency: { type: "string" },
              escalation_criteria: { type: "array", items: { type: "string" } }
            }
          },
          clinical_impression: { type: "string" },
          physician_notification_recommended: { type: "boolean" },
          urgency_level: { type: "string", enum: ["Emergency", "Urgent", "Routine", "Non-Urgent"] }
        }
      }
    });

    return Response.json({
      success: true,
      differential_diagnosis: response,
      generated_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in generateDifferentialDiagnosis:', error);
    return Response.json({ 
      error: 'Failed to generate differential diagnosis',
      details: error.message 
    }, { status: 500 });
  }
});