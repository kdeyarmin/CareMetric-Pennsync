import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { to_numbers, media_urls, document_name, patient_id, cover_page_details, priority, from_fax_number } = body;

    if (!to_numbers || !Array.isArray(to_numbers) || to_numbers.length === 0) {
      return Response.json({ error: 'to_numbers array is required' }, { status: 400 });
    }
    if (!media_urls || media_urls.length === 0) {
      return Response.json({ error: 'At least one document URL is required' }, { status: 400 });
    }

    const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    let detectedPriority = priority || 'normal';
    let priorityReason = '';

    // AI priority detection on first recipient if not manually set
    if (!priority) {
      try {
        const priorityResult = await base44.asServiceRole.functions.invoke('analyzeFaxPriority', {
          document_name: document_name || '',
          cover_page_details: cover_page_details || {},
          media_urls
        });
        if (priorityResult?.data?.priority) {
          detectedPriority = priorityResult.data.priority;
          priorityReason = priorityResult.data.reason || '';
        }
      } catch (e) {
        console.warn('[sendBatchFax] Priority detection failed (non-blocking):', e.message);
      }
    }

    const results = [];
    let successCount = 0;
    let failureCount = 0;

    for (const recipient of to_numbers) {
      const recipientNumber = recipient.number || recipient;
      const recipientName = recipient.name || '';

      try {
        // Create FaxHistory record
        const historyRecord = await base44.asServiceRole.entities.FaxHistory.create({
          user_email: user.email,
          recipient_name: recipientName,
          recipient_fax_number: recipientNumber,
          subject: cover_page_details?.subject || document_name || '',
          document_urls: media_urls,
          page_count: media_urls.length,
          status: 'sending',
          patient_id: patient_id || '',
          priority: detectedPriority,
          priority_reason: priorityReason,
          batch_id: batchId
        });

        // Send via sendFax function
        const sendResult = await base44.functions.invoke('sendFax', {
          to_fax_number: recipientNumber,
          media_urls,
          fax_history_id: historyRecord.id,
          recipient_name: recipientName,
          from_fax_number: from_fax_number || undefined
        });

        results.push({
          recipient: recipientNumber,
          name: recipientName,
          status: 'sent',
          fax_history_id: historyRecord.id,
          fax_id: sendResult?.data?.fax_id
        });
        successCount++;
      } catch (err) {
        console.error(`[sendBatchFax] Failed for ${recipientNumber}:`, err.message);
        results.push({
          recipient: recipientNumber,
          name: recipientName,
          status: 'failed',
          error: err.message
        });
        failureCount++;
      }
    }

    // Log activity
    try {
      await base44.asServiceRole.entities.UserActivity.create({
        user_email: user.email,
        user_name: user.full_name,
        action: 'batch_fax_sent',
        details: {
          batch_id: batchId,
          total: to_numbers.length,
          success: successCount,
          failed: failureCount,
          priority: detectedPriority
        },
        page: 'SendFax',
        entity_type: 'FaxHistory'
      });
    } catch (e) {
      console.warn('[sendBatchFax] Activity log failed:', e.message);
    }

    return Response.json({
      success: true,
      batch_id: batchId,
      total: to_numbers.length,
      success_count: successCount,
      failure_count: failureCount,
      priority: detectedPriority,
      results
    });

  } catch (error) {
    console.error('[sendBatchFax] Error:', error.message, error.stack);
    return Response.json({ error: error.message }, { status: 500 });
  }
});