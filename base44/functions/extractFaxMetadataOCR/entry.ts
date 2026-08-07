import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


// SSRF guard: only fetch https URLs on the app's own storage/app hosts, never
// internal IPs / metadata. Mirrors analyzeDocument — any function that hands a
// user-supplied URL to a provider integration must gate it.
const FILE_URL_ALLOWED_HOSTS = ['qtrypzzcjebvfcihiynt.supabase.co', 'base44.app', 'base44.io'];
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
  if (!FILE_URL_ALLOWED_HOSTS.some((h) => host === h || host.endsWith('.' + h))) return false;
  return true;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { file_url } = await req.json();

    if (!file_url) {
      return Response.json({ error: 'Missing file_url' }, { status: 400 });
    }

    if (!isSafeFetchUrl(file_url)) {
      return Response.json({ error: 'file_url is not an allowed file URL' }, { status: 400 });
    }

    // Use InvokeLLM with vision to extract patient metadata from the document
    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      model: "automatic",
      prompt: `You are a medical document OCR assistant. Analyze this medical document image/PDF and extract patient identifying information.

Extract the following fields if present:
- patient_name: Full name of the patient (first and last)
- date_of_birth: Date of birth in MM/DD/YYYY format
- mrn: Medical Record Number or Patient ID
- physician_name: Name of the ordering/referring physician
- date_of_service: Date of service or document date (MM/DD/YYYY)
- diagnosis: Primary diagnosis or reason for referral
- phone: Patient phone number
- address: Patient address

Return ONLY what you can clearly read. For any field you cannot find or read clearly, return null.
Do not guess or infer values not explicitly visible in the document.`,
      file_urls: [file_url],
      response_json_schema: {
        type: "object",
        properties: {
          patient_name: { type: ["string", "null"] },
          date_of_birth: { type: ["string", "null"] },
          mrn: { type: ["string", "null"] },
          physician_name: { type: ["string", "null"] },
          date_of_service: { type: ["string", "null"] },
          diagnosis: { type: ["string", "null"] },
          phone: { type: ["string", "null"] },
          address: { type: ["string", "null"] }
        }
      }
    });

    // Filter out null values
    const extracted = {};
    for (const [key, value] of Object.entries(result)) {
      if (value !== null && value !== undefined && value !== '') {
        extracted[key] = value;
      }
    }

    return Response.json({ success: true, extracted });

  } catch (error) {
    console.error('extractFaxMetadataOCR failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});