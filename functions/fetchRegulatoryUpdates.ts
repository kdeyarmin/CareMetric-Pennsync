import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import OpenAI from 'npm:openai@4.28.0';

const openai = new OpenAI({
  apiKey: Deno.env.get('OPENAI_API_KEY'),
});

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const searchPrompt = `Find recent (last 7 days) significant regulatory updates for healthcare providers including home health, hospice, outpatient, and clinical practice from CMS or Medicare. Focus on changes to documentation, billing, quality reporting, or patient care standards. Provide JSON format with array "regulatory_updates" containing: title, source (CMS/Medicare/etc), category (documentation/oasis/billing/etc), effective_date (YYYY-MM-DD), summary, full_details, impact_level (critical/high/medium/low), affected_areas (array), required_actions (array), reference_url.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a regulatory affairs specialist. Identify and summarize new healthcare regulations from reputable sources."
        },
        {
          role: "user",
          content: searchPrompt
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 1000
    });

    const aiResult = JSON.parse(response.choices[0].message.content);
    const regulatoryChanges = aiResult.regulatory_updates || [];

    let newUpdatesCount = 0;

    for (const change of regulatoryChanges) {
      const existingUpdates = await base44.asServiceRole.entities.RegulatoryUpdate.filter({
        title: change.title,
        source: change.source,
        effective_date: change.effective_date
      });

      if (existingUpdates.length === 0) {
        await base44.asServiceRole.entities.RegulatoryUpdate.create({
          title: change.title,
          source: change.source || 'CMS',
          category: change.category || 'documentation',
          effective_date: change.effective_date || new Date().toISOString().split('T')[0],
          summary: change.summary,
          full_details: change.full_details || change.summary,
          impact_level: change.impact_level || 'medium',
          affected_areas: change.affected_areas || ['all'],
          required_actions: change.required_actions || [],
          reference_url: change.reference_url,
          status: 'pending_review',
        });
        newUpdatesCount++;
      }
    }

    return Response.json({
      success: true,
      message: `Checked for regulatory updates. ${newUpdatesCount} new updates added.`,
      updates_fetched: regulatoryChanges.length,
      new_updates_added: newUpdatesCount
    });

  } catch (error) {
    console.error('Error fetching regulatory updates:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});