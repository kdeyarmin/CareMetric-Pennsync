import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    console.log('[autoRetryFailedFaxes] Starting automatic retry process');

    // Fetch all failed faxes
    const allFaxes = await base44.asServiceRole.entities.FaxHistory.list();
    const failedFaxes = allFaxes.filter(f => f.status === 'failed' && (f.retry_count || 0) < (f.max_retries || 3));

    let successCount = 0;
    let exhaustedCount = 0;

    for (const fax of failedFaxes) {
      try {
        // Check retry delay based on priority
        const priorityDelayMultiplier = {
          urgent: 0.5,
          high: 1,
          normal: 1.5,
          low: 2
        }[fax.priority] || 1;

        const baseDelay = 5 * 60 * 1000; // 5 minutes
        const delayMs = baseDelay * priorityDelayMultiplier;
        const lastRetry = fax.last_retry_at ? new Date(fax.last_retry_at).getTime() : 0;
        const timeSinceRetry = Date.now() - lastRetry;

        if (timeSinceRetry < delayMs) {
          continue; // Skip if not enough time has passed
        }

        // Attempt retry
        const result = await base44.functions.invoke('retryFailedFax', {
          fax_history_id: fax.id
        });

        if (result?.data?.success) {
          successCount++;
        } else {
          const retryCount = (fax.retry_count || 0) + 1;
          if (retryCount >= (fax.max_retries || 3)) {
            exhaustedCount++;
            // Send final failure notification
            try {
              await base44.functions.invoke('sendFaxNotification', {
                user_email: fax.user_email,
                fax_history_id: fax.id,
                status: 'exhausted',
                recipient_name: fax.recipient_name,
                recipient_fax_number: fax.recipient_fax_number
              });
            } catch (notifErr) {
              console.warn('[autoRetryFailedFaxes] Notification failed:', notifErr.message);
            }
          }
        }
      } catch (error) {
        console.error('[autoRetryFailedFaxes] Error retrying fax', fax.id, ':', error.message);
      }
    }

    console.log('[autoRetryFailedFaxes] Complete:', {
      total_processed: failedFaxes.length,
      retried: successCount,
      exhausted: exhaustedCount
    });

    return Response.json({
      success: true,
      total_processed: failedFaxes.length,
      successfully_retried: successCount,
      exhausted: exhaustedCount
    });

  } catch (error) {
    console.error('[autoRetryFailedFaxes] Error:', error.message);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
});