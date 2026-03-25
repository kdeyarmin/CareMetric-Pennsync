import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { fax_history_id } = body;

    if (!fax_history_id) {
      return Response.json({ error: 'Fax history ID is required' }, { status: 400 });
    }

    // Fetch the fax history record
    const faxHistory = await base44.asServiceRole.entities.FaxHistory.list();
    const fax = faxHistory.find(f => f.id === fax_history_id);

    if (!fax) {
      return Response.json({ error: 'Fax not found' }, { status: 404 });
    }

    // Check retry limit
    const retryCount = (fax.retry_count || 0) + 1;
    const maxRetries = fax.max_retries || 3;

    if (retryCount > maxRetries) {
      return Response.json({
        error: `Retry limit exceeded (${maxRetries} attempts)`
      }, { status: 400 });
    }

    // Update fax history with new retry attempt
    await base44.asServiceRole.entities.FaxHistory.update(fax_history_id, {
      status: 'sending',
      retry_count: retryCount,
      last_retry_at: new Date().toISOString(),
      error_message: null
    });

    // Retry the fax transmission
    const result = await base44.functions.invoke('sendFax', {
      to_fax_number: fax.recipient_fax_number,
      media_urls: fax.document_urls,
      from_fax_number: fax.sender_fax || '+18445550100',
      document_name: fax.subject || 'Retry Document',
      patient_id: fax.patient_id,
      fax_history_id: fax_history_id
    });

    console.log('[retryFailedFax] Retry attempt', retryCount, 'for fax:', fax_history_id);

    return Response.json({
      success: result?.data?.success || false,
      retry_count: retryCount,
      max_retries: maxRetries,
      fax_id: result?.data?.fax_id
    });

  } catch (error) {
    console.error('[retryFailedFax] Error:', error.message);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
});