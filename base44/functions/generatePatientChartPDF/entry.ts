import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: pennsyncProductionAppId — generated, edit base44/_shared/backendHelpers.mjs>>>
const PENNSYNC_PRODUCTION_APP_ID = '694ec16e72e01b60d22f7cbf';
// <<<END SHARED HELPER: pennsyncProductionAppId>>>
// <<<BEGIN SHARED HELPER: base44ClientRequest — generated, edit base44/_shared/backendHelpers.mjs>>>
function pinnedBase44Request(req, expectedAppId, forwardUserCredential) {
  if (typeof expectedAppId !== 'string' || expectedAppId === '') {
    throw new Error('pinned Base44 request requires an expected Base44-App-Id');
  }
  // Read the inbound headers without ever throwing on the SHAPE of req. A production
  // request is always a real Request with a Headers bag; a bare object with no usable
  // headers (a test fixture, a malformed direct call) carries no inbound header, which
  // is the absent case handled below. Only a PRESENT, different app id throws, and that
  // requires a real header an attacker would have to set — so a real Request always
  // reaches this read and the refusal is never skipped by the tolerance.
  const inbound =
    req && req.headers && typeof req.headers.get === 'function' ? req.headers : null;
  const read = (name) => (inbound ? inbound.get(name) : null);
  const received = read('Base44-App-Id');
  // Refuse only an ACTIVE mismatch: a caller presenting a DIFFERENT app id is the
  // tenant-redirect attack, and that is the case the refusal exists for. An ABSENT
  // header is not a mismatch and selects no other tenant — it only means the request
  // did not arrive through the platform, which always injects this header. We SET the
  // pinned constant below either way, so absent falls back to the correct app exactly
  // as the dropped Base44-Api-Url falls back to the default serverUrl. Throwing on
  // absent would turn every anonymous denial into a 500 instead of a clean 403.
  if (received !== null && received !== expectedAppId) {
    throw new Error(
      'Base44-App-Id mismatch: expected ' + expectedAppId + ', received ' + received
    );
  }
  const headers = new Headers();
  // Load-bearing: SET the constant (never forward the inbound value). The SDK reads
  // appId from this header and throws of its own accord when it is absent, so pinning
  // requires setting it here — dropping the inbound header alone would not suffice.
  headers.set('Base44-App-Id', expectedAppId);
  const serviceAuth = read('Base44-Service-Authorization');
  if (serviceAuth !== null) headers.set('Base44-Service-Authorization', serviceAuth);
  if (forwardUserCredential) {
    const authorization = read('Authorization');
    if (authorization !== null) headers.set('Authorization', authorization);
    const dataEnv = read('X-Data-Env');
    if (dataEnv === 'dev' || dataEnv === 'prod') headers.set('X-Data-Env', dataEnv);
  }
  // Cosmetic URL: serverUrl comes from the dropped Base44-Api-Url, not from here.
  // No method: the SDK request factory reads only headers.get(...), never the
  // method, so the request defaults to GET. An explicit POST would be inert for the
  // SDK and would read as an outbound delivery primitive to the inventory scanner
  // once this block is inlined into the fax status pollers.
  return new Request('https://base44.app', { headers });
}
function userScopedClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, true);
}
function serviceRoleClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, false);
}
// <<<END SHARED HELPER: base44ClientRequest>>>
// <<<BEGIN SHARED HELPER: protectedUserAuthz — generated, edit base44/_shared/backendHelpers.mjs>>>
const normalizeProtectedEmail = (value) => String(value || '').trim().toLowerCase();
const isProtectedAdmin = (user) => !!user && user.role === 'admin';
function isProtectedSuperAdmin(user) {
  const configuredEmail = normalizeProtectedEmail(Deno.env.get('SUPER_ADMIN_EMAIL'));
  return !!configuredEmail
    && isProtectedAdmin(user)
    && normalizeProtectedEmail(user.email) === configuredEmail;
}
// <<<END SHARED HELPER: protectedUserAuthz>>>

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    const callerEmail = normalizeProtectedEmail(user.email);
    if (!callerEmail) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const { patientId } = body;
    const includeVisits = body.includeVisits === undefined ? true : body.includeVisits;
    const includeIncidents = body.includeIncidents === undefined ? true : body.includeIncidents;

    if (!patientId) {
      return Response.json({ error: 'Missing patientId' }, { status: 400 });
    }
    if (typeof patientId !== 'string' || !patientId.trim() || patientId.trim().length > 200) {
      return Response.json({ error: 'Invalid patientId' }, { status: 400 });
    }
    const scopedPatientId = patientId.trim();
    // These values flow into a privileged audit record. Accept booleans only so
    // caller-controlled objects/strings cannot inject arbitrary data or PHI into
    // SecurityLog after its write moves to the service role.
    if (typeof includeVisits !== 'boolean' || typeof includeIncidents !== 'boolean') {
      return Response.json({ error: 'includeVisits and includeIncidents must be boolean' }, { status: 400 });
    }

    // Service-role read + explicit access gate. Only direct ownership, an
    // explicit nurse assignment, or the configured protected platform owner
    // may authorize a chart export. account_type and agency_name are mutable
    // User fields and therefore cannot grant cross-patient access.
    const [patient] = await base44.asServiceRole.entities.Patient
      .filter({ id: scopedPatientId }, '', 1).catch(() => []);
    // Re-check the row identity in memory in case a backend filter is ignored or
    // regresses; related service-role reads must never inherit a mismatched id.
    if (!patient || String(patient.id || '').trim() !== scopedPatientId) {
      return Response.json({ error: 'Patient not found' }, { status: 404 });
    }
    const isOwner = normalizeProtectedEmail(patient.created_by) === callerEmail;
    const isAssigned = Array.isArray(patient.assigned_nurses)
      && patient.assigned_nurses.some(
        (email) => normalizeProtectedEmail(email) === callerEmail,
      );
    if (!isOwner && !isAssigned && !isProtectedSuperAdmin(user)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Fetch related data in parallel (same patient_id already authorized).
    const [visitRows, incidentRows] = await Promise.all([
      includeVisits ? base44.asServiceRole.entities.Visit.filter({ patient_id: scopedPatientId }, '-visit_date', 100) : [],
      includeIncidents ? base44.asServiceRole.entities.Incident.filter({ patient_id: scopedPatientId }, '-incident_date', 100) : []
    ]);
    // Service-role reads require a second boundary check: never let an ignored
    // backend filter mix another patient's clinical events into this chart.
    const visits = (Array.isArray(visitRows) ? visitRows : [])
      .filter((visit) => String(visit?.patient_id || '').trim() === scopedPatientId);
    const incidents = (Array.isArray(incidentRows) ? incidentRows : [])
      .filter((incident) => String(incident?.patient_id || '').trim() === scopedPatientId);

    const secondaryDiagnoses = patient.secondary_diagnoses?.join(', ') || 'None';
    const pastMedicalHistory = patient.past_medical_history?.join('; ') || 'None';

    // Use AI to generate professional formatted document
    const prompt = `Generate a professional, HIPAA-compliant patient medical chart with the following information:

PATIENT DEMOGRAPHICS:
Name: ${patient.first_name} ${patient.middle_name || ''} ${patient.last_name}
DOB: ${patient.date_of_birth}
MRN: ${patient.medical_record_number || 'N/A'}
Address: ${patient.address || 'N/A'}
Phone: ${patient.phone || 'N/A'}
Email: ${patient.email || 'N/A'}

PRIMARY CARE PHYSICIAN:
Name: ${patient.physician_name || 'N/A'}
Phone: ${patient.physician_phone || 'N/A'}
Email: ${patient.physician_email || 'N/A'}

EMERGENCY CONTACT:
Name: ${patient.emergency_contact_name || 'N/A'}
Phone: ${patient.emergency_contact_phone || 'N/A'}
Relationship: ${patient.emergency_contact_relationship || 'N/A'}

CLINICAL INFORMATION:
Primary Diagnosis: ${patient.primary_diagnosis || 'N/A'}
Secondary Diagnoses: ${secondaryDiagnoses}
Allergies: ${patient.allergies || 'No known allergies'}
Past Medical History: ${pastMedicalHistory}

BASELINE VITALS:
BP: ${patient.baseline_vitals?.blood_pressure_systolic || 'N/A'}/${patient.baseline_vitals?.blood_pressure_diastolic || 'N/A'}
HR: ${patient.baseline_vitals?.heart_rate || 'N/A'} bpm
RR: ${patient.baseline_vitals?.respiratory_rate || 'N/A'} rpm
Temp: ${patient.baseline_vitals?.temperature || 'N/A'}F
O2 Sat: ${patient.baseline_vitals?.oxygen_saturation || 'N/A'}%
Weight: ${patient.baseline_vitals?.weight || 'N/A'} lbs
Height: ${patient.baseline_vitals?.height || 'N/A'} inches
BMI: ${patient.baseline_vitals?.bmi || 'N/A'}

FUNCTIONAL STATUS:
Ambulation: ${patient.functional_status?.ambulation || 'N/A'}
ADL Independence: ${patient.functional_status?.adl_independence || 'N/A'}
Cognitive Status: ${patient.functional_status?.cognitive_status || 'N/A'}
Fall Risk: ${patient.functional_status?.fall_risk || 'N/A'}

SOCIAL HISTORY:
Living Situation: ${patient.social_history?.living_situation || 'N/A'}
Primary Language: ${patient.social_history?.primary_language || 'English'}
Support System: ${patient.social_history?.support_system || 'N/A'}
Smoking Status: ${patient.social_history?.smoking_status || 'N/A'}

ADVANCE DIRECTIVES:
Has Living Will: ${patient.advance_directives?.has_living_will ? 'Yes' : 'No'}
Has Healthcare Proxy: ${patient.advance_directives?.has_healthcare_proxy ? 'Yes' : 'No'}
DNR Status: ${patient.advance_directives?.dnr_status ? 'Yes' : 'No'}

RECENT VISITS (${visits?.length || 0}):
${visits?.slice(0, 10).map((v, i) => `${i + 1}. ${v.visit_date}: ${v.visit_type}`).join('\n')}

CLINICAL INCIDENTS (${incidents?.length || 0}):
${incidents?.slice(0, 10).map((inc, i) => `${i + 1}. ${inc.incident_date}: ${inc.incident_type} (${inc.severity})`).join('\n')}

Create professional medical chart content with:
1. Clear section headers and organization
2. HIPAA-compliant formatting
3. Medical-standard presentation
4. Easy-to-read lists and tables
5. Professional medical terminology`;

    const result = await base44.integrations.Core.InvokeLLM({
      model: "automatic",
      prompt,
      response_json_schema: {
        type: "object",
        properties: {
          document_content: {
            type: "string",
            description: "Full formatted content for the document"
          },
          page_count: {
            type: "number",
            description: "Estimated page count"
          }
        }
      }
    });

    const documentContent = typeof result?.document_content === 'string'
      ? result.document_content
      : (typeof result === 'string' ? result : '');
    if (!documentContent.trim()) {
      return Response.json({ error: 'Chart generation returned empty content' }, { status: 502 });
    }
    const pageCount = Number.isFinite(Number(result?.page_count)) ? Number(result.page_count) : undefined;
    // Log the export action for compliance
    await base44.asServiceRole.entities.SecurityLog.create({
      user_email: user.email,
      user_role: user.role,
      action: 'export_patient_chart_pdf',
      details: {
        patient_id: scopedPatientId,
        includes_visits: includeVisits,
        includes_incidents: includeIncidents,
        exported_at: new Date().toISOString()
      },
      timestamp: new Date().toISOString(),
      ip_address: 'server-side'
    });

    return Response.json({
      success: true,
      document: documentContent,
      patient_name: `${patient.first_name} ${patient.last_name}`,
      mrn: patient.medical_record_number,
      export_date: new Date().toISOString(),
      exported_by: user.full_name,
      pages: pageCount
    });

  } catch (error) {
    console.error('Error generating patient chart PDF:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
