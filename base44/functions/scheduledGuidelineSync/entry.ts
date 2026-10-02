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
// <<<BEGIN SHARED HELPER: schedulerAuth — generated, edit base44/_shared/backendHelpers.mjs>>>
const SCHEDULER_SECRET_HEADER = 'x-internal-secret';
function isSchedulerAdmin(user) {
  return !!user && user.role === 'admin';
}
// Constant-time string compare for the shared-secret check (mirrors
// createTelehealthToken's timingSafeEqual). A plain === short-circuits on the
// first differing character, so response timing could leak how much of the
// secret matched. Dependency-free char-code XOR so the identical source runs
// under Deno (consumers) and Node (tests).
function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
function getSchedulerAuthError(req, user) {
  if (isSchedulerAdmin(user)) return null;
  const expectedSecret = String(Deno.env.get('INTERNAL_FN_SECRET') || '').trim();
  if (!expectedSecret) {
    return Response.json(
      { error: 'Server misconfigured: INTERNAL_FN_SECRET is required for scheduled/internal functions' },
      { status: 500 },
    );
  }
  const providedSecret = String(req.headers.get(SCHEDULER_SECRET_HEADER) || '').trim();
  if (timingSafeEqualStr(providedSecret, expectedSecret)) return null;
  return Response.json(
    { error: user ? 'Forbidden: admin or scheduler secret required' : 'Unauthorized: scheduler secret required' },
    { status: user ? 403 : 401 },
  );
}
// <<<END SHARED HELPER: schedulerAuth>>>

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


/**
 * Scheduled job to automatically sync Medicare guidelines from a predefined list.
 * This job should be triggered weekly via a scheduling service (e.g., cron, GitHub Actions, etc.)
 * 
 * To set up weekly scheduling:
 * 1. Use a cron service to call this endpoint weekly: POST /functions/scheduledGuidelineSync
 * 2. Include service token in Authorization header
 * 3. Or configure via external scheduler (e.g., GitHub Actions with schedule trigger)
 */

// Predefined list of critical Medicare guidelines to sync
const GUIDELINES_TO_SYNC = [
  {
    url: 'https://www.cms.gov/medicare/payment/prospective-payment-systems/home-health',
    category: 'medicare_cop',
    subcategory: 'Home Health PPS',
    keywords: ['home health', 'prospective payment', 'HHPPS', 'reimbursement']
  },
  {
    url: 'https://www.cms.gov/medicare/quality/home-health',
    category: 'quality_measures',
    subcategory: 'Home Health Quality Reporting',
    keywords: ['quality measures', 'HHQRP', 'reporting']
  },
  {
    url: 'https://www.cms.gov/medicare/health-safety-standards/conditions-coverage-participation/home-health',
    category: 'medicare_cop',
    subcategory: 'Conditions of Participation',
    keywords: ['conditions of participation', 'CoPs', 'compliance', 'regulations']
  },
  {
    url: 'https://www.cms.gov/medicare/payment/prospective-payment-systems/home-health/home-health-patient-driven-groupings-model',
    category: 'pdgm',
    subcategory: 'Patient-Driven Groupings Model',
    keywords: ['PDGM', 'patient-driven', 'groupings', 'case mix']
  }
];

