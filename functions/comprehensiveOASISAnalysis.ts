import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import OpenAI from 'npm:openai@4.28.0';

const openai = new OpenAI({
  apiKey: Deno.env.get('OPENAI_API_KEY'),
});

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { oasis_data, narrative_text, patient_id } = await req.json();

    if (!oasis_data && !narrative_text) {
      return Response.json({ 
        success: false, 
        error: 'OASIS data or narrative text is required.' 
      }, { status: 400 });
    }

    // Fetch patient context if available
    let patientContext = "";
    if (patient_id) {
      try {
        const patient = await base44.entities.Patient.get(patient_id);
        patientContext = `
Patient Context:
- Age: ${patient.age || 'N/A'}
- Diagnoses: ${patient.primary_diagnosis || 'N/A'}
- Medical History: ${patient.medical_history || 'N/A'}
`;
      } catch (err) {
        console.warn('Could not fetch patient context:', err);
      }
    }

    const medicareRules = await base44.entities.MedicareComplianceRule.filter({ is_active: true });
    const medicareContext = medicareRules.map(rule => 
      `- ${rule.category}: ${rule.description} (Reference: ${rule.cop_reference})`
    ).join('\n');

    const prompt = `You are an expert OASIS-E analyst specializing in home health outcomes, compliance, and care planning.

Analyze the OASIS assessment comprehensively and provide:

Medicare Compliance Context:
${medicareContext}

${patientContext}

OASIS Data:
${JSON.stringify(oasis_data, null, 2)}

Narrative Notes:
${narrative_text}

Provide a detailed JSON output with:

1. **Completeness Analysis**:
   - completeness_score: number (0-100)
   - missing_data_points: Array of { field: string, oasis_item: string, severity: "critical"|"medium"|"low", reason: string, impact_on_reimbursement: boolean }
   - data_quality_issues: Array of { field: string, issue: string, suggestion: string }

2. **Accuracy Assessment**:
   - accuracy_score: number (0-100)
   - accuracy_flags: Array of { field: string, oasis_item: string, issue: string, suggested_value: string, confidence: number }
   - inconsistencies: Array of { field: string, issue: string, narrative_conflict: string, suggestion: string }

3. **Compliance Check**:
   - compliance_status: "compliant"|"flagged"|"critical"
   - compliance_warnings: Array of { rule: string, details: string, remediation: string }
   - documentation_gaps: Array of { area: string, missing_element: string, cop_reference: string }

4. **Predictive Outcomes** (based on OASIS scores and patient data):
   - risk_scores: { hospitalization_risk: number, fall_risk: number, functional_decline_risk: number, wound_healing_risk: number }
   - predicted_los: number (estimated length of service in days)
   - predicted_outcomes: Array of { outcome: string, probability: number, timeframe: string, contributing_factors: string[] }
   - early_warning_flags: Array of { indicator: string, severity: string, recommendation: string }

5. **Care Plan Recommendations**:
   - priority_interventions: Array of { intervention: string, rationale: string, oasis_indicators: string[], expected_outcome: string, frequency: string }
   - discipline_requirements: Array of { discipline: string, recommended_visits: number, focus_areas: string[] }
   - equipment_dme_needs: Array of { item: string, justification: string, oasis_support: string }
   - education_needs: Array of { topic: string, priority: string, target_audience: string[] }
   - monitoring_requirements: Array of { parameter: string, frequency: string, alert_threshold: string }

6. **PDGM Optimization**:
   - clinical_grouping: string
   - functional_impairment_level: string
   - case_mix_weight_impact: string
   - coding_optimization_suggestions: Array of { current: string, recommended: string, rationale: string }

7. **Overall Summary**:
   - summary_message: string
   - key_concerns: Array of strings
   - action_items: Array of { priority: string, action: string, deadline: string }

Return valid JSON only.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are an expert OASIS analyst providing comprehensive assessments for home health care."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 4000
    });

    const result = JSON.parse(completion.choices[0].message.content);

    // Store audit record
    await base44.asServiceRole.entities.OASISAudit.create({
      user_email: user.email,
      patient_id: patient_id || null,
      status: result.compliance_status || 'flagged',
      summary: result.summary_message || 'OASIS analysis completed',
      details: result,
      analysis_date: new Date().toISOString(),
      missing_data_points: result.missing_data_points || [],
      accuracy_flags: result.accuracy_flags || [],
      predictive_summary: JSON.stringify(result.predicted_outcomes || []),
      care_plan_summary: JSON.stringify(result.priority_interventions || [])
    });

    return Response.json({ success: true, analysis: result });

  } catch (error) {
    console.error('Comprehensive OASIS analysis error:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});