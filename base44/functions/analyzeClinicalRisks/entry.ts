import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { patientId } = await req.json();

    if (!patientId) {
      return Response.json({ error: 'Patient ID required' }, { status: 400 });
    }

    // Fetch comprehensive patient data
    const [patient, visits, oasisRecords, carePlans, incidents] = await Promise.all([
      base44.asServiceRole.entities.Patient.filter({ id: patientId }),
      base44.asServiceRole.entities.Visit.filter({ patient_id: patientId }, '-visit_date', 20),
      base44.asServiceRole.entities.OASISUpload.filter({ patient_id: patientId }, '-created_date', 3),
      base44.asServiceRole.entities.CarePlan.filter({ patient_id: patientId }),
      base44.asServiceRole.entities.Incident.filter({ patient_id: patientId }, '-incident_date', 10)
    ]);

    if (!patient[0]) {
      return Response.json({ error: 'Patient not found' }, { status: 404 });
    }

    const patientData = patient[0];
    const latestOASIS = oasisRecords[0];
    const recentVisits = visits.slice(0, 5);

    // Build comprehensive context for AI
    const prompt = `You are an expert clinical decision support system specializing in home health care. Analyze this patient's complete history to identify potential health deteriorations, care plan deviations, and proactive interventions needed.

PATIENT PROFILE:
- Name: ${patientData.first_name} ${patientData.last_name}
- Age: ${patientData.date_of_birth ? new Date().getFullYear() - new Date(patientData.date_of_birth).getFullYear() : 'Unknown'}
- Primary Diagnosis: ${patientData.primary_diagnosis || 'Not specified'}
- Secondary Diagnoses: ${patientData.secondary_diagnoses?.join(', ') || 'None'}
- Allergies: ${patientData.allergies || 'None documented'}
- Current Medications: ${JSON.stringify(patientData.current_medications || [])}
- Status: ${patientData.status}
- Admission Date: ${patientData.admission_date}

BASELINE DATA:
- Baseline Vitals: ${JSON.stringify(patientData.baseline_vitals || {})}
- Functional Status: ${JSON.stringify(patientData.functional_status || {})}
- Social History: ${JSON.stringify(patientData.social_history || {})}

RECENT OASIS ASSESSMENT (${latestOASIS ? `from ${latestOASIS.created_date}` : 'Not available'}):
${latestOASIS ? `
- Functional Level: ${latestOASIS.pdgm_data?.functional_impairment_level || 'Not assessed'}
- Clinical Grouping: ${latestOASIS.pdgm_data?.clinical_grouping || 'Not specified'}
- Comorbidities: ${JSON.stringify(latestOASIS.pdgm_data?.comorbidity_level || [])}
- Admission Source: ${latestOASIS.pdgm_data?.admission_source || 'Unknown'}
- Extracted Data: ${JSON.stringify(latestOASIS.extracted_data || {})}
` : 'No OASIS assessment available'}

RECENT VISIT HISTORY (Last 5 visits):
${recentVisits.map(v => `
Date: ${v.visit_date}
Type: ${v.visit_type}
Status: ${v.status}
Vital Signs: ${JSON.stringify(v.vital_signs || {})}
Notes: ${v.nurse_notes?.substring(0, 300) || 'No notes'}...
`).join('\n---\n')}

ACTIVE CARE PLANS (${carePlans.filter(cp => cp.status === 'active').length}):
${carePlans.filter(cp => cp.status === 'active').map(cp => `
Problem: ${cp.problem}
Goal: ${cp.goal}
Interventions: ${cp.interventions?.join('; ') || 'None'}
Target Date: ${cp.target_date}
Status: ${cp.status}
`).join('\n---\n')}

RECENT INCIDENTS (${incidents.length}):
${incidents.map(inc => `
Date: ${inc.incident_date}
Type: ${inc.incident_type}
Severity: ${inc.severity}
Details: ${JSON.stringify(inc.details || {})}
`).join('\n---\n')}

ANALYSIS REQUIREMENTS:

1. **VITAL SIGNS DETERIORATION**: Compare recent vitals to baseline. Identify concerning trends (BP elevation, O2 decline, heart rate changes, etc.)

2. **FUNCTIONAL DECLINE**: Compare recent visit observations to OASIS functional assessment. Identify mobility, ADL, or cognitive changes.

3. **MEDICATION CONCERNS**: Review current medications for:
   - Drug-drug interactions
   - Contraindications with diagnoses
   - Missing medications for conditions
   - High-risk medications (anticoagulants, insulin, narcotics)

4. **DIAGNOSIS-SPECIFIC MONITORING**: Based on primary diagnosis, identify what should be monitored and if it's being adequately assessed.

5. **CARE PLAN ADHERENCE**: Compare visit documentation to care plan interventions. Are goals being addressed? Are interventions being performed?

6. **INCIDENT PATTERNS**: Identify recurring incidents (falls, hospitalizations, medication errors) and root causes.

7. **SOCIAL DETERMINANTS**: Consider living situation, caregiver support, and social factors that may impact health.

8. **PREDICTIVE RISK FACTORS**: Identify early warning signs of:
   - Hospital readmission risk
   - Falls risk
   - Infection risk
   - Wound deterioration
   - Mental health decline

For EACH identified risk or concern, provide:
- **Severity**: critical, high, medium, low
- **Clinical Evidence**: Specific data points supporting this concern
- **Recommended Interventions**: Evidence-based nursing actions (prioritize top 3)
- **Rationale**: Why this intervention is recommended
- **Expected Outcomes**: What improvement to monitor for
- **Patient Education Topics**: What patient/family should understand
- **Nurse Education Resources**: If nurse needs training in this area

Return comprehensive JSON analysis:`;

    const result = await base44.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: "object",
        properties: {
          overall_risk_score: { type: "number" },
          risk_level: { type: "string" },
          clinical_alerts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                alert_type: { type: "string" },
                severity: { type: "string" },
                title: { type: "string" },
                clinical_evidence: { type: "array", items: { type: "string" } },
                recommended_interventions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      intervention: { type: "string" },
                      priority: { type: "number" },
                      rationale: { type: "string" },
                      expected_outcome: { type: "string" }
                    }
                  }
                },
                patient_education_topics: { type: "array", items: { type: "string" } },
                nurse_education_resources: { type: "array", items: { type: "string" } },
                monitoring_frequency: { type: "string" },
                escalation_criteria: { type: "string" }
              }
            }
          },
          trend_analysis: {
            type: "object",
            properties: {
              vital_signs_trend: { type: "string" },
              functional_status_trend: { type: "string" },
              care_plan_progress: { type: "string" },
              incident_frequency: { type: "string" }
            }
          },
          care_plan_deviations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                care_plan_problem: { type: "string" },
                deviation_description: { type: "string" },
                corrective_action: { type: "string" }
              }
            }
          },
          medication_concerns: {
            type: "array",
            items: {
              type: "object",
              properties: {
                concern_type: { type: "string" },
                medications_involved: { type: "array", items: { type: "string" } },
                risk_description: { type: "string" },
                recommendation: { type: "string" }
              }
            }
          },
          predictive_insights: {
            type: "object",
            properties: {
              readmission_risk: { type: "string" },
              fall_risk: { type: "string" },
              infection_risk: { type: "string" },
              deterioration_risk: { type: "string" }
            }
          }
        }
      }
    });

    return Response.json({
      success: true,
      patient_id: patientId,
      analysis_date: new Date().toISOString(),
      ...result
    });

  } catch (error) {
    console.error('Error analyzing clinical risks:', error);
    return Response.json({ 
      success: false,
      error: error.message 
    }, { status: 500 });
  }
});