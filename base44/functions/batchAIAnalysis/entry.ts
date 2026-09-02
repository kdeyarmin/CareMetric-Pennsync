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


// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// <<<BEGIN SHARED HELPER: formatAge — generated, edit base44/_shared/backendHelpers.mjs>>>
function parseLocalDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(value).trim());
  if (iso) {
    const y = Number(iso[1]);
    const mo = Number(iso[2]) - 1;
    const day = Number(iso[3]);
    const d = new Date(y, mo, day);
    if (d.getFullYear() !== y || d.getMonth() !== mo || d.getDate() !== day) return null;
    return d;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
function calculateAge(dob, now = new Date()) {
  const birth = parseLocalDate(dob);
  const today = parseLocalDate(now);
  if (!birth || !today) return null;
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}
function formatAge(dob, now = new Date(), fallback = 'Unknown') {
  const age = calculateAge(dob, now);
  return age == null ? fallback : age;
}
// <<<END SHARED HELPER: formatAge>>>
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

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
    let recentVisits = [];
    let oasisData = null;

    if (patientId) {
      const [patient, visits, oasis] = await Promise.all([
        base44.asServiceRole.entities.Patient.filter({ id: patientId }, '', 1),
        base44.asServiceRole.entities.Visit.filter({ patient_id: patientId, status: 'completed' }, '-visit_date', 3),
        base44.asServiceRole.entities.OASISUpload.filter({ patient_id: patientId }, '-created_date', 1)
      ]);
      
      patientData = patient[0] || null;
      // Authorize against the patient before its PHI drives the analyses
      // (assigned nurse or admin). RLS-independent code check.
      if (patientData) {
        const isSuperAdmin = user.account_type === 'super_admin';
        const isAgencyScopedAdmin =
          user.account_type === 'agency_admin'
          || (user.role === 'admin' && !!user.agency_name && !isSuperAdmin);
        const isPlatformAdmin = isSuperAdmin || (user.role === 'admin' && !user.agency_name);
        const isAssigned = patientData.created_by === user.email
          || (Array.isArray(patientData.assigned_nurses) && patientData.assigned_nurses.includes(user.email));
        if (!isPlatformAdmin && !isAgencyScopedAdmin && !isAssigned) {
          return Response.json({ error: 'Forbidden' }, { status: 403 });
        }
        if (isAgencyScopedAdmin) {
          if (!user.agency_name) return Response.json({ error: 'Forbidden' }, { status: 403 });
          const agencyUsers = await base44.asServiceRole.entities.User.list('-created_date', 5000).catch(() => []);
          const agencyEmails = new Set(
            (agencyUsers || [])
              .filter((u) => u.agency_name === user.agency_name && u.email)
              .map((u) => u.email),
          );
          const inAgency = (patientData.created_by && agencyEmails.has(patientData.created_by))
            || (Array.isArray(patientData.assigned_nurses)
              && patientData.assigned_nurses.some((e) => agencyEmails.has(e)));
          if (!inAgency) return Response.json({ error: 'Forbidden' }, { status: 403 });
        }
      }
      recentVisits = visits || [];
      oasisData = oasis[0] || null;
    }

    // Build shared context for all analyses
    const sharedContext = `
PATIENT DATA:
${patientData ? `- Name: ${patientData.first_name} ${patientData.last_name}
- Primary Diagnosis: ${patientData.primary_diagnosis || diagnosis}
- Age: ${formatAge(patientData.date_of_birth)}
- Allergies: ${patientData.allergies || 'None documented'}` : ''}

VISIT DETAILS:
- Visit Type: ${visitType}
- Diagnosis: ${diagnosis}
- Vitals: ${JSON.stringify(vitalSigns)}

RECENT VISITS: ${recentVisits.length > 0 ? `Last visit ${recentVisits[0].visit_date}` : 'None'}
`;

    // Batch all AI analyses in parallel
    const analyses = {};
    const promises = [];

    if (analysisTypes.includes('compliance') && (roughNote || enhancedNote)) {
      promises.push(
        base44.asServiceRole.integrations.Core.InvokeLLM({
          model: "automatic",
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
          model: "automatic",
          prompt: `Point out which OASIS items this clinical note contains evidence for.

NEVER state, suggest or imply an OASIS response, score or code — the clinician
selects every official response themselves. Quote the note verbatim instead, and
say what the note does and does not establish.

${sharedContext}

ENHANCED NOTE:
${enhancedNote}

Return ONLY valid JSON, no prose or code fences, with this shape:
{"mappings":[{"oasis_item":"","evidence_from_note":"","what_is_established":"","what_is_missing":""}],"items_with_evidence":0,"items_needing_more_documentation":0}`
        }).then(result => { analyses.oasis = parseLLMJson(result) || {}; })
      );
    }

    if (analysisTypes.includes('pdgm') && enhancedNote && patientData) {
      promises.push(
        base44.asServiceRole.integrations.Core.InvokeLLM({
          model: "automatic",
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
          model: "automatic",
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
        recent_visits_count: recentVisits.length
      }
    });

  } catch (error) {
    console.error('Batch analysis error:', error);
    return Response.json({ 
      error: 'Internal server error',
      success: false 
    }, { status: 500 });
  }
});