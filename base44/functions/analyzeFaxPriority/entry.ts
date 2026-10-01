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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));

    // Require authentication: previously unauthenticated, so anonymous callers
    // could run billable service-role LLM calls and bump FaxPriorityRule counts.
    // Mirrors analyzeFaxContent. Internal callers (sendBatchFax) propagate identity.
    const user = await base44.auth.me().catch(() => null);
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    // Never pass an absent owner into a service-role filter: some backends omit
    // undefined fields, which would silently widen this to every tenant's rules.
    const callerEmail = String(user.email || '').trim().toLowerCase();
    if (!callerEmail) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const {
      document_name,
      cover_page_details, 
      to_number, 
      from_number,
      to_name,
      from_name 
    } = await req.json();

    if (!document_name && !cover_page_details) {
      return Response.json({ 
        priority: 'normal',
        reason: 'No content to analyze'
      });
    }

    // Fetch active priority rules
    const ruleRows = await base44.asServiceRole.entities.FaxPriorityRule.filter(
      { is_active: true, user_email: callerEmail },
      '-created_date',
      100
    );
    // Defend against an ignored/regressed backend filter before a foreign rule
    // can influence the result or have its match_count updated.
    const rules = (Array.isArray(ruleRows) ? ruleRows : []).filter((rule) =>
      rule?.is_active === true
      && String(rule?.user_email || '').trim().toLowerCase() === callerEmail
    );

    // Build analysis text
    let analysisText = `Document: ${document_name || 'Untitled'}\n`;
    if (cover_page_details) {
      analysisText += `Subject: ${cover_page_details.subject || ''}\n`;
      analysisText += `Message: ${cover_page_details.message || ''}\n`;
    }
    analysisText += `To: ${to_name || to_number}\n`;
    analysisText += `From: ${from_name || from_number}\n`;

    // Check user-defined rules first
    let matchedRule = null;
    let ruleScore = 0;

    for (const rule of rules) {
      let matches = false;
      
      if (rule.rule_type === 'keyword' && rule.pattern) {
        const text = analysisText.toLowerCase();
        matches = text.includes(rule.pattern.toLowerCase());
      }

      if (rule.rule_type === 'sender' && rule.pattern) {
        matches = from_number?.includes(rule.pattern) ||
          from_name?.toLowerCase().includes(rule.pattern.toLowerCase());
      }

      if (rule.rule_type === 'recipient' && rule.pattern) {
        matches = to_number?.includes(rule.pattern) ||
          to_name?.toLowerCase().includes(rule.pattern.toLowerCase());
      }

      if (matches) {
        const priorityScores = { urgent: 4, high: 3, normal: 2, low: 1 };
        const score = priorityScores[rule.priority] || 2;
        
        if (score > ruleScore) {
          ruleScore = score;
          matchedRule = rule;
        }
      }
    }

    // If rule matched, use it
    if (matchedRule) {
      // Update match count
      await base44.asServiceRole.entities.FaxPriorityRule.update(matchedRule.id, {
        match_count: (matchedRule.match_count || 0) + 1
      });

      return Response.json({
        priority: matchedRule.priority,
        reason: `Matched rule: ${matchedRule.name}`,
        rule_id: matchedRule.id,
        notify: matchedRule.notify || false,
        notify_users: []
      });
    }

    // Use AI analysis as fallback
    const aiPrompt = `Analyze this fax and determine its priority level (urgent, high, normal, or low).

Fax Details:
${analysisText}

Consider:
- Medical emergencies or critical health information = urgent
- Test results, prescriptions, patient records = high
- Routine correspondence, administrative = normal
- Non-urgent notices = low

Urgent keywords: STAT, emergency, critical, urgent, immediate, code
High keywords: results, prescription, medication, admission, discharge
Normal keywords: appointment, schedule, reminder, follow-up
Low keywords: notice, information, update, newsletter

Respond with JSON: {"priority": "urgent|high|normal|low", "reason": "brief explanation", "confidence": 0-100}`;

    const aiResponse = await base44.asServiceRole.integrations.Core.InvokeLLM({
      model: "automatic",
      prompt: aiPrompt,
      response_json_schema: {
        type: "object",
        properties: {
          priority: { type: "string" },
          reason: { type: "string" },
          confidence: { type: "number" }
        }
      }
    });

    return Response.json({
      priority: aiResponse?.priority || 'normal',
      reason: aiResponse?.reason || 'AI analysis',
      confidence: aiResponse?.confidence || 50,
      notify: aiResponse?.priority === 'urgent',
      notify_users: []
    });

  } catch (error) {
    console.error('Priority analysis error:', error);
    // Generic reason only — the raw exception text stays server-side.
    return Response.json({
      priority: 'normal',
      reason: 'Error in analysis'
    });
  }
});
