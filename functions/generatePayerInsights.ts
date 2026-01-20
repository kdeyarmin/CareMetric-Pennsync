import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { payload } = await req.json();
    const { insight_type, payer_id, service_code } = payload || {};

    // Fetch payers and feedback data
    const payers = await base44.asServiceRole.entities.Payer.list('', 500);
    const feedback = await base44.asServiceRole.entities.PayerFeedback.list('', 500);

    let analysisPrompt = '';
    
    if (insight_type === 'reimbursement_prediction') {
      // Predict reimbursement rates for new codes
      analysisPrompt = `You are a healthcare billing analytics expert. Analyze this payer database to predict reimbursement rates.

PAYER DATA WITH BILLING CODES:
${JSON.stringify(payers.map(p => ({
  payer_name: p.payer_name,
  payer_type: p.payer_type,
  states: p.states,
  billing_codes: p.billing_codes
})), null, 2)}

SERVICE CODE TO ANALYZE: ${service_code || 'General analysis'}

Analyze the reimbursement patterns and provide predictions:
1. Average reimbursement rates by payer type (Medicare, Medicaid, Commercial, etc.)
2. State-by-state variations in reimbursement
3. Predicted reimbursement range for the specified code (if provided)
4. Factors affecting reimbursement rates
5. Top paying payers for this service

Return JSON:
{
  "code_analyzed": "code",
  "predicted_range": "range",
  "average_by_payer_type": {
    "Medicare": "range",
    "Medicaid": "range",
    "Commercial": "range"
  },
  "state_variations": [
    {"state": "CA", "avg_rate": "range", "note": "explanation"}
  ],
  "top_payers": [
    {"payer_name": "name", "rate": "range", "notes": "why"}
  ],
  "factors_affecting_rate": ["factor1", "factor2"],
  "recommendations": ["recommendation1", "recommendation2"]
}`;
    
    } else if (insight_type === 'denial_risk_analysis') {
      // Identify payers with high denial rates
      analysisPrompt = `You are a healthcare billing expert analyzing prior authorization patterns.

PAYER DATA:
${JSON.stringify(payers.map(p => ({
  payer_name: p.payer_name,
  payer_type: p.payer_type,
  states: p.states,
  prior_authorization_required: p.prior_authorization_required,
  general_requirements: p.general_requirements,
  billing_codes: p.billing_codes
})), null, 2)}

USER FEEDBACK DATA:
${JSON.stringify(feedback.map(f => ({
  payer_id: f.payer_id,
  ease_of_billing: f.ease_of_billing,
  accuracy_rating: f.accuracy_rating,
  feedback_text: f.feedback_text,
  category: f.category
})), null, 2)}

SERVICE CODE: ${service_code || 'General analysis'}

Analyze and identify:
1. Payers with strict authorization requirements
2. Payers with lowest ease_of_billing ratings
3. Common denial reasons based on requirements
4. High-risk payers for the specified service

Return JSON:
{
  "high_risk_payers": [
    {
      "payer_name": "name",
      "risk_level": "high|medium|low",
      "risk_score": 0-100,
      "reasons": ["reason1", "reason2"],
      "mitigation_strategies": ["strategy1", "strategy2"]
    }
  ],
  "denial_patterns": [
    {"pattern": "description", "affected_payers": ["payer1", "payer2"]}
  ],
  "recommendations": ["rec1", "rec2"]
}`;

    } else if (insight_type === 'modifier_optimization') {
      // Recommend optimal billing modifiers
      analysisPrompt = `You are a medical coding expert analyzing billing modifier patterns.

PAYER BILLING CODE DATA:
${JSON.stringify(payers.map(p => ({
  payer_name: p.payer_name,
  payer_type: p.payer_type,
  billing_codes: p.billing_codes
})), null, 2)}

SERVICE CODE: ${service_code || 'General analysis'}

Analyze modifier patterns and provide recommendations:
1. Most commonly required modifiers by payer type
2. Payer-specific modifier requirements
3. Modifiers that increase reimbursement
4. Common modifier mistakes to avoid

Return JSON:
{
  "recommended_modifiers": [
    {
      "modifier": "25",
      "description": "what it means",
      "when_to_use": "explanation",
      "payers_requiring": ["payer1", "payer2"],
      "impact_on_reimbursement": "description"
    }
  ],
  "payer_specific_tips": [
    {
      "payer_type": "Medicare",
      "modifiers": ["25", "59"],
      "tips": "specific tips"
    }
  ],
  "common_mistakes": [
    {"mistake": "description", "correction": "how to fix"}
  ],
  "optimization_opportunities": ["opportunity1", "opportunity2"]
}`;

    } else {
      // Comprehensive insights
      analysisPrompt = `You are a healthcare billing intelligence analyst. Provide comprehensive insights on this payer database.

PAYER DATA:
${JSON.stringify(payers.map(p => ({
  payer_name: p.payer_name,
  payer_type: p.payer_type,
  states: p.states,
  billing_codes: p.billing_codes,
  timely_filing_limit_days: p.timely_filing_limit_days
})), null, 2)}

FEEDBACK DATA:
${JSON.stringify(feedback, null, 2)}

Provide comprehensive insights including:
1. Overall database statistics and trends
2. Payer coverage gaps by state
3. Billing efficiency opportunities
4. Risk areas needing attention

Return JSON:
{
  "database_stats": {
    "total_payers": 0,
    "by_type": {},
    "state_coverage": []
  },
  "coverage_gaps": [
    {"state": "state", "missing_payer_types": ["type1"], "impact": "description"}
  ],
  "efficiency_opportunities": [
    {"opportunity": "description", "potential_impact": "impact", "action": "what to do"}
  ],
  "risk_areas": [
    {"area": "description", "severity": "high|medium|low", "recommendation": "what to do"}
  ],
  "top_recommendations": ["rec1", "rec2", "rec3"]
}`;
    }

    // Call Gemini AI
    const geminiApiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY');
    
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: analysisPrompt }]
          }],
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
    
    // Extract JSON from markdown code blocks
    let cleanedText = analysisText.trim();
    if (cleanedText.startsWith('```json')) {
      cleanedText = cleanedText.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    } else if (cleanedText.startsWith('```')) {
      cleanedText = cleanedText.replace(/^```\n?/, '').replace(/\n?```$/, '');
    }
    
    const insights = JSON.parse(cleanedText);

    // Log activity
    await base44.asServiceRole.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'payer_insights_generated',
      details: {
        insight_type: insight_type || 'comprehensive',
        service_code: service_code
      },
      page: 'PayerDatabase'
    });

    return Response.json({
      insights,
      insight_type: insight_type || 'comprehensive',
      generated_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in generatePayerInsights:', error);
    return Response.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
});