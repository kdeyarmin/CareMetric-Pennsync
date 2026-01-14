import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // This function runs as a scheduled task (admin-only trigger)
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // Fetch latest regulatory changes using AI with web search
    const monitoringPrompt = `Search for recent healthcare regulatory changes (last 30 days):

FOCUS AREAS:
1. Medicare/CMS updates
2. Home health regulations (42 CFR Part 484)
3. Hospice regulations
4. OASIS updates
5. Documentation requirements
6. Billing/coding changes
7. State-specific healthcare regulations (focus on major states)

For each significant change found, provide:
- Title
- Summary (2-3 sentences)
- Detailed description
- Effective date
- Severity (critical/high/medium/low)
- Category (documentation/oasis/safety/billing/quality/infection_control/patient_rights/hipaa/staffing)
- Impact level (critical/high/medium/low)
- Provider types affected (RN, LPN, PT, OT, ST, MD, DO, NP, etc.)
- Action required (if any)
- Compliance deadline (if applicable)
- Source/regulation reference
- Reference URL

Return JSON array of updates.`;

    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: monitoringPrompt,
      add_context_from_internet: true,
      response_json_schema: {
        type: "object",
        properties: {
          updates: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                summary: { type: "string" },
                detailed_description: { type: "string" },
                effective_date: { type: "string" },
                severity: { type: "string" },
                category: { type: "string" },
                impact_level: { type: "string" },
                affected_provider_types: {
                  type: "array",
                  items: { type: "string" }
                },
                action_required: { type: "string" },
                compliance_deadline: { type: "string" },
                regulation_source: { type: "string" },
                reference_url: { type: "string" }
              }
            }
          }
        }
      }
    });

    // Batch check for duplicates & create new updates in parallel
    const updates = result.updates || [];
    
    // Get all existing titles in one query (not one per update)
    const existingUpdates = await base44.asServiceRole.entities.RegulatoryUpdate.filter({});
    const existingTitles = new Set(existingUpdates.map(u => u.title));

    // Filter only new updates
    const newUpdates = updates.filter(update => !existingTitles.has(update.title));

    // Batch create all new updates at once
    const createdUpdates = newUpdates.length > 0 ? 
      await base44.asServiceRole.entities.RegulatoryUpdate.bulkCreate(
        newUpdates.map(update => ({
          title: update.title,
          source: update.regulation_source || 'CMS',
          category: update.category || 'quality',
          effective_date: update.effective_date,
          summary: update.summary,
          full_details: update.detailed_description,
          impact_level: update.impact_level || 'medium',
          affected_areas: update.affected_provider_types || [],
          required_actions: [update.action_required].filter(Boolean),
          suggested_training: [],
          status: 'pending_review',
          reference_url: update.reference_url
        }))
      ) : [];

    console.log(`Regulatory monitoring complete: ${createdUpdates.length} new updates`);

    return Response.json({
      success: true,
      updatesFound: result.updates?.length || 0,
      newUpdatesCreated: createdUpdates.length,
      updates: createdUpdates
    });
  } catch (error) {
    console.error('Error monitoring regulatory changes:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});