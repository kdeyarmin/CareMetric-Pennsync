import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { to_fax_number, media_urls, cover_page_html, fax_history_id, from_fax_number, document_name, patient_id, priority } = body;

    if (!to_fax_number) {
      return Response.json({ error: 'Fax number is required' }, { status: 400 });
    }

    if (!media_urls || media_urls.length === 0) {
      return Response.json({ error: 'At least one document is required' }, { status: 400 });
    }

    const apiKey = Deno.env.get("TELNYX_API_KEY");
    if (!apiKey) {
      console.error('[sendFax] TELNYX_API_KEY not set');
      return Response.json({ error: 'Fax service not configured' }, { status: 500 });
    }

    // Format the fax number
    let formattedNumber = to_fax_number.replace(/[^\d+]/g, '');
    if (!formattedNumber.startsWith('+')) {
      if (formattedNumber.length === 10) {
        formattedNumber = '+1' + formattedNumber;
      } else if (formattedNumber.length === 11 && formattedNumber.startsWith('1')) {
        formattedNumber = '+' + formattedNumber;
      } else {
        formattedNumber = '+' + formattedNumber;
      }
    }

    console.log('[sendFax] Sending fax to:', formattedNumber, 'with', media_urls.length, 'documents');

    // AI priority detection if not manually set
    let detectedPriority = priority || 'normal';
    let priorityReason = '';
    if (!priority) {
      try {
        const priorityResult = await base44.asServiceRole.functions.invoke('analyzeFaxPriority', {
          document_name: document_name || '',
          cover_page_details: body.cover_page_details || {},
          recipient_name: body.recipient_name || '',
          sender_name: user.full_name || ''
        });
        if (priorityResult?.data?.priority) {
          detectedPriority = priorityResult.data.priority;
          priorityReason = priorityResult.data.reason || '';
        }
      } catch (e) {
        console.warn('[sendFax] Priority detection failed (non-blocking):', e.message);
      }
    }

    // Update fax history to sending with priority
    if (fax_history_id) {
      try {
        await base44.asServiceRole.entities.FaxHistory.update(fax_history_id, { 
          status: 'sending',
          priority: detectedPriority,
          priority_reason: priorityReason
        });
      } catch (e) {
        console.error('[sendFax] Failed to update history status:', e.message);
      }
    }

    // Send fax via Telnyx
    const telnyxResponse = await fetch('https://api.telnyx.com/v2/faxes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        to: formattedNumber,
        from: from_fax_number || '+18445550100',
        media_url: media_urls[0],
        quality: 'high',
        monochrome: false
      })
    });

    const telnyxData = await telnyxResponse.json();
    console.log('[sendFax] Telnyx response status:', telnyxResponse.status);
    console.log('[sendFax] Telnyx response:', JSON.stringify(telnyxData));

    if (!telnyxResponse.ok) {
      const errorMsg = telnyxData?.errors?.[0]?.detail || telnyxData?.error?.message || 'Failed to send fax';
      console.error('[sendFax] Telnyx error:', errorMsg);
      
      if (fax_history_id) {
        try {
          await base44.asServiceRole.entities.FaxHistory.update(fax_history_id, { 
            status: 'failed',
            error_message: errorMsg
          });
        } catch (e) {
          console.error('[sendFax] Failed to update history:', e.message);
        }
      }

      // Send failure notification
      try {
        await base44.asServiceRole.functions.invoke('sendFaxNotification', {
          user_email: user.email,
          fax_history_id: fax_history_id || '',
          status: 'failed',
          recipient_name: body.recipient_name || '',
          recipient_fax_number: to_fax_number
        });
      } catch (notifErr) {
        console.error('[sendFax] Notification failed (non-blocking):', notifErr.message);
      }

      return Response.json({ error: errorMsg }, { status: 400 });
    }

    const faxId = telnyxData?.data?.id;

    // Update history with success
    if (fax_history_id) {
      try {
        await base44.asServiceRole.entities.FaxHistory.update(fax_history_id, { 
          status: 'sent',
          telnyx_fax_id: faxId,
          sent_at: new Date().toISOString()
        });
      } catch (e) {
        console.error('[sendFax] Failed to update history:', e.message);
      }
    }

    // Send success notification
    try {
      await base44.asServiceRole.functions.invoke('sendFaxNotification', {
        user_email: user.email,
        fax_history_id: fax_history_id || '',
        status: 'sent',
        recipient_name: body.recipient_name || '',
        recipient_fax_number: to_fax_number
      });
    } catch (notifErr) {
      console.error('[sendFax] Notification failed (non-blocking):', notifErr.message);
    }

    // Queue OCR processing
    if (fax_history_id) {
      try {
        await base44.asServiceRole.functions.invoke('processFaxOCR', {
          fax_log_id: fax_history_id,
          document_url: media_urls[0]
        });
      } catch (e) {
        console.warn('[sendFax] OCR queue failed (non-blocking):', e.message);
      }
    }

    // Log user activity
    try {
      await base44.asServiceRole.entities.UserActivity.create({
        user_email: user.email,
        user_name: user.full_name || '',
        action: 'fax_sent',
        details: {
          recipient: to_fax_number,
          recipient_name: body.recipient_name || '',
          document_count: media_urls.length,
          priority: detectedPriority,
          fax_history_id: fax_history_id || '',
          telnyx_fax_id: faxId,
          estimated_cost_cents: media_urls.length * 7 // ~$0.07 per page estimate
        },
        page: 'SendFax',
        entity_type: 'FaxHistory',
        entity_id: fax_history_id || ''
      });
    } catch (e) {
      console.warn('[sendFax] Activity log failed (non-blocking):', e.message);
    }

    return Response.json({ 
      success: true, 
      fax_id: faxId,
      priority: detectedPriority,
      message: 'Fax sent successfully'
    });

  } catch (error) {
    console.error('[sendFax] Error:', error.message, error.stack);
    return Response.json({ error: error.message }, { status: 500 });
  }
});