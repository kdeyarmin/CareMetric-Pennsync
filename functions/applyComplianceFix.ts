import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { violation_id, apply_to_entity } = await req.json();

    if (!violation_id) {
      return Response.json({ error: 'violation_id is required' }, { status: 400 });
    }

    // Get the violation details
    const violation = await base44.entities.ComplianceViolation.filter({ id: violation_id });
    if (!violation || violation.length === 0) {
      return Response.json({ error: 'Violation not found' }, { status: 404 });
    }

    const violationData = violation[0];

    // Get the entity that has the issue
    const entityType = violationData.entity_type.charAt(0).toUpperCase() + violationData.entity_type.slice(1);
    const entityId = violationData.entity_id;

    if (!entityId) {
      return Response.json({ error: 'No entity_id associated with this violation' }, { status: 400 });
    }

    // Fetch the current entity data
    const entityData = await base44.entities[entityType].filter({ id: entityId });
    if (!entityData || entityData.length === 0) {
      return Response.json({ error: 'Entity not found' }, { status: 404 });
    }

    const currentEntity = entityData[0];

    // Generate AI-powered fix
    let fixedContent;
    if (entityType === 'Visit') {
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a clinical documentation expert. Fix the following compliance issue in the visit documentation.

COMPLIANCE ISSUE:
Rule: ${violationData.rule_name}
Problem: ${violationData.violation_description}
Severity: ${violationData.severity}

CURRENT VISIT NOTES:
${currentEntity.nurse_notes || 'No notes yet'}

CORRECTIVE ACTION NEEDED:
${violationData.recommended_action}

${violationData.suggested_fix ? `SUGGESTED FIX:\n${violationData.suggested_fix}` : ''}

Provide the COMPLETE corrected visit notes with the compliance issue fixed. Maintain the original format and structure, only make necessary changes to resolve the compliance issue.`,
        response_json_schema: {
          type: "object",
          properties: {
            corrected_notes: { type: "string" },
            changes_made: { type: "string" },
            compliance_verified: { type: "boolean" }
          }
        }
      });

      fixedContent = response.corrected_notes;

      // Apply fix to entity if requested
      if (apply_to_entity) {
        await base44.entities.Visit.update(entityId, {
          nurse_notes: fixedContent
        });
      }

      // Mark violation as resolved
      await base44.entities.ComplianceViolation.update(violation_id, {
        status: 'resolved',
        resolved_date: new Date().toISOString(),
        resolved_by: user.email,
        resolution_notes: `Auto-fixed: ${response.changes_made}`
      });

      return Response.json({
        success: true,
        fixed_content: fixedContent,
        changes_made: response.changes_made,
        applied_to_entity: apply_to_entity
      });

    } else if (entityType === 'Careplan') {
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a clinical care planning expert. Fix the following compliance issue in the care plan.

COMPLIANCE ISSUE:
Rule: ${violationData.rule_name}
Problem: ${violationData.violation_description}

CURRENT CARE PLAN:
Problem: ${currentEntity.problem}
Goal: ${currentEntity.goal}
Interventions: ${currentEntity.interventions?.join(', ') || 'None'}

CORRECTIVE ACTION:
${violationData.recommended_action}

Provide corrected care plan components that resolve the compliance issue.`,
        response_json_schema: {
          type: "object",
          properties: {
            corrected_problem: { type: "string" },
            corrected_goal: { type: "string" },
            corrected_interventions: { type: "array", items: { type: "string" } },
            changes_made: { type: "string" }
          }
        }
      });

      // Apply fix to entity if requested
      if (apply_to_entity) {
        await base44.entities.CarePlan.update(entityId, {
          problem: response.corrected_problem,
          goal: response.corrected_goal,
          interventions: response.corrected_interventions
        });
      }

      // Mark violation as resolved
      await base44.entities.ComplianceViolation.update(violation_id, {
        status: 'resolved',
        resolved_date: new Date().toISOString(),
        resolved_by: user.email,
        resolution_notes: `Auto-fixed: ${response.changes_made}`
      });

      return Response.json({
        success: true,
        fixed_content: {
          problem: response.corrected_problem,
          goal: response.corrected_goal,
          interventions: response.corrected_interventions
        },
        changes_made: response.changes_made,
        applied_to_entity: apply_to_entity
      });
    }

    return Response.json({
      success: false,
      message: `Auto-fix not supported for entity type: ${entityType}`
    });

  } catch (error) {
    console.error('Apply compliance fix error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});