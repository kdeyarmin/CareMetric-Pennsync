import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is a nurse - nurses shouldn't access billing codes
    const providerSettings = await base44.entities.ProviderSettings.filter({ user_email: user.email });
    const credentialType = providerSettings[0]?.credential_type;
    
    if (credentialType === 'rn' || credentialType === 'lpn' || credentialType === 'cna') {
      return Response.json({ 
        error: 'Billing code suggestions not available for nursing staff',
        reason: 'This feature is restricted to providers with billing privileges'
      }, { status: 403 });
    }

    const { 
      clinical_data,
      evidence_report,
      patient_id,
      visit_id,
      encounter_type,
      visit_duration_minutes,
      provider_specialty
    } = await req.json();

    if (!clinical_data && !evidence_report) {
      return Response.json({ error: 'Clinical data or evidence report required' }, { status: 400 });
    }

    // Fetch patient context
    let patientContext = '';
    if (patient_id) {
      try {
        const patient = await base44.entities.Patient.get(patient_id);
        const age = patient.date_of_birth ? Math.floor((Date.now() - new Date(patient.date_of_birth)) / 31557600000) : 'Unknown';
        patientContext = `
Patient: ${age} years old
Primary Diagnosis: ${patient.primary_diagnosis || 'N/A'}
Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None'}
Insurance: ${patient.insurance_primary?.provider || 'Unknown'}
`;
      } catch (e) {
        console.log('Could not fetch patient:', e.message);
      }
    }

    const prompt = `You are an expert medical billing and coding specialist with deep knowledge of ICD-10-CM, CPT, and HCPCS coding guidelines.

${patientContext}

Clinical Information:
${clinical_data || ''}

${evidence_report ? `Evidence-Based Report:
Executive Summary: ${evidence_report.executive_summary || ''}
Differential Diagnoses: ${evidence_report.differential_diagnoses?.map(d => d.diagnosis).join(', ') || ''}
Treatment Options: ${evidence_report.treatment_options?.map(t => t.treatment).join(', ') || ''}
` : ''}

Encounter Details:
- Type: ${encounter_type || 'Office Visit'}
- Duration: ${visit_duration_minutes || 'Not specified'} minutes
- Provider Specialty: ${provider_specialty || 'General Medicine'}

Generate comprehensive coding recommendations including:

1. **ICD-10-CM Diagnosis Codes**: Primary and secondary diagnoses with full codes and descriptions
2. **CPT Procedure Codes**: Evaluation & Management codes and any procedures performed
3. **Modifiers**: Any applicable modifiers
4. **Supporting Documentation**: What documentation supports each code
5. **Medical Necessity**: Justification for medical necessity
6. **Compliance Alerts**: Any potential coding compliance issues
7. **Reimbursement Considerations**: Expected reimbursement tier and any special considerations

Use current 2026 ICD-10-CM and CPT coding guidelines. Include code descriptions, specificity requirements, and proper sequencing.`;

    const response = await base44.integrations.Core.InvokeLLM({
      prompt,
      add_context_from_internet: true,
      response_json_schema: {
        type: "object",
        properties: {
          icd10_codes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                code: { type: "string" },
                description: { type: "string" },
                type: { type: "string", enum: ["primary", "secondary", "comorbidity"] },
                specificity_level: { type: "number" },
                documentation_requirements: { type: "array", items: { type: "string" } },
                clinical_rationale: { type: "string" },
                confidence_score: { type: "number" }
              }
            }
          },
          cpt_codes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                code: { type: "string" },
                description: { type: "string" },
                category: { type: "string" },
                modifiers: { type: "array", items: { type: "string" } },
                units: { type: "number" },
                time_based: { type: "boolean" },
                required_documentation: { type: "array", items: { type: "string" } },
                medical_necessity_link: { type: "string" },
                expected_reimbursement_tier: { type: "string", enum: ["high", "medium", "low"] },
                confidence_score: { type: "number" }
              }
            }
          },
          em_code_recommendation: {
            type: "object",
            properties: {
              code: { type: "string" },
              level: { type: "string" },
              time_documented: { type: "boolean" },
              complexity_factors: { type: "array", items: { type: "string" } },
              mdm_level: { type: "string" }
            }
          },
          compliance_alerts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                alert_type: { type: "string" },
                severity: { type: "string", enum: ["critical", "warning", "info"] },
                message: { type: "string" },
                recommendation: { type: "string" }
              }
            }
          },
          medical_necessity_statement: { type: "string" },
          documentation_gaps: { type: "array", items: { type: "string" } },
          coding_tips: { type: "array", items: { type: "string" } },
          estimated_total_rvus: { type: "number" },
          payer_specific_notes: { type: "array", items: { type: "string" } }
        }
      }
    });

    // Log the code suggestion for audit
    await base44.entities.SecurityLog.create({
      timestamp: new Date().toISOString(),
      user_email: user.email,
      user_role: user.role,
      action: 'generate_code_suggestions',
      details: {
        patient_id: patient_id || 'none',
        visit_id: visit_id || 'none',
        icd10_count: response.icd10_codes?.length || 0,
        cpt_count: response.cpt_codes?.length || 0,
        em_code: response.em_code_recommendation?.code
      }
    });

    return Response.json({
      success: true,
      suggestions: response,
      generated_at: new Date().toISOString(),
      provider: user.email,
      credential_type: credentialType
    });

  } catch (error) {
    console.error('Error in suggestClinicalCodes:', error);
    return Response.json({ 
      error: 'Failed to generate code suggestions',
      details: error.message 
    }, { status: 500 });
  }
});