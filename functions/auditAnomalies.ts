import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    // Only admins can run this
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    console.log('Starting anomaly detection...');

    // Get security logs from the past 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const logs = await base44.asServiceRole.entities.SecurityLog.filter({
      timestamp: { $gte: oneDayAgo }
    });

    const anomalies = [];

    // 1. Detect unusual access patterns
    const accessByUser = {};
    logs.forEach(log => {
      if (log.action === 'read' || log.action === 'view') {
        accessByUser[log.user_email] = (accessByUser[log.user_email] || 0) + 1;
      }
    });

    // Flag if user accessed 10x more records than their average
    const avgAccess = Object.values(accessByUser).reduce((a, b) => a + b, 0) / Object.keys(accessByUser).length;
    Object.entries(accessByUser).forEach(([email, count]) => {
      if (count > avgAccess * 10) {
        anomalies.push({
          alert_type: 'unusual_access_pattern',
          severity: 'high',
          user_email: email,
          details: {
            access_count: count,
            average: avgAccess,
            multiplier: (count / avgAccess).toFixed(2)
          }
        });
      }
    });

    // 2. Detect bulk exports or downloads
    const bulkExports = logs.filter(log => log.action === 'export' || log.action === 'download');
    if (bulkExports.length > 5) {
      bulkExports.forEach(log => {
        anomalies.push({
          alert_type: 'bulk_export',
          severity: 'critical',
          user_email: log.user_email,
          details: {
            export_count: bulkExports.filter(e => e.user_email === log.user_email).length,
            timestamp: log.timestamp
          }
        });
      });
    }

    // 3. Detect unauthorized access attempts
    const failedAccesses = logs.filter(log => log.action === 'unauthorized_access_attempt');
    if (failedAccesses.length > 3) {
      const userFailures = {};
      failedAccesses.forEach(log => {
        userFailures[log.user_email] = (userFailures[log.user_email] || 0) + 1;
      });

      Object.entries(userFailures).forEach(([email, count]) => {
        if (count >= 3) {
          anomalies.push({
            alert_type: 'unauthorized_access_attempt',
            severity: 'critical',
            user_email: email,
            details: {
              attempt_count: count,
              last_attempt: failedAccesses.filter(e => e.user_email === email).pop().timestamp
            }
          });
        }
      });
    }

    // 4. Store anomalies
    const storedAnomalies = [];
    for (const anomaly of anomalies) {
      try {
        const alert = await base44.asServiceRole.entities.AnomalyAlert.create({
          ...anomaly,
          status: 'new',
          detected_at: new Date().toISOString()
        });
        storedAnomalies.push(alert);

        // Create a task for admin to review
        await base44.asServiceRole.entities.Task.create({
          title: `Security Alert: ${anomaly.alert_type.replace(/_/g, ' ')}`,
          description: `Anomaly detected for user ${anomaly.user_email}. Details: ${JSON.stringify(anomaly.details)}`,
          priority: anomaly.severity === 'critical' ? 'critical' : 'high',
          status: 'pending',
          assigned_to: user.email,
          type: 'safety',
          source: 'ai_generated'
        });
      } catch (e) {
        console.error('Error storing anomaly:', e);
      }
    }

    console.log(`✅ Detected and stored ${storedAnomalies.length} anomalies`);

    return Response.json({
      success: true,
      anomalies_detected: storedAnomalies.length,
      details: storedAnomalies
    });

  } catch (error) {
    console.error('Error in auditAnomalies:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});