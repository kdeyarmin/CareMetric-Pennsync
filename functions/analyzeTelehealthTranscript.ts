import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { 
      transcript, 
      patient_id, 
      visit_id,
      duration_minutes,
      visit_type = 'telehealth'
    } = await req.json();

    if (!transcript) {
      return Response.json({ error: 'Transcript is required' }, { status: 400 });
    }

    // Fetch patient context if available
    let patientContext = '';
    if (patient_id) {
      try {
        const patient = await base44.entities.Patient.get(patient_id);
        patientContext = `
Patient Context:
- Age: ${patient.date_of_birth ? Math.floor((Date.now() - new Date(patient.date_of_birth)) / 31557600000) : 'Unknown'}
- Primary Diagnosis: ${patient.primary_diagnosis || 'N/A'}
- Allergies: ${patient.allergies || 'None'}
- Current Medications: ${patient.current_medications?.map(m => m.name).join(', ') || 'None'}
`;
      } catch (e) {
        console.log('Could not fetch patient:', e.message);
      }
    }

    const prompt = `You are an expert in telehealth documentation and Medicare compliance for virtual care. Analyze this telehealth session transcript and provide a comprehensive analysis.

${patientContext}

Session Duration: ${duration_minutes || 'N/A'} minutes
Visit Type: ${visit_type}

Transcript:
${transcript}

Provide a detailed analysis including:

1. **Clinical Summary**: Concise overview of the visit
2. **Chief Complaint & Concerns**: Main reason for visit
3. **Key Discussion Points**: Important topics covered (bullet points)
4. **Assessment & Plan**: Provider's assessment and treatment plan
5. **Patient Understanding**: Evidence that patient understood the discussion
6. **Follow-up Actions**: Recommended next steps
7. **Red Flags**: Any concerning symptoms or urgent issues mentioned
8. **Compliance Check**: Telehealth-specific compliance requirements
9. **Documentation Quality Score**: Rate 1-100 with explanation
10. **Recommended Additions**: What should be added to improve documentation

Focus on:
- Medicare telehealth billing requirements
- HIPAA compliance
- Clinical decision-making rationale
- Patient consent and understanding
- Technology platform used (if mentioned)
- Location verification
- Medical necessity justification`;

    const response = await base44.integrations.Core.InvokeLLM({
      prompt,
      add_context_from_internet: false,
      response_json_schema: {
        type: "object",
        properties: {
          clinical_summary: { type: "string" },
          chief_complaint: { type: "string" },
          key_discussion_points: {
            type: "array",
            items: { type: "string" }
          },
          assessment_and_plan: { type: "string" },
          patient_understanding: { type: "string" },
          follow_up_actions: {
            type: "array",
            items: { type: "string" }
          },
          red_flags: {
            type: "array",
            items: {
              type: "object",
              properties: {
                flag: { type: "string" },
                severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
                action_required: { type: "string" }
              }
            }
          },
          compliance_check: {
            type: "object",
            properties: {
              consent_documented: { type: "boolean" },
              location_verified: { type: "boolean" },
              technology_platform_noted: { type: "boolean" },
              medical_necessity_justified: { type: "boolean" },
              hipaa_compliant: { type: "boolean" },
              issues: { type: "array", items: { type: "string" } }
            }
          },
          documentation_quality_score: { type: "number" },
          quality_explanation: { type: "string" },
          recommended_additions: {
            type: "array",
            items: { type: "string" }
          },
          billing_codes_suggested: {
            type: "array",
            items: {
              type: "object",
              properties: {
                code: { type: "string" },
                description: { type: "string" },
                justification: { type: "string" }
              }
            }
          },
          time_spent_documented: { type: "boolean" },
          requires_follow_up: { type: "boolean" }
        }
      }
    });

    // Auto-save analysis to visit if visit_id provided
    if (visit_id) {
      try {
        await base44.entities.Visit.update(visit_id, {
          telehealth_summary: response.clinical_summary,
          ai_tags: response.key_discussion_points
        });
      } catch (e) {
        console.error('Failed to save analysis to visit:', e);
      }
    }

    return Response.json({
      success: true,
      analysis: response,
      analyzed_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in analyzeTelehealthTranscript:', error);
    return Response.json({ 
      error: 'Failed to analyze transcript',
      details: error.message 
    }, { status: 500 });
  }
});