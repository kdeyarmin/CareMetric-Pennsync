import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    console.log('Running scheduled compliance & security monitoring...');

    // Run all checks in parallel
    const results = await Promise.allSettled([
      base44.functions.invoke('auditAnomalies', {}),
      base44.functions.invoke('detectComplianceViolations', {}),
      base44.functions.invoke('processAIFeedback', {})
    ]);

    const summary = {
      anomalies: results[0].status === 'fulfilled' ? results[0].value.anomalies_detected : 0,
      violations: results[1].status === 'fulfilled' ? results[1].value.violations_detected : 0,
      feedback_processed: results[2].status === 'fulfilled' ? results[2].value.feedback_processed : 0,
      errors: results.filter(r => r.status === 'rejected').map(r => r.reason?.message)
    };

    console.log('✅ Monitoring complete:', summary);

    return Response.json({
      success: true,
      summary
    });

  } catch (error) {
    console.error('Error in scheduleAutoMonitoring:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});