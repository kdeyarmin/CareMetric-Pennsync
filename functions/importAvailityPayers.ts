import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized - Admin only' }, { status: 403 });
    }

    const { payload } = await req.json();
    const { payer_data_raw } = payload;

    // Use Gemini to intelligently categorize payers
    const geminiApiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY');
    
    const prompt = `You are a healthcare insurance expert. Process this list of payers from Availity and categorize each one.

PAYER DATA:
${JSON.stringify(payer_data_raw, null, 2)}

For each payer, determine:
1. payer_type: "Medicare", "Medicaid", "Commercial", "Managed Care", or "Other"
2. states: Array of 2-letter state codes the payer operates in (infer from name if possible, otherwise use ["All"])
3. Set applicable_provider_types to ["All"] for all payers

Guidelines:
- If name contains "Medicaid", "STAR", "CHIP", "Healthy Blue" → payer_type: "Medicaid"
- If name contains "Medicare", "Medicare Advantage" → payer_type: "Medicare"  
- If name contains specific state name (e.g., "Arizona", "California", "NY") → add that state code
- If name contains "BCBS", "Blue Cross" → payer_type: "Commercial"
- If name contains "Managed Care", "HMO", "PPO" → payer_type: "Managed Care"
- State names: CA=California, NY=New York, TX=Texas, FL=Florida, AZ=Arizona, etc.

Return JSON array:
[
  {
    "payer_name": "original name",
    "payer_id": "id from data",
    "payer_type": "Commercial",
    "states": ["CA"],
    "applicable_provider_types": ["All"],
    "electronic_submission_id": "id from data",
    "is_active": true
  }
]`;

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
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
      const errorText = await geminiResponse.text();
      console.error('Gemini API error:', errorText);
      return Response.json({ error: 'AI categorization failed', details: errorText }, { status: 500 });
    }

    const geminiData = await geminiResponse.json();
    const analysisText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    
    // Extract JSON from markdown
    let cleanedText = analysisText.trim();
    if (cleanedText.startsWith('```json')) {
      cleanedText = cleanedText.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    } else if (cleanedText.startsWith('```')) {
      cleanedText = cleanedText.replace(/^```\n?/, '').replace(/\n?```$/, '');
    }
    
    const categorizedPayers = JSON.parse(cleanedText);

    // Check for duplicates before inserting
    const existingPayers = await base44.asServiceRole.entities.Payer.list('', 1000);
    const existingPayerIds = new Set(existingPayers.map(p => p.payer_id?.toLowerCase()));
    const existingPayerNames = new Set(existingPayers.map(p => p.payer_name?.toLowerCase()));

    const newPayers = categorizedPayers.filter(payer => {
      const isDuplicateById = payer.payer_id && existingPayerIds.has(payer.payer_id.toLowerCase());
      const isDuplicateByName = existingPayerNames.has(payer.payer_name.toLowerCase());
      return !isDuplicateById && !isDuplicateByName;
    });

    // Insert in batches to avoid timeout
    const batchSize = 50;
    let insertedCount = 0;
    
    for (let i = 0; i < newPayers.length; i += batchSize) {
      const batch = newPayers.slice(i, i + batchSize);
      await base44.asServiceRole.entities.Payer.bulkCreate(batch);
      insertedCount += batch.length;
    }

    // Log activity
    await base44.asServiceRole.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'availity_payers_imported',
      details: {
        total_payers_processed: categorizedPayers.length,
        new_payers_added: insertedCount,
        duplicates_skipped: categorizedPayers.length - insertedCount
      },
      page: 'PayerDatabase'
    });

    return Response.json({
      success: true,
      total_processed: categorizedPayers.length,
      new_payers_added: insertedCount,
      duplicates_skipped: categorizedPayers.length - insertedCount,
      message: `Successfully imported ${insertedCount} new payers`
    });

  } catch (error) {
    console.error('Error in importAvailityPayers:', error);
    return Response.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
});