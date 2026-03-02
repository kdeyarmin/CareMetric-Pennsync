import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { note_content, provider_type, visit_type, check_type = 'hipaa_basic' } = await req.json();

    if (!note_content || !provider_type || !visit_type) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // HIPAA compliance check focuses on PHI protection
    let compliancePrompt = '';
    
    if (check_type === 'hipaa_basic') {
      compliancePrompt = `You are a HIPAA compliance specialist. Review this clinical note for potential HIPAA violations and PHI exposure.

Provider Type: ${provider_type}
Visit Type: ${visit_type}

Clinical Note:
${note_content}

Check for:
1. Unnecessary exposure of PHI (name, DOB, MRN, SSN, address, email, phone)
2. Patient privacy concerns
3. Appropriate de-identification where needed
4. Proper handling of sensitive information
5. Documentation standards compliance

For each issue found, provide:
- title: Issue title
- description: What the issue is
- severity: 'critical', 'high', 'medium', or 'low'
- example: Specific example from the text (quoted)
- recommendation: How to fix it

Also provide an overall compliance_score (0-100) where:
- 85-100: Compliant
- 70-84: Minor issues
- Below 70: Significant issues

Return as JSON with these fields.`;
    }

    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiApiKey) throw new Error('OPENAI_API_KEY not configured');

    const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiApiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 2048,
        response_format: { type: 'json_object' },
        messages: [{
          role: 'user',
          content: compliancePrompt + '\n\nReturn JSON: { "compliance_score": number, "issues": [ { "title": string, "description": string, "severity": "critical"|"high"|"medium"|"low", "example": string, "recommendation": string } ], "summary": string }'
        }]
      })
    });

    if (!gptRes.ok) {
      const errText = await gptRes.text();
      throw new Error(`GPT-4o error: ${gptRes.status} - ${errText}`);
    }

    const gptData = await gptRes.json();
    const response = JSON.parse(gptData.choices?.[0]?.message?.content || '{}');

    console.log('[checkRealtimeCompliance] GPT-4o compliance check complete, score:', response.compliance_score);

    return Response.json({
      compliance_score: response.compliance_score || 100,
      issues: response.issues || [],
      summary: response.summary || '',
      check_type,
      model: 'gpt-4o',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in checkRealtimeCompliance:', error);
    return Response.json({ 
      error: error.message,
      compliance_score: 0,
      issues: [{
        title: 'Compliance Check Failed',
        description: 'Unable to complete compliance check',
        severity: 'medium',
        recommendation: 'Try again or contact support'
      }]
    }, { status: 500 });
  }
});