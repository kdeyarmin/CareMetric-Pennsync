import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { document_content, document_type, patient_id, visit_id, entity_id } = await req.json();

    if (!document_content) {
      return Response.json({ error: 'Document content is required' }, { status: 400 });
    }

    // Fetch all active compliance rules
    const allRules = await base44.asServiceRole.entities.ComplianceRule.list();
    const medicareRules = await base44.asServiceRole.entities.MedicareComplianceRule.list();
    const agencyRules = await base44.asServiceRole.entities.AgencyComplianceRule.filter({ is_active: true });

    // Get patient data for context
    let patientContext = "";
    if (patient_id) {
      try {
        const patient = await base44.entities.Patient.filter({ id: patient_id });
        if (patient[0]) {
          patientContext = `Patient: ${patient[0].first_name} ${patient[0].last_name}, DOB: ${patient[0].date_of_birth || 'N/A'}, Diagnosis: ${patient[0].primary_diagnosis || 'N/A'}`;
        }
      } catch (e) {
        console.log('Could not fetch patient data');
      }
    }

    // Build comprehensive compliance check prompt
    const rulesContext = [
      ...allRules.map(r => `- ${r.rule_name}: ${r.description}`),
      ...medicareRules.map(r => `- Medicare Rule: ${r.description}`),
      ...agencyRules.map(r => `- Agency Rule (${r.category}): ${r.rule_name} - ${r.description}`)
    ].join('\n');

    const prompt = `You are an expert compliance auditor for home health and hospice documentation. Analyze the following ${document_type || 'clinical documentation'} for compliance issues.

${patientContext}

COMPLIANCE RULES TO CHECK:
${rulesContext}

DOCUMENTATION TO ANALYZE:
${document_content}

Perform a comprehensive compliance check and identify:
1. Missing required elements
2. Incomplete documentation
3. Medicare/Medicaid compliance gaps
4. OASIS documentation issues (if applicable)
5. Skilled intervention justification gaps
6. Patient education documentation gaps
7. Homebound status verification issues

For EACH issue found, provide:
- Specific rule violated
- Exact location in document (quote the relevant section)
- Severity (critical, high, medium, low)
- Corrective action needed
- Suggested template text or section to add

Be thorough but practical. Focus on actionable feedback.`;

    const response = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: "object",
        properties: {
          overall_compliance_score: { type: "number" },
          compliance_level: {
            type: "string",
            enum: ["compliant", "minor_issues", "major_issues", "critical_issues"]
          },
          total_issues_found: { type: "number" },
          issues: {
            type: "array",
            items: {
              type: "object",
              properties: {
                rule_name: { type: "string" },
                category: { type: "string" },
                severity: { 
                  type: "string",
                  enum: ["critical", "high", "medium", "low"]
                },
                issue_description: { type: "string" },
                document_quote: { type: "string" },
                corrective_action: { type: "string" },
                suggested_addition: { type: "string" },
                auto_fixable: { type: "boolean" }
              }
            }
          },
          missing_required_elements: {
            type: "array",
            items: { type: "string" }
          },
          strengths: {
            type: "array",
            items: { type: "string" }
          },
          recommendations: {
            type: "array",
            items: { type: "string" }
          }
        }
      }
    });

    // Create compliance audit record
    const auditRecord = await base44.asServiceRole.entities.ComplianceAudit.create({
      nurse_email: user.email,
      nurse_name: user.full_name,
      patient_id: patient_id || null,
      visit_id: visit_id || null,
      audit_date: new Date().toISOString(),
      audit_type: 'automated',
      compliance_score: response.overall_compliance_score,
      status: response.compliance_level === 'compliant' ? 'passed' : 
              response.compliance_level === 'minor_issues' ? 'flagged' :
              'critical',
      issues_found: response.issues || [],
      missing_elements: response.missing_required_elements || [],
      recommendations: response.recommendations || [],
      document_analyzed: document_content.substring(0, 500) + '...'
    });

    // Create compliance violations for critical/high issues
    const criticalIssues = (response.issues || []).filter(i => 
      i.severity === 'critical' || i.severity === 'high'
    );

    for (const issue of criticalIssues) {
      await base44.asServiceRole.entities.ComplianceViolation.create({
        entity_type: 'visit',
        entity_id: visit_id || entity_id,
        user_email: user.email,
        rule_name: issue.rule_name,
        violation_description: issue.issue_description,
        severity: issue.severity,
        status: 'open',
        recommended_action: issue.corrective_action,
        auto_fix_available: issue.auto_fixable || false,
        detection_method: 'automated'
      });
    }

    return Response.json({
      success: true,
      audit_id: auditRecord.id,
      compliance_result: response,
      critical_issues_count: criticalIssues.length
    });

  } catch (error) {
    console.error('Compliance check error:', error);
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});