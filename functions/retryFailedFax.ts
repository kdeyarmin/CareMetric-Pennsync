import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { fax_log_id } = body;

    if (!fax_log_id) {
      return Response.json({ error: 'fax_log_id is required' }, { status: 400 });
    }

    // Fetch the fax record
    const faxRecords = await base44.entities.FaxHistory.filter({ id: fax_log_id });
    const fax = faxRecords?.[0];

    if (!fax) {
      return Response.json({ error: 'Fax record not found' }, { status: 404 });
    }

    // Check ownership
    if (fax.user_email !== user.email && user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized to retry this fax' }, { status: 403 });
    }

    // Check retry limit
    const maxRetries = fax.max_retries || 3;
    const currentRetries = fax.retry_count || 0;

    if (currentRetries >= maxRetries) {
      return Response.json({ 
        error: `Maximum retry limit (${maxRetries}) reached for this fax`,
        retry_count: currentRetries,
        max_retries: maxRetries
      }, { status: 400 });
    }

    if (!fax.document_urls || fax.document_urls.length === 0) {
      return Response.json({ error: 'No documents found on this fax record' }, { status: 400 });
    }

    // Update fax status to sending and increment retry count
    await base44.asServiceRole.entities.FaxHistory.update(fax_log_id, {
      status: 'sending',
      error_message: '',
      retry_count: currentRetries + 1,
      last_retry_at: new Date().toISOString()
    });

    console.log(`[retryFailedFax] Retrying fax ${fax_log_id}, attempt ${currentRetries + 1}/${maxRetries}`);

    // Resend via Telnyx
    const apiKey = Deno.env.get("TELNYX_API_KEY");
    if (!apiKey) {
      return Response.json({ error: 'Fax service not configured' }, { status: 500 });
    }

    let formattedNumber = fax.recipient_fax_number.replace(/[^\d+]/g, '');
    if (!formattedNumber.startsWith('+')) {
      if (formattedNumber.length === 10) formattedNumber = '+1' + formattedNumber;
      else if (formattedNumber.length === 11 && formattedNumber.startsWith('1')) formattedNumber = '+' + formattedNumber;
      else formattedNumber = '+' + formattedNumber;
    }

    const telnyxResponse = await fetch('https://api.telnyx.com/v2/faxes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        to: formattedNumber,
        from: user.sending_fax_number || '+18445550100',
        media_url: fax.document_urls[0],
        quality: 'high',
        monochrome: false
      })
    });

    const telnyxData = await telnyxResponse.json();

    if (!telnyxResponse.ok) {
      const errorMsg = telnyxData?.errors?.[0]?.detail || 'Retry failed at Telnyx';
      await base44.asServiceRole.entities.FaxHistory.update(fax_log_id, {
        status: 'failed',
        error_message: `Retry ${currentRetries + 1} failed: ${errorMsg}`
      });

      return Response.json({ 
        error: errorMsg, 
        retry_count: currentRetries + 1 
      }, { status: 400 });
    }

    const newFaxId = telnyxData?.data?.id;

    await base44.asServiceRole.entities.FaxHistory.update(fax_log_id, {
      status: 'sent',
      telnyx_fax_id: newFaxId,
      sent_at: new Date().toISOString()
    });

    // Send notification
    try {
      await base44.asServiceRole.functions.invoke('sendFaxNotification', {
        user_email: user.email,
        fax_history_id: fax_log_id,
        status: 'sent',
        recipient_name: fax.recipient_name || '',
        recipient_fax_number: fax.recipient_fax_number
      });
    } catch (e) {
      console.warn('[retryFailedFax] Notification failed:', e.message);
    }

    return Response.json({
      success: true,
      fax_id: newFaxId,
      retry_count: currentRetries + 1,
      message: `Fax retry ${currentRetries + 1} sent successfully`
    });

  } catch (error) {
    console.error('[retryFailedFax] Error:', error.message, error.stack);
    return Response.json({ error: error.message }, { status: 500 });
  }
});