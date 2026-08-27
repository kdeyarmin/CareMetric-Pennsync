import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// <<<BEGIN SHARED HELPER: resolveAgencySettings — generated, edit base44/_shared/backendHelpers.mjs>>>
async function resolveAgencySettings(base44, agencyName) {
  let settings = [];
  const key = String(agencyName || '').trim();
  if (key) {
    settings = await base44.asServiceRole.entities.AgencySettings
      .filter({ agency_code: key }, '-created_date', 1)
      .catch(() => []);
    if (!settings?.length) {
      settings = await base44.asServiceRole.entities.AgencySettings
        .filter({ office_name: key }, '-created_date', 1)
        .catch(() => []);
    }
  }
  if (!settings?.length) {
    // Fail closed when the agency hint missed (or no hint but multiple tenant
    // rows exist). Newest-row-wins would silently apply another agency's fax
    // line / dial allowlist / wage index / quiet-hour timezone.
    if (key) return null;
    const newest = await base44.asServiceRole.entities.AgencySettings
      .list('-created_date', 5)
      .catch(() => []);
    if ((newest || []).length > 1) return null;
    settings = (newest || []).slice(0, 1);
  }
  return settings?.[0] || null;
}
// <<<END SHARED HELPER: resolveAgencySettings>>>

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
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    const {
      patient_id,
      document_id,
      recipient_number,
      recipient_name,
      recipient_organization,
      sender_name,
      sender_number,
      subject,
      notes,
      urgency = 'routine',
      page_count = 1
    } = await req.json();

    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicKey) return Response.json({ error: 'Anthropic API key not configured' }, { status: 500 });

    // Fetch patient + document in parallel.
    // Reads are scoped to the authenticated user (RLS, NOT asServiceRole) so the
    // caller cannot embed another patient's PHI into a cover sheet via a guessed id.
    // Agency-scoped admins still need assertPatientAccess: bare role:admin RLS
    // is platform-wide (HOSTED-RLS-PROOF §5b).
    const [patientResults, documentResults] = await Promise.all([
      patient_id ? base44.entities.Patient.filter({ id: patient_id }, undefined, 5000) : Promise.resolve([]),
      document_id ? base44.entities.Document.filter({ id: document_id }, undefined, 5000) : Promise.resolve([])
    ]);

    const patient = patientResults[0] || null;
    const document = documentResults[0] || null;
    if (patient_id) {
      const denied = await assertPatientAccess(base44, user, patient);
      if (denied) return denied;
    }

    // Default the sender fax to the OFFICE fax machine (AgencySettings) so the
    // cover sheet tells recipients to reply to the office — never the blind
    // outbound line the fax actually transmits from.
    let senderFax = (sender_number || '').toString().trim();
    if (!senderFax) {
      const agencySettings = await resolveAgencySettings(base44, user?.agency_name);
      senderFax = (agencySettings?.office_fax_number_e164 || '').toString().trim();
    }

    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    const prompt = `You are a medical administrative assistant. Generate a HIPAA-compliant professional fax cover sheet as a clean JSON object.

Sender: ${sender_name || user.full_name}
Sender Fax: ${senderFax || 'See letterhead'}
Recipient Name: ${recipient_name || 'To Whom It May Concern'}
Recipient Organization: ${recipient_organization || ''}
Recipient Fax: ${recipient_number || ''}
Date: ${dateStr} at ${timeStr}
Subject: ${subject || (patient ? `RE: Patient ${patient.first_name} ${patient.last_name}` : 'Medical Communication')}
Urgency: ${urgency}
Total Pages (including cover): ${(Number(page_count) || 0) + 1}
Additional Notes: ${notes || ''}

Patient Info (if provided):
  Name: ${patient ? `${patient.first_name} ${patient.last_name}` : 'N/A'}
  DOB: ${patient?.date_of_birth || 'N/A'}
  MRN: ${patient?.medical_record_number || 'N/A'}
  Primary Diagnosis: ${patient?.primary_diagnosis || 'N/A'}

Document: ${document?.title || 'See attached'}
Document Category: ${document?.category || ''}

Generate a professional cover sheet with a HIPAA confidentiality disclaimer. Return only JSON.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        // Real Anthropic model id. 'automatic' is a Base44 InvokeLLM
        // convention that 404s on the direct Messages API, so this call always
        // failed and the cover-sheet fields silently came back empty.
        // claude-opus-4-8 runs without thinking when the field is omitted, so
        // the whole max_tokens budget goes to the JSON answer.
        model: 'claude-opus-4-8',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: prompt + `\n\nReturn JSON with exactly these fields:
{
  "from_name": string,
  "from_fax": string,
  "to_name": string,
  "to_organization": string,
  "to_fax": string,
  "date": string,
  "time": string,
  "subject": string,
  "urgency": "routine" | "urgent" | "stat",
  "total_pages": number,
  "patient_name": string,
  "patient_dob": string,
  "patient_mrn": string,
  "patient_diagnosis": string,
  "document_title": string,
  "notes": string,
  "confidentiality_notice": string
}`
        }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Claude API error:', err);
      return Response.json({ error: 'AI generation failed' }, { status: 500 });
    }

    const claudeData = await response.json();
    const content = claudeData.content[0]?.text || '{}';

    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    let coverData = {};
    if (jsonMatch) {
      try {
        coverData = JSON.parse(jsonMatch[0]);
      } catch (e) {
        console.error('Failed to parse cover page JSON from AI response:', e);
      }
    }

    return Response.json({ success: true, cover_page_data: coverData });

  } catch (error) {
    console.error('Cover page generation error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});