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
    
    // Verify admin access
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user || !isAdminLike(user)) {
      return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
    }

    // Fetch latest CMS regulations from internet with AI analysis
    const regulationsUpdate = await base44.integrations.Core.InvokeLLM({
      model: "gemini_3_1_pro",
      prompt: `You are a Medicare home health compliance expert. Search the internet for the LATEST CMS regulations and updates for home health agencies as of December 2025.

Focus on:
1. Recent CMS policy changes (2024-2025)
2. OASIS-E documentation requirements
3. Medicare Conditions of Participation updates
4. PDGM clinical grouping changes
5. Documentation and billing requirements
6. Telehealth and remote patient monitoring guidelines
7. Quality reporting requirements (HH CAHPS, HHCAHPS, OASIS)

For EACH regulation found, provide:
- Regulation title and CMS reference number
- Effective date
- Summary of key changes
- Impact on home health agencies (critical/high/medium/low)
- Required actions for compliance
- Documentation requirements
- Link to official CMS source (if available)

Search multiple sources including CMS.gov, Medicare Learning Network, and recent Federal Register updates.

Return comprehensive, actionable compliance information.`,
      add_context_from_internet: true,
      response_json_schema: {
        type: "object",
        properties: {
          sync_date: { type: "string" },
          regulations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                cms_reference: { type: "string" },
                effective_date: { type: "string" },
                category: { type: "string" },
                summary: { type: "string" },
                impact_level: { type: "string" },
                required_actions: {
                  type: "array",
                  items: { type: "string" }
                },
                documentation_requirements: {
                  type: "array",
                  items: { type: "string" }
                },
                source_url: { type: "string" },
                compliance_deadline: { type: "string" }
              }
            }
          },
          recent_updates: {
            type: "array",
            items: {
              type: "object",
              properties: {
                date: { type: "string" },
                title: { type: "string" },
                description: { type: "string" },
                urgency: { type: "string" }
              }
            }
          },
          key_changes_summary: { type: "string" }
        }
      }
    });

    // Store regulations in database
    const regulationRecords = [];
    for (const reg of regulationsUpdate.regulations || []) {
      try {
        const record = await base44.asServiceRole.entities.RegulatoryUpdate.create({
          title: reg.title,
          source: reg.cms_reference?.includes('Medicare') ? 'Medicare' : 'CMS',
          category: reg.category || 'documentation',
          effective_date: reg.effective_date || new Date().toISOString().split('T')[0],
          summary: reg.summary,
          full_details: `${reg.summary}\n\nRequired Actions:\n${reg.required_actions?.join('\n- ') || 'None specified'}\n\nDocumentation Requirements:\n${reg.documentation_requirements?.join('\n- ') || 'None specified'}`,
          impact_level: reg.impact_level || 'medium',
          affected_areas: [reg.category],
          required_actions: reg.required_actions || [],
          status: 'pending_review',
          reference_url: reg.source_url || null,
          reviewed_by: null,
          reviewed_at: null
        });
        regulationRecords.push(record);
      } catch (error) {
        console.error('Error creating regulation record:', error);
      }
    }

    // Log the sync activity
    await base44.asServiceRole.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'cms_regulations_sync',
      details: {
        regulations_found: regulationsUpdate.regulations?.length || 0,
        regulations_stored: regulationRecords.length,
        sync_timestamp: new Date().toISOString(),
        recent_updates: regulationsUpdate.recent_updates?.length || 0
      },
      page: 'Admin'
    });

    return Response.json({
      success: true,
      sync_date: regulationsUpdate.sync_date || new Date().toISOString(),
      regulations_count: regulationRecords.length,
      recent_updates: regulationsUpdate.recent_updates || [],
      key_changes_summary: regulationsUpdate.key_changes_summary || 'No major changes detected',
      regulations: regulationRecords
    });

  } catch (error) {
    console.error('CMS regulations sync error:', error);
    return Response.json({
      success: false,
      error: 'Failed to sync CMS regulations'
    }, { status: 500 });
  }
});