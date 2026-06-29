import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: isSafeFetchUrl — generated, edit base44/_shared/backendHelpers.mjs>>>
// SSRF guard: only fetch https URLs on public hosts, never internal IPs /
// metadata. Set FILE_URL_ALLOWED_HOSTS (comma-separated) to restrict to your
// storage host(s).
function isSafeFetchUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (['localhost', '0.0.0.0', '127.0.0.1', '::1', '169.254.169.254'].includes(host)) return false;
  if (host.endsWith('.internal') || host.endsWith('.local')) return false;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
  }
  const allow = Deno.env.get('FILE_URL_ALLOWED_HOSTS');
  if (allow) {
    const hosts = allow.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
    if (!hosts.some((h) => host === h || host.endsWith('.' + h))) return false;
  }
  return true;
}
// <<<END SHARED HELPER: isSafeFetchUrl>>>

const PATIENT_SCHEMA = {
  type: "object",
  properties: {
    first_name: { type: "string", description: "Patient's first name" },
    middle_name: { type: "string", description: "Patient's middle name or initial" },
    last_name: { type: "string", description: "Patient's last name" },
    date_of_birth: { type: "string", description: "Date of birth in YYYY-MM-DD format" },
    phone: { type: "string", description: "Phone number" },
    email: { type: "string", description: "Email address" },
    address: { type: "string", description: "Full address" },
    medical_record_number: { type: "string", description: "Medical record number (MRN)" },
    primary_diagnosis: { type: "string", description: "Primary diagnosis or chief complaint" },
    allergies: { type: "string", description: "Known allergies" },
    emergency_contact_name: { type: "string", description: "Emergency contact name" },
    emergency_contact_phone: { type: "string", description: "Emergency contact phone" },
    emergency_contact_relationship: { type: "string", description: "Relationship to patient" },
    physician_name: { type: "string", description: "Primary care physician name" },
    physician_phone: { type: "string", description: "Physician phone" },
    payor: { type: "string", description: "Primary insurance/payor type" },
    insurance_primary: {
      type: "object",
      properties: {
        provider: { type: "string", description: "Insurance provider name" },
        policy_number: { type: "string", description: "Policy number" },
        group_number: { type: "string", description: "Group number" }
      }
    },
    secondary_diagnoses: {
      type: "array",
      items: { type: "string" },
      description: "Secondary diagnoses"
    },
    past_medical_history: {
      type: "array",
      items: { type: "string" },
      description: "Past medical conditions"
    }
  }
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { file_url } = await req.json();

    if (!file_url) {
      return Response.json({
        status: 'error',
        details: 'file_url is required'
      }, { status: 400 });
    }

    if (!isSafeFetchUrl(file_url)) {
      return Response.json({ status: 'error', details: 'Invalid or disallowed file_url' }, { status: 400 });
    }

    // Use AI to extract structured patient data from the document
    const extractionResult = await base44.integrations.Core.ExtractDataFromUploadedFile({
      file_url: file_url,
      json_schema: PATIENT_SCHEMA
    });

    if (extractionResult.status === 'success') {
      return Response.json({
        status: 'success',
        patient_data: extractionResult.output || {},
        message: 'Patient data extracted successfully'
      });
    } else {
      return Response.json({
        status: 'error',
        details: extractionResult.details || 'Failed to extract patient data from document',
        patient_data: null
      });
    }

  } catch (error) {
    return Response.json({ 
      status: 'error',
      details: error.message 
    }, { status: 500 });
  }
});