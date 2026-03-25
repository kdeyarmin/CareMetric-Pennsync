import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { fax_log_id, document_url, ocr_text = '' } = body;

    if (!fax_log_id && !ocr_text) {
      return Response.json({ error: 'Fax log ID or OCR text is required' }, { status: 400 });
    }

    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicApiKey) {
      console.error('[analyzeFaxContent] ANTHROPIC_API_KEY not configured');
      throw new Error('ANTHROPIC_API_KEY not configured');
    }

    const analysisPrompt = `Analyze this fax content and provide:
1. A concise summary (2-3 sentences)
2. Key points or action items
3. Urgency level (critical/high/medium/low)
4. Document category (lab_results/prescription/referral/medical_records/appointment/other)
5. A professional reply draft if needed
6. Any contact information mentioned

Fax Content:
${ocr_text}

Provide structured analysis.`;

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 2048,
        messages: [{ role: 'user', content: analysisPrompt }]
      })
    });

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text();
      console.error('[analyzeFaxContent] Claude API error:', errorText);
      throw new Error(`Claude API failed: ${claudeResponse.status}`);
    }

    const claudeResult = await claudeResponse.json();
    const analysisText = claudeResult.content?.[0]?.text || '';

    return Response.json({
      success: true,
      summary: analysisText,
      reply_draft: 'Please refer to the analysis above for recommended response.',
      suggested_contacts: [],
      alerts: []
    });

  } catch (error) {
    console.error('[analyzeFaxContent] Error:', error.message);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
});