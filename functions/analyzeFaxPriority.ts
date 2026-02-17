import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const body = await req.json();
    const { document_name, cover_page_details, media_urls, sender_name, recipient_name } = body;

    // Rule-based priority detection first
    const urgentKeywords = ['stat', 'emergency', 'critical', 'urgent', 'immediate', 'asap', 'code blue', 'life-threatening'];
    const highKeywords = ['results', 'prescription', 'prior auth', 'authorization', 'time-sensitive', 'expedite', 'rush'];
    const lowKeywords = ['records request', 'routine', 'for your records', 'fyi', 'information only'];

    const searchText = [
      document_name || '',
      cover_page_details?.subject || '',
      cover_page_details?.message || '',
      sender_name || '',
      recipient_name || ''
    ].join(' ').toLowerCase();

    // Check rule-based keywords
    for (const keyword of urgentKeywords) {
      if (searchText.includes(keyword)) {
        return Response.json({
          priority: 'urgent',
          reason: `Detected urgent keyword: "${keyword}"`,
          confidence: 95,
          method: 'rule_based',
          notify_users: true
        });
      }
    }

    for (const keyword of highKeywords) {
      if (searchText.includes(keyword)) {
        return Response.json({
          priority: 'high',
          reason: `Detected high-priority keyword: "${keyword}"`,
          confidence: 85,
          method: 'rule_based',
          notify_users: false
        });
      }
    }

    for (const keyword of lowKeywords) {
      if (searchText.includes(keyword)) {
        return Response.json({
          priority: 'low',
          reason: `Detected low-priority keyword: "${keyword}"`,
          confidence: 80,
          method: 'rule_based',
          notify_users: false
        });
      }
    }

    // If no rules matched, use AI analysis
    if (searchText.trim().length > 5) {
      try {
        const aiResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
          prompt: `Classify the priority of this fax transmission.

Document name: ${document_name || 'N/A'}
Subject: ${cover_page_details?.subject || 'N/A'}
Message: ${cover_page_details?.message || 'N/A'}
Sender: ${sender_name || 'N/A'}
Recipient: ${recipient_name || 'N/A'}

Classify as: urgent, high, normal, or low.
Consider medical context — prescriptions, lab results, and prior authorizations are typically high priority.`,
          response_json_schema: {
            type: "object",
            properties: {
              priority: { type: "string", enum: ["urgent", "high", "normal", "low"] },
              reason: { type: "string" },
              confidence: { type: "number" },
              should_notify: { type: "boolean" }
            }
          }
        });

        return Response.json({
          priority: aiResult.priority || 'normal',
          reason: aiResult.reason || 'AI classification',
          confidence: aiResult.confidence || 70,
          method: 'ai_analysis',
          notify_users: aiResult.should_notify || aiResult.priority === 'urgent'
        });
      } catch (e) {
        console.warn('[analyzeFaxPriority] AI fallback failed:', e.message);
      }
    }

    // Default to normal
    return Response.json({
      priority: 'normal',
      reason: 'No priority indicators detected',
      confidence: 50,
      method: 'default',
      notify_users: false
    });

  } catch (error) {
    console.error('[analyzeFaxPriority] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});