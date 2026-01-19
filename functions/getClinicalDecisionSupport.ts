import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { patientId } = await req.json();

    if (!patientId) {
      return Response.json({ error: 'Patient ID required' }, { status: 400 });
    }

    // Fetch patient data
    const patient = await base44.entities.Patient.get(patientId);
    
    // Fetch recent document analyses
    const analyses = await base44.entities.DocumentAnalysisHistory.filter({ patient_id: patientId });
    const recentAnalyses = analyses.slice(0, 3);

    // Fetch recent visits
    const visits = await base44.entities.Visit.filter({ patient_id: patientId });
    const recentVisits = visits.slice(0, 5);

    // Build comprehensive patient context
    const patientContext = {
      demographics: {
        age: patient.date_of_birth ? new Date().getFullYear() - new Date(patient.date_of_birth).getFullYear() : null,
        gender: patient.gender
      },
      diagnoses: {
        primary: patient.primary_diagnosis,
        secondary: patient.secondary_diagnoses || []
      },
      medications: patient.current_medications || [],
      allergies: patient.allergies,
      vitals: patient.baseline_vitals,
      pastMedicalHistory: patient.past_medical_history || [],
      recentDocumentFindings: recentAnalyses.map(a => a.analysis_summary).filter(Boolean),
      recentVisitNotes: recentVisits.map(v => v.nurse_notes).filter(Boolean)
    };

    // Call LLM for clinical decision support
    const prompt = `You are an expert clinical decision support system. Analyze the following patient data and provide comprehensive clinical recommendations.

PATIENT DATA:
${JSON.stringify(patientContext, null, 2)}

Provide a detailed clinical decision support analysis including:
1. Differential diagnoses based on current symptoms and findings
2. Evidence-based treatment protocols for confirmed diagnoses
3. Recommended specialist referrals with rationale
4. Drug interaction warnings and contraindications
5. Preventive care recommendations
6. Red flags or urgent concerns

Be specific, evidence-based, and cite relevant clinical guidelines when appropriate.`;

    const schema = {
      type: "object",
      properties: {
        differential_diagnoses: {
          type: "array",
          items: {
            type: "object",
            properties: {
              diagnosis: { type: "string" },
              likelihood: { type: "string", enum: ["high", "moderate", "low"] },
              supporting_evidence: { type: "array", items: { type: "string" } },
              recommended_tests: { type: "array", items: { type: "string" } }
            }
          }
        },
        treatment_protocols: {
          type: "array",
          items: {
            type: "object",
            properties: {
              condition: { type: "string" },
              protocol: { type: "string" },
              evidence_level: { type: "string" },
              guidelines_reference: { type: "string" }
            }
          }
        },
        specialist_referrals: {
          type: "array",
          items: {
            type: "object",
            properties: {
              specialty: { type: "string" },
              urgency: { type: "string", enum: ["urgent", "routine", "optional"] },
              rationale: { type: "string" }
            }
          }
        },
        drug_interactions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              medications: { type: "array", items: { type: "string" } },
              interaction_type: { type: "string" },
              severity: { type: "string", enum: ["severe", "moderate", "mild"] },
              recommendation: { type: "string" }
            }
          }
        },
        contraindications: {
          type: "array",
          items: {
            type: "object",
            properties: {
              medication: { type: "string" },
              reason: { type: "string" },
              alternative: { type: "string" }
            }
          }
        },
        preventive_care: {
          type: "array",
          items: {
            type: "object",
            properties: {
              recommendation: { type: "string" },
              rationale: { type: "string" },
              timeline: { type: "string" }
            }
          }
        },
        red_flags: {
          type: "array",
          items: {
            type: "object",
            properties: {
              concern: { type: "string" },
              urgency: { type: "string", enum: ["immediate", "urgent", "monitor"] },
              action_required: { type: "string" }
            }
          }
        },
        clinical_summary: { type: "string" }
      }
    };

    const result = await base44.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: schema
    });

    // Log the clinical decision support request
    await base44.entities.SecurityLog.create({
      timestamp: new Date().toISOString(),
      user_email: user.email,
      user_role: user.role,
      action: 'clinical_decision_support_requested',
      details: { patient_id: patientId }
    });

    return Response.json({
      success: true,
      analysis: result,
      patient_name: `${patient.first_name} ${patient.last_name}`,
      generated_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('Clinical decision support error:', error);
    return Response.json({ 
      error: error.message || 'Failed to generate clinical decision support' 
    }, { status: 500 });
  }
});