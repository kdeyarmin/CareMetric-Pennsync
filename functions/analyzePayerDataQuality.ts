import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Authenticate user
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only admins can run data quality checks
    if (user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Fetch all payers
    const payers = await base44.asServiceRole.entities.Payer.list();
    
    if (!payers || payers.length === 0) {
      return Response.json({ 
        duplicates: [],
        billingCodeIssues: [],
        contactIssues: [],
        suggestions: []
      });
    }

    // Prepare data for AI analysis
    const payerSummary = payers.map(p => ({
      id: p.id,
      payer_name: p.payer_name,
      payer_id: p.payer_id,
      payer_type: p.payer_type,
      states: p.states,
      billing_codes: p.billing_codes?.slice(0, 3), // First 3 codes for analysis
      contact_info: p.contact_info
    }));

    const analysisPrompt = `You are a healthcare billing data quality analyst. Analyze this payer database and identify data quality issues.

PAYER DATA:
${JSON.stringify(payerSummary, null, 2)}

Perform the following checks:

1. DUPLICATE DETECTION: Find potential duplicate payers based on:
   - Similar names (accounting for variations like "BCBS" vs "Blue Cross Blue Shield")
   - Same payer_id
   - Same states and payer_type combination
   
2. BILLING CODE INCONSISTENCIES: Identify:
   - Invalid CPT/HCPCS codes (codes that don't match standard formats)
   - Mismatched code descriptions
   - Unusual reimbursement rates (extremely high/low)
   
3. CONTACT INFORMATION ISSUES: Flag:
   - Invalid phone number formats
   - Suspicious or placeholder websites (like "example.com", "test.com")
   - Missing critical contact information
   
4. CORRECTION SUGGESTIONS: For each issue found, suggest specific corrections.

Return your analysis as a JSON object with this EXACT structure:
{
  "duplicates": [
    {
      "payer_ids": ["id1", "id2"],
      "payer_names": ["Name 1", "Name 2"],
      "reason": "explanation",
      "confidence": "high|medium|low",
      "suggested_action": "merge or mark as duplicate"
    }
  ],
  "billingCodeIssues": [
    {
      "payer_id": "id",
      "payer_name": "name",
      "code": "99999",
      "issue": "description of issue",
      "severity": "high|medium|low",
      "suggestion": "recommended fix"
    }
  ],
  "contactIssues": [
    {
      "payer_id": "id",
      "payer_name": "name",
      "field": "phone|website|email",
      "current_value": "value",
      "issue": "description",
      "suggested_correction": "new value or N/A"
    }
  ],
  "suggestions": [
    {
      "category": "duplicate|billing|contact|general",
      "priority": "high|medium|low",
      "description": "overall recommendation",
      "affected_payers": ["id1", "id2"]
    }
  ]
}

Be thorough but only flag genuine issues. Don't flag minor variations that are acceptable.`;

    // Call AI for analysis
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
            temperature: 0.2,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 8192,
          }
        })
      }
    );

    if (!geminiResponse.ok) {
      console.error('Gemini API error:', await geminiResponse.text());
      return Response.json({ error: 'AI analysis failed' }, { status: 500 });
    }

    const geminiData = await geminiResponse.json();
    const analysisText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    
    // Extract JSON from potential markdown code blocks
    let cleanedText = analysisText.trim();
    if (cleanedText.startsWith('```json')) {
      cleanedText = cleanedText.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    } else if (cleanedText.startsWith('```')) {
      cleanedText = cleanedText.replace(/^```\n?/, '').replace(/\n?```$/, '');
    }
    
    const analysis = JSON.parse(cleanedText);

    // Log the analysis
    await base44.asServiceRole.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'payer_data_quality_check',
      details: {
        total_payers: payers.length,
        duplicates_found: analysis.duplicates?.length || 0,
        billing_issues_found: analysis.billingCodeIssues?.length || 0,
        contact_issues_found: analysis.contactIssues?.length || 0
      },
      page: 'PayerDatabase'
    });

    return Response.json({
      duplicates: analysis.duplicates || [],
      billingCodeIssues: analysis.billingCodeIssues || [],
      contactIssues: analysis.contactIssues || [],
      suggestions: analysis.suggestions || [],
      total_payers_analyzed: payers.length,
      analysis_date: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in analyzePayerDataQuality:', error);
    return Response.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
});