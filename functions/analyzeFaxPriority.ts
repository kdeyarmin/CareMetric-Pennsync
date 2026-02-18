import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { document_name = '', cover_page_details = {}, recipient_name = '', sender_name = '' } = body;

    const urgentKeywords = ['STAT', 'urgent', 'critical', 'emergency', 'immediately', 'ASAP'];
    const highKeywords = ['results', 'prescription', 'medication', 'authorization', 'prior auth'];
    const lowKeywords = ['archive', 'historical', 'reference'];

    const fullText = [
      document_name,
      cover_page_details?.subject || '',
      cover_page_details?.message || '',
      recipient_name || '',
      sender_name || ''
    ].join(' ').toLowerCase();

    let priority = 'normal';
    let reason = 'Default priority';
    let confidence = 0.5;

    // Check for urgent keywords
    if (urgentKeywords.some(kw => fullText.includes(kw.toLowerCase()))) {
      priority = 'urgent';
      reason = 'Contains urgent keywords';
      confidence = 0.95;
    }
    // Check for high priority keywords
    else if (highKeywords.some(kw => fullText.includes(kw.toLowerCase()))) {
      priority = 'high';
      reason = 'Contains high-priority keywords';
      confidence = 0.85;
    }
    // Check for low priority keywords
    else if (lowKeywords.some(kw => fullText.includes(kw.toLowerCase()))) {
      priority = 'low';
      reason = 'Contains low-priority keywords';
      confidence = 0.7;
    }

    console.log('[analyzeFaxPriority] Detected priority:', priority, 'with confidence:', confidence);

    return Response.json({
      success: true,
      priority,
      reason,
      confidence_score: confidence,
      notify_users: priority === 'urgent'
    });

  } catch (error) {
    console.error('[analyzeFaxPriority] Error:', error.message);
    return Response.json({
      success: false,
      priority: 'normal',
      reason: 'Error in analysis',
      error: error.message
    });
  }
});