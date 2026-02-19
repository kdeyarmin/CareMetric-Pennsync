import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import OpenAI from 'npm:openai@4.28.0';

const openai = new OpenAI({
  apiKey: Deno.env.get('OPENAI_API_KEY'),
});

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Use AI to generate simulated regulatory updates
    // In production, this would fetch from CMS.gov API or scrape official sources
    const prompt = `Generate 3 recent Medicare home health regulatory updates for ${new Date().getFullYear()}.
    
Include updates about:
- OASIS-E changes
- PDGM payment adjustments
- Conditions of Participation (CoP)
- Documentation requirements

For each update, provide:
{
  "updates": [
    {
      "title": "string",
      "category": "oasis|pdgm|cop|billing|other",
      "summary": "2-3 sentence summary",
      "effective_date": "YYYY-MM-DD",
      "priority": "critical|high|medium|low",
      "reference_number": "CMS reference number",
      "key_changes": ["change 1", "change 2"],
      "action_items": ["action 1", "action 2"],
      "source_url": "https://cms.gov/...",
      "status": "new"
    }
  ]
}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are a Medicare regulatory compliance expert with deep knowledge of CMS guidelines."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.3
    });

    const { updates } = JSON.parse(completion.choices[0].message.content);

    // Store updates in database
    const createdUpdates = [];
    for (const update of updates) {
      const existing = await base44.asServiceRole.entities.RegulatoryUpdate.filter({
        reference_number: update.reference_number
      });

      if (existing.length === 0) {
        const created = await base44.asServiceRole.entities.RegulatoryUpdate.create(update);
        createdUpdates.push(created);
      }
    }

    return Response.json({
      success: true,
      updates_fetched: updates.length,
      new_updates: createdUpdates.length,
      updates: createdUpdates
    });

  } catch (error) {
    console.error('Fetch regulatory updates error:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});