import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
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