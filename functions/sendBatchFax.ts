import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { media_urls, to_fax_numbers, from_fax_number, document_name, patient_id, cover_page_details, priority } = body;

    if (!to_fax_numbers || !Array.isArray(to_fax_numbers) || to_fax_numbers.length === 0) {
      return Response.json({ error: 'At least one recipient fax number is required' }, { status: 400 });
    }

    if (!media_urls || media_urls.length === 0) {
      return Response.json({ error: 'At least one document is required' }, { status: 400 });
    }

    console.log('[sendBatchFax] Sending batch fax to', to_fax_numbers.length, 'recipients');

    const results = [];
    let successCount = 0;
    let failureCount = 0;

    for (const toNumber of to_fax_numbers) {
      try {
        const faxResult = await base44.functions.invoke('sendFax', {
          to_fax_number: toNumber,
          media_urls,
          from_fax_number: from_fax_number || '+18445550100',
          document_name: document_name || 'Document',
          patient_id,
          cover_page_details,
          priority
        });

        if (faxResult?.data?.success) {
          successCount++;
          results.push({
            recipient: toNumber,
            success: true,
            fax_id: faxResult.data.fax_id,
            priority: faxResult.data.priority
          });
        } else {
          failureCount++;
          results.push({
            recipient: toNumber,
            success: false,
            error: faxResult?.data?.error || 'Unknown error'
          });
        }
      } catch (error) {
        failureCount++;
        results.push({
          recipient: toNumber,
          success: false,
          error: error.message
        });
        console.error('[sendBatchFax] Error sending to', toNumber, ':', error.message);
      }
    }

    // Log batch activity
    try {
      await base44.asServiceRole.entities.UserActivity.create({
        user_email: user.email,
        user_name: user.full_name || '',
        action: 'batch_fax_sent',
        details: {
          total_recipients: to_fax_numbers.length,
          successful: successCount,
          failed: failureCount,
          document: document_name || 'Document'
        },
        page: 'SendFax',
        entity_type: 'FaxHistory'
      });
    } catch (e) {
      console.warn('[sendBatchFax] Activity log failed:', e.message);
    }

    return Response.json({
      success: true,
      total_sent: successCount,
      total_failed: failureCount,
      results
    });

  } catch (error) {
    console.error('[sendBatchFax] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});