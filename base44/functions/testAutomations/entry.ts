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

    // Test personnel expiration notifications
    try {
      const personnelResult = await base44.functions.invoke('sendPersonnelExpirationNotifications', {});
      results.tests.push({
        function: 'sendPersonnelExpirationNotifications',
        status: 'success',
        result: personnelResult
      });
    } catch (error) {
      results.tests.push({
        function: 'sendPersonnelExpirationNotifications',
        status: 'error',
        error: error.message
      });
    }

    // Test training notifications
    try {
      const trainingResult = await base44.functions.invoke('sendTrainingNotifications', {});
      results.tests.push({
        function: 'sendTrainingNotifications',
        status: 'success',
        result: trainingResult
      });
    } catch (error) {
      results.tests.push({
        function: 'sendTrainingNotifications',
        status: 'error',
        error: error.message
      });
    }

    // Test credential renewal reminders
    try {
      const renewalResult = await base44.functions.invoke('sendCredentialRenewalReminders', {});
      results.tests.push({
        function: 'sendCredentialRenewalReminders',
        status: 'success',
        result: renewalResult
      });
    } catch (error) {
      results.tests.push({
        function: 'sendCredentialRenewalReminders',
        status: 'error',
        error: error.message
      });
    }

    // Test expiration notifications
    try {
      const expirationResult = await base44.functions.invoke('sendExpirationNotifications', {});
      results.tests.push({
        function: 'sendExpirationNotifications',
        status: 'success',
        result: expirationResult
      });
    } catch (error) {
      results.tests.push({
        function: 'sendExpirationNotifications',
        status: 'error',
        error: error.message
      });
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
    return Response.json({ error: error.message }, { status: 500 });
  }
});