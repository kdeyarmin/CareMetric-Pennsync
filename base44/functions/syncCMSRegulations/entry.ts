import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Verify admin access
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
    }

    // Fetch latest CMS regulations from internet with AI analysis
    const regulationsUpdate = await base44.integrations.Core.InvokeLLM({
      model: "claude_opus_4_8",
      prompt: `You are a Medicare home health compliance expert. Search the internet for the LATEST CMS regulations and updates for home health agencies as of December 2025.

Focus on:
1. Recent CMS policy changes (2024-2025)
2. OASIS-E documentation requirements
3. Medicare Conditions of Participation updates
4. PDGM clinical grouping changes
5. Documentation and billing requirements
6. Telehealth and remote patient monitoring guidelines
7. Quality reporting requirements (HH CAHPS, HHCAHPS, OASIS)

For EACH regulation found, provide:
- Regulation title and CMS reference number
- Effective date
- Summary of key changes
- Impact on home health agencies (critical/high/medium/low)
- Required actions for compliance
- Documentation requirements
- Link to official CMS source (if available)

Search multiple sources including CMS.gov, Medicare Learning Network, and recent Federal Register updates.

Return comprehensive, actionable compliance information.`,
      add_context_from_internet: true,
      response_json_schema: {
        type: "object",
        properties: {
          sync_date: { type: "string" },
          regulations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                cms_reference: { type: "string" },
                effective_date: { type: "string" },
                category: { type: "string" },
                summary: { type: "string" },
                impact_level: { type: "string" },
                required_actions: {
                  type: "array",
                  items: { type: "string" }
                },
                documentation_requirements: {
                  type: "array",
                  items: { type: "string" }
                },
                source_url: { type: "string" },
                compliance_deadline: { type: "string" }
              }
            }
          },
          recent_updates: {
            type: "array",
            items: {
              type: "object",
              properties: {
                date: { type: "string" },
                title: { type: "string" },
                description: { type: "string" },
                urgency: { type: "string" }
              }
            }
          },
          key_changes_summary: { type: "string" }
        }
      }
    });

    // Store regulations in database
    const regulationRecords = [];
    for (const reg of regulationsUpdate.regulations || []) {
      try {
        const record = await base44.asServiceRole.entities.RegulatoryUpdate.create({
          title: reg.title,
          source: reg.cms_reference?.includes('Medicare') ? 'Medicare' : 'CMS',
          category: reg.category || 'documentation',
          effective_date: reg.effective_date || new Date().toISOString().split('T')[0],
          summary: reg.summary,
          full_details: `${reg.summary}\n\nRequired Actions:\n${reg.required_actions?.join('\n- ') || 'None specified'}\n\nDocumentation Requirements:\n${reg.documentation_requirements?.join('\n- ') || 'None specified'}`,
          impact_level: reg.impact_level || 'medium',
          affected_areas: [reg.category],
          required_actions: reg.required_actions || [],
          status: 'pending_review',
          reference_url: reg.source_url || null,
          reviewed_by: null,
          reviewed_at: null
        });
        regulationRecords.push(record);
      } catch (error) {
        console.error('Error creating regulation record:', error);
      }
    }

    // Log the sync activity
    await base44.asServiceRole.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'cms_regulations_sync',
      details: {
        regulations_found: regulationsUpdate.regulations?.length || 0,
        regulations_stored: regulationRecords.length,
        sync_timestamp: new Date().toISOString(),
        recent_updates: regulationsUpdate.recent_updates?.length || 0
      },
      page: 'Admin'
    });

    return Response.json({
      success: true,
      sync_date: regulationsUpdate.sync_date || new Date().toISOString(),
      regulations_count: regulationRecords.length,
      recent_updates: regulationsUpdate.recent_updates || [],
      key_changes_summary: regulationsUpdate.key_changes_summary || 'No major changes detected',
      regulations: regulationRecords
    });

  } catch (error) {
    console.error('CMS regulations sync error:', error);
    return Response.json({
      success: false,
      error: error.message || 'Failed to sync CMS regulations'
    }, { status: 500 });
  }
});