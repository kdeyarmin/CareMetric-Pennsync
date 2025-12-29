import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized - Admin only' }, { status: 401 });
    }

    // Fetch latest CMS regulations with live internet context
    const regulatoryUpdate = await base44.integrations.Core.InvokeLLM({
      prompt: `You are a Medicare regulatory compliance expert. Research and compile the LATEST 2025 Medicare home health compliance requirements.

Search for and identify:
1. Recent CMS regulatory updates for home health (2024-2025)
2. Changes to 42 CFR 484 Conditions of Participation
3. OASIS-E documentation requirements
4. PDGM billing and documentation rules
5. Quality reporting program updates

For EACH regulation/rule identified, provide:
- Rule name and official reference (CoP section, CMS transmittal #)
- Category (clinical_documentation, billing, safety, quality, etc.)
- Effective date
- Required elements for compliance
- Common violations and how to avoid them
- Severity if violated (critical, high, medium, low)
- Example compliant documentation
- Applicable visit types

Focus on actionable, current requirements that nurses must follow in 2025.`,
      add_context_from_internet: true,
      response_json_schema: {
        type: "object",
        properties: {
          regulations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                rule_name: { type: "string" },
                rule_code: { type: "string" },
                category: { type: "string" },
                description: { type: "string" },
                required_elements: { type: "array", items: { type: "string" } },
                severity: { type: "string" },
                effective_date: { type: "string" },
                applies_to_visit_types: { type: "array", items: { type: "string" } },
                common_violations: { type: "array", items: { type: "string" } },
                compliant_example: { type: "string" },
                penalty_description: { type: "string" },
                remediation_steps: { type: "array", items: { type: "string" } }
              }
            }
          },
          summary: { type: "string" },
          major_changes_2025: { type: "array", items: { type: "string" } }
        }
      }
    });

    let savedCount = 0;
    let updatedCount = 0;
    
    // Save or update ComplianceRule entities
    for (const reg of regulatoryUpdate.regulations) {
      try {
        const existing = await base44.asServiceRole.entities.ComplianceRule.filter({
          rule_code: reg.rule_code
        });

        const ruleData = {
          rule_name: reg.rule_name,
          rule_category: reg.category || 'medicare_cop',
          rule_code: reg.rule_code,
          description: reg.description,
          required_elements: reg.required_elements || [],
          severity: reg.severity || 'medium',
          applies_to_visit_types: reg.applies_to_visit_types || [],
          penalty_description: reg.penalty_description,
          remediation_steps: reg.remediation_steps || [],
          effective_date: reg.effective_date || new Date().toISOString().split('T')[0],
          is_active: true,
          keywords: reg.required_elements || []
        };

        if (existing.length > 0) {
          await base44.asServiceRole.entities.ComplianceRule.update(existing[0].id, ruleData);
          updatedCount++;
        } else {
          await base44.asServiceRole.entities.ComplianceRule.create(ruleData);
          savedCount++;
        }
      } catch (error) {
        console.error(`Error saving rule ${reg.rule_code}:`, error.message);
      }
    }

    // Also create RegulatoryUpdate records for tracking
    if (regulatoryUpdate.major_changes_2025?.length > 0) {
      for (const change of regulatoryUpdate.major_changes_2025.slice(0, 5)) {
        try {
          await base44.asServiceRole.entities.RegulatoryUpdate.create({
            title: change,
            source: 'CMS',
            category: 'documentation',
            effective_date: new Date().toISOString().split('T')[0],
            summary: change,
            full_details: regulatoryUpdate.summary || change,
            impact_level: 'high',
            status: 'pending_review',
            affected_areas: ['clinical_documentation'],
            required_actions: ['Review updated requirements', 'Update documentation practices']
          });
        } catch (error) {
          console.error('Error creating regulatory update:', error.message);
        }
      }
    }

    return Response.json({
      success: true,
      message: 'Successfully synced latest CMS regulations',
      details: {
        new_rules: savedCount,
        updated_rules: updatedCount,
        total_processed: regulatoryUpdate.regulations.length,
        major_changes: regulatoryUpdate.major_changes_2025?.length || 0,
        summary: regulatoryUpdate.summary
      }
    });

  } catch (error) {
    console.error('Sync CMS regulations error:', error);
    return Response.json(
      { error: 'Failed to sync CMS regulations', details: error.message },
      { status: 500 }
    );
  }
});