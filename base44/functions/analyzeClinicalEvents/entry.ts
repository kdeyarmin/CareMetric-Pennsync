import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


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


/** Explicit patient access — Patient RLS treats role:admin as platform-wide. */
async function assertPatientAccess(base44, user, patient) {
  if (!patient) return Response.json({ error: 'Patient not found' }, { status: 404 });
  const isSuperAdmin = user.account_type === 'super_admin';
  const isAgencyScopedAdmin =
    user.account_type === 'agency_admin'
    || (user.role === 'admin' && !!user.agency_name && !isSuperAdmin);
  const isPlatformAdmin = isSuperAdmin || (user.role === 'admin' && !user.agency_name);
  const isAssigned = Array.isArray(patient.assigned_nurses)
    && patient.assigned_nurses.includes(user.email);
  if (!isPlatformAdmin && !isAgencyScopedAdmin && patient.created_by !== user.email && !isAssigned) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (isAgencyScopedAdmin) {
    if (!user.agency_name) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    const agencyUsers = await base44.asServiceRole.entities.User
      .list('-created_date', 5000).catch(() => []);
    const agencyEmails = new Set(
      (agencyUsers || [])
        .filter((u) => u.agency_name === user.agency_name && u.email)
        .map((u) => u.email),
    );
    const inAgency = (patient.created_by && agencyEmails.has(patient.created_by))
      || (Array.isArray(patient.assigned_nurses)
        && patient.assigned_nurses.some((e) => agencyEmails.has(e)));
    if (!inAgency) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
  }
  return null;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    const { patient_id } = await req.json();

    if (!patient_id) {
      return Response.json({ error: 'Missing patient_id' }, { status: 400 });
    }

    const [patient] = await base44.asServiceRole.entities.Patient
      .filter({ id: patient_id }, '', 1).catch(() => []);
    const denied = await assertPatientAccess(base44, user, patient);
    if (denied) return denied;

    // Fetch all unverified clinical events for the authorized patient
    const events = await base44.asServiceRole.entities.ClinicalEvent.filter({
      patient_id,
      verified: false
    }, '-event_date', 5000);

    if (events.length === 0) {
      return Response.json({
        success: true,
        flagged_events: [],
        message: 'No unverified events to analyze'
      });
    }

    // Analyze events for inconsistencies
    const eventsContext = events.map(e => ({
      id: e.id,
      type: e.event_type,
      title: e.event_title,
      description: e.event_description,
      structured_data: e.structured_data,
      event_date: e.event_date,
      severity: e.severity,
      extraction_confidence: e.extraction_confidence
    }));

    const result = await base44.integrations.Core.InvokeLLM({
      model: "automatic",
      prompt: `Analyze these clinical events for a patient and identify potential issues:

Patient Context:
- Name: ${patient?.first_name} ${patient?.last_name}
- Primary Diagnosis: ${patient?.primary_diagnosis}
- Current Medications: ${patient?.current_medications?.map(m => m.name).join(', ') || 'None listed'}

Clinical Events to Review:
${JSON.stringify(eventsContext, null, 2)}

For each event, identify:
1. Missing critical information (e.g., medication without dosage, wound without location/stage)
2. Potential inconsistencies (e.g., conflicting information, unlikely values)
3. Events that need clarification or more detail
4. Events that might be duplicates or related to other events
5. Safety concerns or red flags

Only flag events that have actual issues. If an event looks complete and accurate, don't flag it.

For each flagged event, provide:
- The event ID
- Issue category (missing_info, inconsistency, needs_clarification, safety_concern, potential_duplicate)
- Specific issue description
- Suggested action or questions to ask the clinician
- Priority (high, medium, low)

Return ONLY valid JSON, no prose or code fences, with this shape:
{"flagged_events":[{"event_id":"","issue_category":"missing_info|inconsistency|needs_clarification|safety_concern|potential_duplicate","issue_description":"","suggested_action":"","priority":"high|medium|low","questions_for_clinician":[""]}],"overall_summary":""}`
    });
    const parsed = parseLLMJson(result) || {};

    return Response.json({
      success: true,
      flagged_events: parsed?.flagged_events || [],
      overall_summary: parsed?.overall_summary || '',
      total_events_analyzed: events.length
    });

  } catch (error) {
    console.error('Error analyzing clinical events:', error);
    return Response.json({
      error: 'Internal server error'
    }, { status: 500 });
  }
});