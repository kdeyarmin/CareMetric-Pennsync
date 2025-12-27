import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 401 });
    }

    const { audit_ids } = await req.json();

    if (!audit_ids || !Array.isArray(audit_ids) || audit_ids.length === 0) {
      return Response.json({ error: 'Audit IDs array is required' }, { status: 400 });
    }

    const results = [];

    // Process each flagged audit
    for (const auditId of audit_ids) {
      const audit = await base44.asServiceRole.entities.ComplianceAudit.filter({ id: auditId });
      
      if (audit.length === 0) continue;
      
      const auditRecord = audit[0];
      
      // Get the associated visit and patient data
      const visit = await base44.asServiceRole.entities.Visit.filter({ id: auditRecord.visit_id });
      if (visit.length === 0) continue;
      
      const patient = await base44.asServiceRole.entities.Patient.filter({ id: visit[0].patient_id });
      
      // Prepare context for AI analysis
      const context = {
        visit_type: visit[0].visit_type,
        nurse_notes: visit[0].nurse_notes || '',
        vital_signs: visit[0].vital_signs || {},
        patient_diagnosis: patient[0]?.primary_diagnosis || '',
        compliance_score: auditRecord.compliance_score,
        existing_issues: auditRecord.issues || []
      };

      // Use AI to perform deep compliance analysis
      const aiAnalysis = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a Medicare compliance expert reviewing home health documentation.

VISIT CONTEXT:
- Visit Type: ${context.visit_type}
- Patient Diagnosis: ${context.patient_diagnosis}
- Compliance Score: ${context.compliance_score}/100
- Current Nurse Notes: ${context.nurse_notes}
- Vital Signs: ${JSON.stringify(context.vital_signs)}

EXISTING FLAGGED ISSUES:
${JSON.stringify(context.existing_issues, null, 2)}

Perform a comprehensive compliance audit and provide:
1. Risk Assessment: Identify all compliance risks (critical, high, medium, low)
2. Specific Corrections: Provide exact wording/changes needed for each issue
3. Missing Elements: Identify required documentation elements that are missing
4. Best Practice Recommendations: Suggest improvements beyond minimum compliance
5. Regulatory Citations: Reference specific Medicare/CMS requirements violated

Be thorough, specific, and actionable in your recommendations.`,
        response_json_schema: {
          type: "object",
          properties: {
            overall_risk_level: {
              type: "string",
              enum: ["critical", "high", "medium", "low"]
            },
            risk_score: {
              type: "number",
              description: "0-100 risk score, higher is more risky"
            },
            compliance_risks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  severity: { type: "string" },
                  description: { type: "string" },
                  regulatory_reference: { type: "string" },
                  potential_impact: { type: "string" }
                }
              }
            },
            suggested_corrections: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  issue: { type: "string" },
                  current_text: { type: "string" },
                  suggested_text: { type: "string" },
                  rationale: { type: "string" }
                }
              }
            },
            missing_elements: {
              type: "array",
              items: { type: "string" }
            },
            best_practices: {
              type: "array",
              items: { type: "string" }
            },
            audit_summary: { type: "string" }
          }
        }
      });

      // Update the audit record with AI findings
      await base44.asServiceRole.entities.ComplianceAudit.update(auditRecord.id, {
        status: aiAnalysis.overall_risk_level === 'critical' || aiAnalysis.overall_risk_level === 'high' 
          ? 'critical' 
          : 'flagged',
        review_notes: aiAnalysis.audit_summary,
        reviewed_by: 'AI Audit System',
        reviewed_at: new Date().toISOString()
      });

      // Log the audit for tracking
      await base44.asServiceRole.entities.SystemLog.create({
        log_type: 'ai_compliance_audit',
        severity: aiAnalysis.overall_risk_level,
        message: `AI audit completed for visit ${auditRecord.visit_id}`,
        details: {
          audit_id: auditRecord.id,
          risk_score: aiAnalysis.risk_score,
          risks_identified: aiAnalysis.compliance_risks.length
        },
        user_email: user.email
      });

      results.push({
        audit_id: auditRecord.id,
        visit_id: auditRecord.visit_id,
        nurse_email: auditRecord.nurse_email,
        analysis: aiAnalysis
      });
    }

    // Generate summary audit report
    const reportSummary = await base44.integrations.Core.InvokeLLM({
      prompt: `Generate an executive summary for this batch compliance audit:

Total Audits Reviewed: ${results.length}

Results Summary:
${results.map(r => `
- Audit ${r.audit_id}: Risk Level ${r.analysis.overall_risk_level} (Score: ${r.analysis.risk_score})
  Risks: ${r.analysis.compliance_risks.length}
  Corrections: ${r.analysis.suggested_corrections.length}
`).join('\n')}

Provide a concise executive summary highlighting key findings and recommendations.`,
      response_json_schema: {
        type: "object",
        properties: {
          executive_summary: { type: "string" },
          critical_findings_count: { type: "number" },
          high_risk_findings_count: { type: "number" },
          total_corrections_needed: { type: "number" },
          key_recommendations: {
            type: "array",
            items: { type: "string" }
          }
        }
      }
    });

    return Response.json({
      success: true,
      audits_reviewed: results.length,
      results: results,
      report_summary: reportSummary,
      generated_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('AI compliance audit error:', error);
    return Response.json(
      { error: 'Failed to perform AI audit', details: error.message },
      { status: 500 }
    );
  }
});