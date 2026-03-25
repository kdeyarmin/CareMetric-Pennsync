import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { 
      roughNote, 
      enhancedNote,
      visitType, 
      diagnosis,
      vitalSigns,
      patientId,
      analysisTypes // ['compliance', 'oasis', 'pdgm', 'proactive']
    } = await req.json();

    if (!analysisTypes || !Array.isArray(analysisTypes)) {
      return Response.json({ error: 'analysisTypes array required' }, { status: 400 });
    }

    // Fetch patient data once for all analyses
    let patientData = null;
    let carePlans = [];
    let recentVisits = [];
    let oasisData = null;

    if (patientId) {
      const [patient, plans, visits, oasis] = await Promise.all([
        base44.asServiceRole.entities.Patient.filter({ id: patientId }, '', 1),
        base44.asServiceRole.entities.CarePlan.filter({ patient_id: patientId, status: 'active' }),
        base44.asServiceRole.entities.Visit.filter({ patient_id: patientId, status: 'completed' }, '-visit_date', 3),
        base44.asServiceRole.entities.OASISUpload.filter({ patient_id: patientId }, '-created_date', 1)
      ]);
      
      patientData = patient[0] || null;
      carePlans = plans || [];
      recentVisits = visits || [];
      oasisData = oasis[0] || null;
    }

    // Build shared context for all analyses
    const sharedContext = `
PATIENT DATA:
${patientData ? `- Name: ${patientData.first_name} ${patientData.last_name}
- Primary Diagnosis: ${patientData.primary_diagnosis || diagnosis}
- Age: ${patientData.date_of_birth ? Math.floor((new Date() - new Date(patientData.date_of_birth)) / (365.25 * 24 * 60 * 60 * 1000)) : 'Unknown'}
- Allergies: ${patientData.allergies || 'None documented'}` : ''}

VISIT DETAILS:
- Visit Type: ${visitType}
- Diagnosis: ${diagnosis}
- Vitals: ${JSON.stringify(vitalSigns)}

ACTIVE CARE PLANS: ${carePlans.length > 0 ? carePlans.map(cp => `${cp.problem}: ${cp.goal}`).join('; ') : 'None'}

RECENT VISITS: ${recentVisits.length > 0 ? `Last visit ${recentVisits[0].visit_date}` : 'None'}
`;

    // Batch all AI analyses in parallel
    const analyses = {};
    const promises = [];

    if (analysisTypes.includes('compliance') && (roughNote || enhancedNote)) {
      promises.push(
        base44.asServiceRole.integrations.Core.InvokeLLM({
          prompt: `Analyze this clinical note for Medicare compliance. Return score and specific gaps.

${sharedContext}

NOTE TO ANALYZE:
${enhancedNote || roughNote}

Return JSON with compliance_score (0-100), missing_elements array, and specific_gaps array.`,
          response_json_schema: {
            type: "object",
            properties: {
              compliance_score: { type: "number" },
              missing_elements: { type: "array", items: { type: "string" } },
              specific_gaps: { type: "array", items: { type: "object" } }
            }
          }
        }).then(result => { analyses.compliance = result; })
      );
    }

    if (analysisTypes.includes('oasis') && enhancedNote && oasisData) {
      promises.push(
        base44.asServiceRole.integrations.Core.InvokeLLM({
          prompt: `Map this clinical note to OASIS items with confidence scores and justifications.

${sharedContext}

ENHANCED NOTE:
${enhancedNote}

Return JSON with mappings array containing: oasis_item, suggested_value, confidence, evidence_from_note, clinical_justification.`,
          response_json_schema: {
            type: "object",
            properties: {
              mappings: { type: "array", items: { type: "object" } },
              high_confidence_items: { type: "number" },
              medium_confidence_items: { type: "number" }
            }
          }
        }).then(result => { analyses.oasis = result; })
      );
    }

    if (analysisTypes.includes('pdgm') && enhancedNote && patientData) {
      promises.push(
        base44.asServiceRole.integrations.Core.InvokeLLM({
          prompt: `Analyze for PDGM optimization opportunities.

${sharedContext}

ENHANCED NOTE:
${enhancedNote}

Identify comorbidity capture, functional impairment documentation, and clinical group optimization opportunities.
Return JSON with opportunities array and revenue_impact.`,
          response_json_schema: {
            type: "object",
            properties: {
              opportunities: { type: "array", items: { type: "object" } },
              revenue_impact: { type: "number" },
              summary: { type: "string" }
            }
          }
        }).then(result => { analyses.pdgm = result; })
      );
    }

    if (analysisTypes.includes('proactive') && (roughNote || enhancedNote)) {
      promises.push(
        base44.asServiceRole.integrations.Core.InvokeLLM({
          prompt: `Generate proactive suggestions for tasks, care plan updates, and clinical alerts.

${sharedContext}

NOTE:
${enhancedNote || roughNote}

Return JSON with followup_tasks, care_plan_suggestions, clinical_alerts, documentation_gaps, and education_needs arrays.`,
          response_json_schema: {
            type: "object",
            properties: {
              followup_tasks: { type: "array", items: { type: "object" } },
              care_plan_suggestions: { type: "array", items: { type: "object" } },
              clinical_alerts: { type: "array", items: { type: "object" } },
              documentation_gaps: { type: "array", items: { type: "object" } },
              education_needs: { type: "array", items: { type: "object" } }
            }
          }
        }).then(result => { analyses.proactive = result; })
      );
    }

    // Wait for all analyses to complete
    await Promise.all(promises);

    return Response.json({
      success: true,
      analyses,
      context: {
        patient_id: patientId,
        has_oasis: !!oasisData,
        care_plans_count: carePlans.length,
        recent_visits_count: recentVisits.length
      }
    });

  } catch (error) {
    console.error('Batch analysis error:', error);
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});