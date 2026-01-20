import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized - Admin only' }, { status: 403 });
    }

    const payers = await base44.asServiceRole.entities.Payer.list('', 1000);

    const geminiApiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY');
    
    const prompt = `You are a data quality expert analyzing healthcare payer data for duplicates.

PAYER DATA:
${JSON.stringify(payers.map(p => ({
  id: p.id,
  payer_name: p.payer_name,
  payer_id: p.payer_id,
  payer_type: p.payer_type,
  states: p.states,
  electronic_submission_id: p.electronic_submission_id
})), null, 2)}

Identify potential duplicate payers based on:
1. Name similarity (e.g., "BCBS CALIFORNIA" vs "BLUE CROSS BLUE SHIELD CALIFORNIA")
2. Same payer_id but different names
3. Same electronic_submission_id
4. Very similar names with overlapping states and same payer type
5. Common variations (BCBS = Blue Cross Blue Shield, etc.)

For each duplicate group, calculate a confidence score (0-100) based on:
- Exact payer_id match = 100
- Electronic submission ID match = 95
- Name similarity + state overlap + same type = 70-90
- Name similarity only = 40-60

Return JSON array of duplicate groups:
[
  {
    "confidence_score": 95,
    "reason": "Same payer ID (60054) but different names",
    "primary_payer": {
      "id": "payer_id_1",
      "payer_name": "name",
      "payer_id": "60054"
    },
    "duplicates": [
      {
        "id": "payer_id_2",
        "payer_name": "name",
        "payer_id": "60054",
        "similarity_factors": ["same_payer_id", "overlapping_states"]
      }
    ],
    "suggested_action": "Merge into primary payer",
    "merged_data_preview": {
      "payer_name": "recommended name",
      "states": ["combined states"],
      "notes": "combined information"
    }
  }
]

Only return groups with confidence >= 60.`;

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
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
      return Response.json({ error: 'AI analysis failed', details: errorText }, { status: 500 });
    }

    const geminiData = await geminiResponse.json();
    const analysisText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    
    let cleanedText = analysisText.trim();
    if (cleanedText.startsWith('```json')) {
      cleanedText = cleanedText.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    } else if (cleanedText.startsWith('```')) {
      cleanedText = cleanedText.replace(/^```\n?/, '').replace(/\n?```$/, '');
    }
    
    const duplicateGroups = JSON.parse(cleanedText);

    await base44.asServiceRole.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'duplicate_payers_detected',
      details: {
        duplicate_groups_found: duplicateGroups.length,
        total_duplicates: duplicateGroups.reduce((sum, g) => sum + g.duplicates.length, 0)
      },
      page: 'PayerDatabase'
    });

    return Response.json({
      duplicate_groups: duplicateGroups,
      total_groups: duplicateGroups.length,
      analyzed_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in detectDuplicatePayers:', error);
    return Response.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
});