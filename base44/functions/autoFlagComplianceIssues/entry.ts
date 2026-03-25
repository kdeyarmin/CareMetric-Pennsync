import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json();
    
    const { event, data } = payload;
    
    if (!data) {
      return Response.json({ 
        success: false, 
        message: 'No data provided in payload' 
      });
    }

    // Get all compliance rules to check against
    const [complianceRules, agencyComplianceRules] = await Promise.all([
      base44.asServiceRole.entities.ComplianceRule.list(),
      base44.asServiceRole.entities.AgencyComplianceRule.list()
    ]);

    const allRules = [...complianceRules, ...agencyComplianceRules];

    if (allRules.length === 0) {
      return Response.json({ 
        success: true, 
        message: 'No compliance rules configured',
        violations: 0
      });
    }

    // Prepare document content for analysis
    let documentContent = '';
    let documentType = event.entity_name;
    let userEmail = data.created_by;

    if (event.entity_name === 'Visit') {
      documentContent = [
        data.nurse_notes,
        data.raw_transcription,
        JSON.stringify(data.vital_signs)
      ].filter(Boolean).join('\n\n');
    } else if (event.entity_name === 'CarePlan') {
      documentContent = [
        `Problem: ${data.problem}`,
        `Goal: ${data.goal}`,
        `Interventions: ${data.interventions?.join(', ')}`,
        data.baseline_measurement,
        data.current_measurement
      ].filter(Boolean).join('\n\n');
    } else {
      // Generic handling for other entities
      documentContent = JSON.stringify(data, null, 2);
    }

    if (!documentContent || documentContent.trim().length < 20) {
      return Response.json({ 
        success: true, 
        message: 'Document too short for compliance analysis',
        violations: 0
      });
    }

    // Analyze document against all active rules
    const rulesForAnalysis = allRules
      .filter(rule => rule.is_active !== false)
      .slice(0, 15); // Limit to 15 rules to avoid timeout

    const analysisPrompt = `You are a healthcare compliance expert specializing in HIPAA, Medicare/Medicaid regulations, and clinical documentation standards. Analyze the following clinical documentation for compliance violations.

DOCUMENTATION TYPE: ${documentType}
CREATED BY: ${userEmail}

DOCUMENT CONTENT:
${documentContent}

COMPLIANCE RULES TO CHECK:
${rulesForAnalysis.map((rule, idx) => `
${idx + 1}. ${rule.rule_name} (${rule.category} - ${rule.severity})
   Description: ${rule.description}
   Required Elements: ${rule.required_elements?.join(', ') || 'None specified'}
   Validation Logic: ${rule.validation_logic || 'Check for presence of required elements'}
   Auto-Fix Template: ${rule.fix_template || 'Not available'}
`).join('\n')}

Analyze the documentation thoroughly and identify ANY violations of the above rules. For each violation found, provide:
- rule_name: Which rule was violated (exact name from above)
- rule_category: Category of the rule
- violation_description: Specific and clear description of what is missing or incorrect
- severity: Use the severity from the rule definition
- recommended_action: Step-by-step guidance on how to fix this issue
- auto_fix_available: true if this can be auto-corrected (simple additions, formatting fixes, missing required fields), false for complex clinical judgments
- suggested_fix: Specific text or correction to apply (be detailed and ready to copy-paste)
- explanation: Brief explanation of why this rule is important for compliance

Be thorough but practical. Focus on actionable violations that can realistically be addressed.

Return violations found. If no violations, return empty array.`;

    const response = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: analysisPrompt,
      response_json_schema: {
        type: "object",
        properties: {
          violations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                rule_name: { type: "string" },
                rule_category: { type: "string" },
                violation_description: { type: "string" },
                severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
                recommended_action: { type: "string" },
                auto_fix_available: { type: "boolean" },
                suggested_fix: { type: "string" },
                explanation: { type: "string" }
              }
            }
          },
          overall_compliance_score: { type: "number" },
          summary: { type: "string" }
        }
      }
    });

    const violations = response.violations || [];
    const violationsCreated = [];

    // Create ComplianceViolation records for each issue found
    for (const violation of violations) {
      const violationRecord = await base44.asServiceRole.entities.ComplianceViolation.create({
        entity_type: event.entity_name.toLowerCase(),
        entity_id: data.id,
        user_email: userEmail,
        rule_name: violation.rule_name,
        rule_category: violation.rule_category,
        violation_description: violation.violation_description,
        severity: violation.severity,
        status: 'open',
        recommended_action: violation.recommended_action,
        auto_fix_available: violation.auto_fix_available || false,
        suggested_fix: violation.suggested_fix || null,
        detection_method: 'automated',
        document_analyzed: documentContent.substring(0, 1000) // Store excerpt
      });
      
      violationsCreated.push(violationRecord);
    }

    // Create ComplianceAudit record
    const auditStatus = violations.length === 0 ? 'passed' :
      violations.some(v => v.severity === 'critical') ? 'critical' :
      'flagged';

    await base44.asServiceRole.entities.ComplianceAudit.create({
      nurse_email: userEmail,
      nurse_name: userEmail,
      audit_date: new Date().toISOString(),
      audit_type: `auto_${documentType.toLowerCase()}`,
      compliance_score: response.overall_compliance_score || (violations.length === 0 ? 100 : 75),
      status: auditStatus,
      issues_found: violations.map(v => ({
        rule: v.rule_name,
        severity: v.severity,
        description: v.violation_description
      })),
      recommendations: violations.map(v => v.recommended_action).filter(Boolean),
      document_analyzed: documentContent.substring(0, 500)
    });

    return Response.json({
      success: true,
      violations_found: violations.length,
      violations_created: violationsCreated.length,
      audit_status: auditStatus,
      compliance_score: response.overall_compliance_score,
      summary: response.summary
    });

  } catch (error) {
    console.error('Auto-flag compliance error:', error);
    return Response.json({ 
      error: error.message,
      success: false
    }, { status: 500 });
  }
});