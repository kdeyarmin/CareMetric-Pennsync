import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { metric_type, value, service, threshold_warning, threshold_critical } = await req.json();

    // Determine status based on thresholds
    let status = 'healthy';
    if (threshold_critical && value >= threshold_critical) {
      status = 'critical';
    } else if (threshold_warning && value >= threshold_warning) {
      status = 'warning';
    }

    // Create metric record
    const metric = await base44.asServiceRole.entities.SystemHealthMetric.create({
      metric_type,
      value,
      unit: metric_type.includes('time') ? 'ms' : 'percentage',
      service,
      status,
      threshold_warning: threshold_warning || 1000,
      threshold_critical: threshold_critical || 5000,
      timestamp: new Date().toISOString(),
      details: {
        recorded_at: new Date().toLocaleString()
      }
    });

    // Alert if critical
    if (status === 'critical') {
      try {
        await base44.integrations.Core.SendEmail({
          to: user.email,
          subject: `🚨 CRITICAL: ${service} - ${metric_type}`,
          body: `Critical health alert:\n\nService: ${service}\nMetric: ${metric_type}\nValue: ${value}ms\nThreshold: ${threshold_critical}ms\n\nPlease investigate immediately.`
        });
      } catch (e) {
        console.error('Failed to send alert email:', e);
      }
    }

    return Response.json({
      success: true,
      metric_id: metric.id,
      status,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in monitorSystemHealth:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});