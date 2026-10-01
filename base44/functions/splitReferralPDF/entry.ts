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
// <<<BEGIN SHARED HELPER: isSafeFetchUrl — generated, edit base44/_shared/backendHelpers.mjs>>>
// SSRF guard: only fetch https URLs on the app's own storage/app hosts, never
// internal IPs / metadata. The allowlist is hardcoded (always-on, fail-closed)
// rather than env-configured; add a host here if file storage ever moves.
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
// <<<END SHARED HELPER: isSafeFetchUrl>>>

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
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { fileUrl } = body;

    if (!fileUrl) {
      return Response.json({ error: 'Missing fileUrl' }, { status: 400 });
    }

    if (!isSafeFetchUrl(fileUrl)) {
      return Response.json({ error: 'Invalid or disallowed fileUrl' }, { status: 400 });
    }

    // Use AI to analyze the PDF and detect if it contains multiple referrals
    const analysisResult = await base44.integrations.Core.InvokeLLM({
      model: "automatic",
      prompt: `Analyze this PDF document to determine if it contains multiple separate referral documents/packets.

Please analyze and respond with:
1. Is this a single referral or multiple referrals? 
2. How many distinct referral documents/packets are in this PDF?
3. Estimated page ranges for each referral (if multiple)
4. Key identifiers for each referral (patient names, dates, etc.)

Be thorough - look for:
- Page breaks between documents
- Different letterheads or sources
- Different patient names
- Different referral dates
- Document headers or titles indicating new referrals
- Section breaks or dividers

Return structured data so we can split and process each referral separately.`,
      file_urls: [fileUrl],
      response_json_schema: {
        type: "object",
        properties: {
          is_multiple_referrals: {
            type: "boolean",
            description: "Whether this contains multiple referrals"
          },
          referral_count: {
            type: "number",
            description: "Number of referrals detected"
          },
          referrals: {
            type: "array",
            items: {
              type: "object",
              properties: {
                index: { type: "number", description: "Referral number (1-based)" },
                patient_name: { type: "string", description: "Patient name if available" },
                referral_source: { type: "string", description: "Source/facility" },
                referral_date: { type: "string", description: "Date if available" },
                estimated_start_page: { type: "number", description: "Estimated starting page" },
                estimated_end_page: { type: "number", description: "Estimated ending page" },
                confidence: { type: "number", description: "Confidence score 0-100" },
                key_identifiers: {
                  type: "array",
                  items: { type: "string" },
                  description: "Unique identifiers for this referral"
                }
              }
            },
            description: "List of detected referrals with page info"
          },
          notes: {
            type: "string",
            description: "Any additional notes about document structure"
          }
        }
      }
    });

    return Response.json({
      analysis: analysisResult,
      success: true
    });
  } catch (error) {
    console.error('Error analyzing PDF:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});