Deno.serve(async (req) => {
  const startTime = Date.now();
  
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));

    // Authorization: privileged scheduled job (service-role SystemLog/
    // MedicareGuideline writes + LLM/website fetches, no end user). Opt-in
    // lockdown like checkExpiredInvitations (see §4); mirrors syncCMSRegulations.
    const me = await base44.auth.me().catch(() => null);
    const authError = getSchedulerAuthError(req, me);
    if (authError) return authError;
    if (isDeactivatedUser(me)) return DEACTIVATED_USER_RESPONSE();

    // Create initial log entry
    const logEntry = await base44.asServiceRole.entities.SystemLog.create({
      job_name: 'Medicare Guidelines Weekly Sync',
      job_type: 'medicare_guideline_sync',
      status: 'running',
      message: 'Starting scheduled guideline sync...',
      details: {
        guidelines_count: GUIDELINES_TO_SYNC.length,
        start_time: new Date().toISOString()
      }
    });

    const results = {
      total: GUIDELINES_TO_SYNC.length,
      created: 0,
      updated: 0,
      failed: 0,
      errors: []
    };

    // Process each guideline
    for (const guidelineConfig of GUIDELINES_TO_SYNC) {
      try {
        // Fetch the webpage content directly — the Base44 fetch-website API
        // requires a user Authorization header, which is absent when the
        // scheduler calls this function with x-internal-secret instead.
        const fetchResult = await fetch(guidelineConfig.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; PennSync-GuidelineSync/1.0)',
            'Accept': 'text/html,application/xhtml+xml',
          },
          redirect: 'follow',
        });

        if (!fetchResult.ok) {
          throw new Error(`Failed to fetch ${guidelineConfig.url} (HTTP ${fetchResult.status})`);
        }

        const htmlContent = await fetchResult.text();
        // Strip HTML tags to produce a rough text/markdown representation for the LLM.
        const markdownContent = htmlContent
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/\s+/g, ' ')
          .trim();

        if (!markdownContent) {
          throw new Error(`No content extracted from ${guidelineConfig.url}`);
        }

        // Use AI to extract structured info
        const analysisPrompt = `Analyze this Medicare guideline content and extract structured information.

CONTENT:
${markdownContent.substring(0, 5000)}

Extract and return JSON with:
{
  "title": "Clear, concise title of the guideline",
  "summary": "2-3 sentence summary of key requirements and what nurses need to know",
  "extracted_keywords": ["keyword1", "keyword2", ...],
  "related_diagnoses": ["diagnosis1", "diagnosis2", ...],
  "applies_to_visit_types": ["visit_type1", ...],
  "effective_date": "YYYY-MM-DD or null if not found",
  "regulatory_citation": "Official citation if found"
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

        // Combine keywords
        const allKeywords = [
          ...(guidelineConfig.keywords || []),
          ...(analysis.extracted_keywords || [])
        ].filter((k, i, arr) => arr.indexOf(k) === i);

        // Check if exists
        const existing = await base44.asServiceRole.entities.MedicareGuideline.filter({ 
          url: guidelineConfig.url 
        }, undefined, 5000);
        
        const guidelineData = {
          title: analysis.title,
          url: guidelineConfig.url,
          content_markdown: markdownContent,
          summary: analysis.summary,
          category: guidelineConfig.category,
          subcategory: guidelineConfig.subcategory || null,
          effective_date: analysis.effective_date || null,
          last_fetched_date: new Date().toISOString(),
          keywords: allKeywords,
          related_diagnoses: analysis.related_diagnoses || [],
          applies_to_visit_types: analysis.applies_to_visit_types || [],
          is_active: true,
          cms_manual_chapter: guidelineConfig.cms_manual_chapter || null,
          regulatory_citation: analysis.regulatory_citation || null
        };

        if (existing && existing.length > 0) {
          await base44.asServiceRole.entities.MedicareGuideline.update(
            existing[0].id,
            guidelineData
          );
          results.updated++;
        } else {
          await base44.asServiceRole.entities.MedicareGuideline.create(guidelineData);
          results.created++;
        }

      } catch (error) {
        results.failed++;
        results.errors.push({
          url: guidelineConfig.url,
          error: error.message
        });
      }
    }

    const duration = Date.now() - startTime;
    const finalStatus = results.failed === 0 ? 'success' : 
                        results.failed < results.total ? 'warning' : 'error';

    // Update log entry with final results
    await base44.asServiceRole.entities.SystemLog.update(logEntry.id, {
      status: finalStatus,
      message: `Sync completed: ${results.created} created, ${results.updated} updated, ${results.failed} failed`,
      details: {
        ...results,
        end_time: new Date().toISOString()
      },
      duration_ms: duration,
      records_processed: results.total,
      records_created: results.created,
      records_updated: results.updated,
      records_failed: results.failed
    });

    return Response.json({
      success: finalStatus !== 'error',
      status: finalStatus,
      results: results,
      duration_ms: duration,
      log_id: logEntry.id
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    
    // Log critical failure
    try {
      const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
      await base44.asServiceRole.entities.SystemLog.create({
        job_name: 'Medicare Guidelines Weekly Sync',
        job_type: 'medicare_guideline_sync',
        status: 'error',
        message: 'Critical failure: ' + error.message,
        error_stack: error.stack,
        duration_ms: duration,
        details: {
          error_time: new Date().toISOString()
        }
      });
    } catch (logError) {
      console.error('Failed to log error:', logError);
    }

    return Response.json({ 
      success: false,
      error: 'Internal server error',
      details: 'Scheduled guideline sync failed'
    }, { status: 500 });
  }
});