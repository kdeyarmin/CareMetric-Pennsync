import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { to_fax_number, media_urls, cover_page_html, fax_history_id } = body;

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

    // Format the fax number - ensure it starts with +1 for US
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

    // Update fax history to sending
    if (fax_history_id) {
      try {
        await base44.asServiceRole.entities.FaxHistory.update(fax_history_id, { 
          status: 'sending' 
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
        connection_id: '', // Will use default
        to: formattedNumber,
        from: '+18445550100', // Telnyx will use your configured number
        media_url: media_urls[0], // Telnyx accepts one media_url per fax
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
      
      // Update history with failure
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

    return Response.json({ 
      success: true, 
      fax_id: faxId,
      message: 'Fax sent successfully'
    });

  } catch (error) {
    console.error('[sendFax] Error:', error.message, error.stack);
    return Response.json({ error: error.message }, { status: 500 });
  }
});