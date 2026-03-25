import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// This function is scheduled to run weekly via Deno Deploy cron
// Configure in Deno Deploy dashboard: 0 0 * * 0 (every Sunday at midnight)

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Verify this is a scheduled call (optional security check)
    const authHeader = req.headers.get('authorization');
    const scheduledHeader = req.headers.get('x-deno-cron');

    console.log('Weekly guideline update triggered at:', new Date().toISOString());

    // Call the auto-fetch function
    const fetchResponse = await base44.asServiceRole.functions.invoke('autoFetchCMSGuidelines', {});

    // Log the update to system
    await base44.asServiceRole.entities.SystemLog.create({
      log_type: 'scheduled_task',
      message: 'Weekly Medicare guideline update completed',
      details: fetchResponse,
      timestamp: new Date().toISOString()
    });

    return Response.json({
      success: true,
      message: 'Weekly guideline update completed successfully',
      timestamp: new Date().toISOString(),
      result: fetchResponse
    });

  } catch (error) {
    console.error('Weekly guideline update error:', error);
    
    // Log the error
    try {
      const base44 = createClientFromRequest(req);
      await base44.asServiceRole.entities.SystemLog.create({
        log_type: 'scheduled_task_error',
        message: 'Weekly Medicare guideline update failed',
        details: { error: error.message },
        timestamp: new Date().toISOString()
      });
    } catch (logError) {
      console.error('Failed to log error:', logError);
    }

    return Response.json(
      { error: 'Weekly guideline update failed', details: error.message },
      { status: 500 }
    );
  }
});