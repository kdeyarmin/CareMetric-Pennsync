import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Tolerant JSON extractor: we ask for strict JSON in-prompt instead of passing
// response_json_schema, because the provider rejects deeply-nested object
// schemas that lack an explicit `required` array at every level.
function parseLLMJson(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  const text = String(raw).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  }
}

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
      // Authorize against the patient before its PHI drives the analyses
      // (assigned nurse or admin). RLS-independent code check.
      if (patientData && user.role !== 'admin' && patientData.created_by !== user.email && !(Array.isArray(patientData.assigned_nurses) && patientData.assigned_nurses.includes(user.email))) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
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
          model: "claude_opus_4_8",
          prompt: `Analyze this clinical note for Medicare compliance. Return score and specific gaps.

${sharedContext}

NOTE TO ANALYZE:
${enhancedNote || roughNote}

Return ONLY valid JSON, no prose or code fences, with this shape:
{"compliance_score":0,"missing_elements":[""],"specific_gaps":[{}]}`
        }).then(result => { analyses.compliance = parseLLMJson(result) || {}; })
      );
    }

    if (analysisTypes.includes('oasis') && enhancedNote && oasisData) {
      promises.push(
        base44.asServiceRole.integrations.Core.InvokeLLM({
          model: "claude_opus_4_8",
          prompt: `Map this clinical note to OASIS items with confidence scores and justifications.

${sharedContext}

ENHANCED NOTE:
${enhancedNote}

Return ONLY valid JSON, no prose or code fences, with this shape:
{"mappings":[{"oasis_item":"","suggested_value":"","confidence":0,"evidence_from_note":"","clinical_justification":""}],"high_confidence_items":0,"medium_confidence_items":0}`
        }).then(result => { analyses.oasis = parseLLMJson(result) || {}; })
      );
    }

    if (analysisTypes.includes('pdgm') && enhancedNote && patientData) {
      promises.push(
        base44.asServiceRole.integrations.Core.InvokeLLM({
          model: "claude_opus_4_8",
          prompt: `Analyze for PDGM optimization opportunities.

${sharedContext}

ENHANCED NOTE:
${enhancedNote}

Identify comorbidity capture, functional impairment documentation, and clinical group optimization opportunities.
Return ONLY valid JSON, no prose or code fences, with this shape:
{"opportunities":[{}],"revenue_impact":0,"summary":""}`
        }).then(result => { analyses.pdgm = parseLLMJson(result) || {}; })
      );
    }

    if (analysisTypes.includes('proactive') && (roughNote || enhancedNote)) {
      promises.push(
        base44.asServiceRole.integrations.Core.InvokeLLM({
          model: "claude_opus_4_8",
          prompt: `Generate proactive suggestions for tasks, care plan updates, and clinical alerts.

${sharedContext}

NOTE:
${enhancedNote || roughNote}

Return ONLY valid JSON, no prose or code fences, with this shape:
{"followup_tasks":[{}],"care_plan_suggestions":[{}],"clinical_alerts":[{}],"documentation_gaps":[{}],"education_needs":[{}]}`
        }).then(result => { analyses.proactive = parseLLMJson(result) || {}; })
      );
    }

    // Wait for all analyses to settle. allSettled (not all) so one analysis
    // failing doesn't discard the others that already succeeded — each writes
    // its own result into `analyses` on success, and a rejected one is simply
    // omitted rather than 500-ing the whole batch.
    await Promise.allSettled(promises);

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