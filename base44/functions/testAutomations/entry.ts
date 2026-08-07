import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// <<<BEGIN SHARED HELPER: isAdminLike — generated, edit base44/_shared/backendHelpers.mjs>>>
const isAdminLike = (u) => !!u && (
  u.role === 'admin' || u.account_type === 'agency_admin' ||
  u.account_type === 'super_admin'
);
// <<<END SHARED HELPER: isAdminLike>>>



Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    
    if (!user || !isAdminLike(user)) {
      return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
    }

    const results = {
      timestamp: new Date().toISOString(),
      tests: []
    };

    const automationFunctions = [
      'sendPersonnelExpirationNotifications',
      'sendTrainingNotifications',
      'sendCredentialRenewalReminders',
      'sendExpirationNotifications'
    ];

    for (const fnName of automationFunctions) {
      try {
        const fnResult = await base44.functions.invoke(fnName, {});
        // functions.invoke returns an axios response — extract .data to avoid
        // "Converting circular structure to JSON" when Response.json serializes.
        const data = fnResult?.data ?? fnResult;
        results.tests.push({
          function: fnName,
          status: 'success',
          result: typeof data === 'object' ? data : { value: data }
        });
      } catch (error) {
        results.tests.push({
          function: fnName,
          status: 'error',
          error: error.message
        });
      }
    }

    const successCount = results.tests.filter(t => t.status === 'success').length;
    const failCount = results.tests.filter(t => t.status === 'error').length;

    return Response.json({
      summary: {
        total_tests: results.tests.length,
        successful: successCount,
        failed: failCount,
        success_rate: `${(successCount / results.tests.length * 100).toFixed(1)}%`
      },
      details: results.tests,
      timestamp: results.timestamp
    });

  } catch (error) {
    console.error('Automation test error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});