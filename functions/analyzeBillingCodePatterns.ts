import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { payload } = await req.json();
    const { payer_id } = payload || {};

    const payers = payer_id 
      ? [await base44.asServiceRole.entities.Payer.get(payer_id)]
      : await base44.asServiceRole.entities.Payer.list('', 500);

    const geminiApiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY');
    
    const prompt = `You are a medical billing optimization expert analyzing billing code patterns.

PAYER BILLING CODE DATA:
${JSON.stringify(payers.map(p => ({
  payer_name: p.payer_name,
  payer_id: p.payer_id,
  payer_type: p.payer_type,
  billing_codes: p.billing_codes
})).filter(p => p.billing_codes && p.billing_codes.length > 0), null, 2)}

Analyze billing code patterns and identify:

1. **Missing Modifiers**: For each billing code, identify commonly missing modifiers that could:
   - Increase reimbursement
   - Improve claim acceptance rates
   - Better reflect service complexity

2. **Optimal Modifier Combinations**: Based on code types and payer requirements, suggest modifier combinations

3. **Pattern-Based Recommendations**: Identify trends across similar payers (same type) for modifier usage

4. **Code-Specific Opportunities**: For high-value codes, suggest optimal modifier strategies

Return JSON:
{
  "payer_specific_recommendations": [
    {
      "payer_id": "database_id",
      "payer_name": "name",
      "recommendations": [
        {
          "code": "99213",
          "code_type": "CPT",
          "current_modifiers": ["25"],
          "suggested_modifiers": ["25", "59"],
          "reason": "Modifier 59 often needed for distinct procedures",
          "potential_impact": "10-15% reimbursement increase",
          "confidence": 85,
          "evidence": "Common in Commercial payers for E/M codes"
        }
      ]
    }
  ],
  "pattern_insights": [
    {
      "pattern": "E/M codes often pair with modifier 25",
      "affected_payer_types": ["Commercial", "Medicare"],
      "recommendation": "Add modifier 25 to all E/M codes",
      "codes_affected": ["99213", "99214"]
    }
  ],
  "missing_code_opportunities": [
    {
      "payer_type": "Medicare",
      "commonly_missing_codes": ["G0438", "G0439"],
      "reason": "Annual wellness visits - high reimbursement, low utilization",
      "recommended_action": "Add these codes to Medicare payers"
    }
  ],
  "optimization_summary": {
    "total_payers_analyzed": 0,
    "total_recommendations": 0,
    "high_confidence_recommendations": 0,
    "estimated_revenue_impact": "description"
  }
}`;

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 8192,
          }
        })
      }
    );

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error('Gemini API error:', errorText);
      return Response.json({ error: 'AI analysis failed', details: errorText }, { status: 500 });
    }

    const geminiData = await geminiResponse.json();
    const analysisText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    
    let cleanedText = analysisText.trim();
    if (cleanedText.startsWith('```json')) {
      cleanedText = cleanedText.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    } else if (cleanedText.startsWith('```')) {
      cleanedText = cleanedText.replace(/^```\n?/, '').replace(/\n?```$/, '');
    }
    
    const analysis = JSON.parse(cleanedText);

    await base44.asServiceRole.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'billing_code_patterns_analyzed',
      details: {
        payer_id: payer_id || 'all',
        total_recommendations: analysis.optimization_summary?.total_recommendations || 0
      },
      page: 'PayerDatabase'
    });

    return Response.json({
      analysis,
      analyzed_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in analyzeBillingCodePatterns:', error);
    return Response.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
});