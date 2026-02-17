import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const apiKey = Deno.env.get("TELNYX_API_KEY");
    if (!apiKey) {
      return Response.json({ error: 'TELNYX_API_KEY not configured' }, { status: 500 });
    }

    // Fetch failed faxes that haven't exceeded max retries
    const failedFaxes = await base44.asServiceRole.entities.FaxHistory.filter(
      { status: 'failed' },
      '-created_date',
      50
    );

    const PRIORITY_DELAY_MULTIPLIERS = {
      urgent: 0.5,
      high: 0.75,
      normal: 1,
      low: 2
    };

    const BASE_DELAY_MINUTES = 15;
    const now = new Date();
    let retryCount = 0;
    let exhaustedCount = 0;

    for (const fax of failedFaxes) {
      const currentRetries = fax.retry_count || 0;
      const maxRetries = fax.max_retries || 3;

      // Skip if max retries exceeded
      if (currentRetries >= maxRetries) {
        // Mark as permanently failed if not already handled
        if (!fax.error_message?.includes('All retries exhausted')) {
          await base44.asServiceRole.entities.FaxHistory.update(fax.id, {
            error_message: `All retries exhausted (${maxRetries}/${maxRetries}). ${fax.error_message || ''}`
          });

          // Send final failure notification
          try {
            await base44.asServiceRole.functions.invoke('sendFaxNotification', {
              user_email: fax.user_email,
              fax_history_id: fax.id,
              status: 'failed',
              recipient_name: fax.recipient_name || '',
              recipient_fax_number: fax.recipient_fax_number
            });
          } catch (e) {
            console.warn('[autoRetry] Final notification failed:', e.message);
          }

          exhaustedCount++;
        }
        continue;
      }

      // Check delay based on priority
      const priority = fax.priority || 'normal';
      const delayMultiplier = PRIORITY_DELAY_MULTIPLIERS[priority] || 1;
      const requiredDelayMs = BASE_DELAY_MINUTES * delayMultiplier * 60 * 1000 * (currentRetries + 1);
      const lastAttemptTime = fax.last_retry_at ? new Date(fax.last_retry_at) : new Date(fax.created_date);
      const elapsedMs = now - lastAttemptTime;

      if (elapsedMs < requiredDelayMs) {
        console.log(`[autoRetry] Fax ${fax.id} not ready yet, elapsed: ${Math.round(elapsedMs/60000)}min, required: ${Math.round(requiredDelayMs/60000)}min`);
        continue;
      }

      if (!fax.document_urls || fax.document_urls.length === 0) continue;

      // Retry the fax
      try {
        let formattedNumber = fax.recipient_fax_number.replace(/[^\d+]/g, '');
        if (!formattedNumber.startsWith('+')) {
          if (formattedNumber.length === 10) formattedNumber = '+1' + formattedNumber;
          else if (formattedNumber.length === 11 && formattedNumber.startsWith('1')) formattedNumber = '+' + formattedNumber;
          else formattedNumber = '+' + formattedNumber;
        }

        await base44.asServiceRole.entities.FaxHistory.update(fax.id, {
          status: 'sending',
          error_message: '',
          retry_count: currentRetries + 1,
          last_retry_at: new Date().toISOString()
        });

        const telnyxResponse = await fetch('https://api.telnyx.com/v2/faxes', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            to: formattedNumber,
            from: '+18445550100',
            media_url: fax.document_urls[0],
            quality: 'high',
            monochrome: false
          })
        });

        const telnyxData = await telnyxResponse.json();

        if (telnyxResponse.ok) {
          await base44.asServiceRole.entities.FaxHistory.update(fax.id, {
            status: 'sent',
            telnyx_fax_id: telnyxData?.data?.id,
            sent_at: new Date().toISOString()
          });
          retryCount++;
          console.log(`[autoRetry] Successfully retried fax ${fax.id}, attempt ${currentRetries + 1}`);
        } else {
          const errMsg = telnyxData?.errors?.[0]?.detail || 'Auto-retry failed';
          await base44.asServiceRole.entities.FaxHistory.update(fax.id, {
            status: 'failed',
            error_message: `Auto-retry ${currentRetries + 1} failed: ${errMsg}`
          });
        }
      } catch (err) {
        console.error(`[autoRetry] Error retrying fax ${fax.id}:`, err.message);
        await base44.asServiceRole.entities.FaxHistory.update(fax.id, {
          status: 'failed',
          error_message: `Auto-retry ${currentRetries + 1} error: ${err.message}`
        });
      }
    }

    return Response.json({
      success: true,
      total_processed: failedFaxes.length,
      retried: retryCount,
      exhausted: exhaustedCount
    });

  } catch (error) {
    console.error('[autoRetryFailedFaxes] Error:', error.message, error.stack);
    return Response.json({ error: error.message }, { status: 500 });
  }
});