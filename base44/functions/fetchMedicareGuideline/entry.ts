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
// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// <<<BEGIN SHARED HELPER: isAdminLike — generated, edit base44/_shared/backendHelpers.mjs>>>
const isAdminLike = (u) => !!u && u.role === 'admin';
// <<<END SHARED HELPER: isAdminLike>>>



Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    
    // Verify admin access (an unauthenticated session must get a 401, not a
    // 500 from an uncaught auth.me() rejection)
    const user = await base44.auth.me().catch(() => null);
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user || !isAdminLike(user)) {
      return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
    }

    const { url, category, subcategory, keywords, cms_manual_chapter, regulatory_citation } = await req.json();

    if (!url) {
      return Response.json({ error: 'URL is required' }, { status: 400 });
    }

    // Validate the URL: must be a public https guideline page. Rejecting
    // non-https / internal hosts stops a typo or crafted value from having the
    // proxy fetch an internal/metadata address and storing its content as a
    // "Medicare guideline".
    let parsedUrl;
    try { parsedUrl = new URL(String(url)); } catch { parsedUrl = null; }
    const host = parsedUrl?.hostname?.toLowerCase() || '';
    const isInternalHost = ['localhost', '0.0.0.0', '127.0.0.1', '::1', '169.254.169.254'].includes(host)
      || host.endsWith('.internal') || host.endsWith('.local')
      || /^(10|127)\./.test(host) || /^169\.254\./.test(host) || /^192\.168\./.test(host)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
    if (!parsedUrl || parsedUrl.protocol !== 'https:' || isInternalHost) {
      return Response.json({ error: 'A public https URL is required' }, { status: 400 });
    }

    // Fetch the webpage content
    const fetchResult = await fetch('https://api.base44.com/v1/fetch-website', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': req.headers.get('Authorization')
      },
      body: JSON.stringify({
        url: url,
        formats: ['markdown']
      })
    });

    if (!fetchResult.ok) {
      // Client-supplied URL that couldn't be fetched is an upstream/gateway
      // condition, not a server fault — return 502 so monitoring isn't polluted.
      return Response.json({ error: 'Failed to fetch content from URL' }, { status: 502 });
    }

    const websiteData = await fetchResult.json();
    const markdownContent = websiteData.markdown || '';

    if (!markdownContent) {
      return Response.json({ error: 'No content extracted from URL' }, { status: 400 });
    }

    // Use AI to extract title, summary, and enhance keywords
    const analysisPrompt = `Analyze this Medicare guideline content and extract structured information.

CONTENT:
${markdownContent.substring(0, 5000)}

Extract and return JSON with:
{
  "title": "Clear, concise title of the guideline",
  "summary": "2-3 sentence summary of key requirements and what nurses need to know",
  "extracted_keywords": ["keyword1", "keyword2", ...] (include medical terms, regulatory concepts, related conditions),
  "related_diagnoses": ["diagnosis1", "diagnosis2", ...] (medical conditions this applies to),
  "applies_to_visit_types": ["visit_type1", ...] (e.g., admission, routine_visit, discharge, recertification),
  "effective_date": "YYYY-MM-DD or null if not found",
  "regulatory_citation": "Official citation if found in content (e.g., 42 CFR 484.55)"
}`;

    const analysis = await base44.asServiceRole.integrations.Core.InvokeLLM({
      model: "automatic",
      prompt: analysisPrompt,
      response_json_schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          extracted_keywords: { type: "array", items: { type: "string" } },
          related_diagnoses: { type: "array", items: { type: "string" } },
          applies_to_visit_types: { type: "array", items: { type: "string" } },
          effective_date: { type: ["string", "null"] },
          regulatory_citation: { type: ["string", "null"] }
        }
      }
    });

    // Combine user-provided keywords with AI-extracted ones
    const allKeywords = [
      ...(keywords || []),
      ...(analysis.extracted_keywords || [])
    ].filter((k, i, arr) => arr.indexOf(k) === i); // Remove duplicates

    // Check if guideline with this URL already exists
    const existing = await base44.asServiceRole.entities.MedicareGuideline.filter({ url: url }, undefined, 5000);
    
    const guidelineData = {
      title: analysis.title,
      url: url,
      content_markdown: markdownContent,
      summary: analysis.summary,
      category: category || 'other',
      subcategory: subcategory || null,
      effective_date: analysis.effective_date || null,
      last_fetched_date: new Date().toISOString(),
      keywords: allKeywords,
      related_diagnoses: analysis.related_diagnoses || [],
      applies_to_visit_types: analysis.applies_to_visit_types || [],
      is_active: true,
      cms_manual_chapter: cms_manual_chapter || null,
      regulatory_citation: regulatory_citation || analysis.regulatory_citation || null
    };

    let guideline;
    if (existing && existing.length > 0) {
      // Update existing guideline
      guideline = await base44.asServiceRole.entities.MedicareGuideline.update(
        existing[0].id,
        guidelineData
      );
    } else {
      // Create new guideline
      guideline = await base44.asServiceRole.entities.MedicareGuideline.create(guidelineData);
    }

    return Response.json({
      success: true,
      guideline: guideline,
      message: existing && existing.length > 0 ? 'Guideline updated successfully' : 'Guideline created successfully'
    });

  } catch (error) {
    console.error('Error fetching Medicare guideline:', error);
    return Response.json({ 
      error: 'Internal server error',
      details: 'Failed to fetch and process Medicare guideline'
    }, { status: 500 });
  }
});