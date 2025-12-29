import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { patientContext, medicareRules } = await req.json();

    // Build comprehensive audit prompt
    const auditPrompt = `You are a Medicare compliance expert auditor. Analyze this patient's documentation against Medicare Conditions of Participation (42 CFR 484).

PATIENT CONTEXT:
Demographics:
- Name: ${patientContext.demographics.name}
- DOB: ${patientContext.demographics.dob}
- Primary Diagnosis: ${patientContext.demographics.diagnosis}
- Secondary Diagnoses: ${patientContext.demographics.secondary_diagnoses?.join(', ') || 'None'}
- Admission Date: ${patientContext.demographics.admission_date}
- Care Type: ${patientContext.demographics.care_type}

Clinical Information:
- Allergies: ${patientContext.clinical.allergies || 'None documented'}
- Medications: ${JSON.stringify(patientContext.clinical.medications || [])}
- Baseline Vitals: ${JSON.stringify(patientContext.clinical.baseline_vitals || {})}
- Functional Status: ${JSON.stringify(patientContext.clinical.functional_status || {})}
- Advance Directives: ${JSON.stringify(patientContext.clinical.advance_directives || {})}

Recent Visits (Last 10):
${patientContext.recent_visits.map((v, idx) => `
Visit ${idx + 1} - ${v.date} (${v.type}):
Notes: ${v.notes || 'No notes'}
Vitals: ${JSON.stringify(v.vital_signs || {})}
`).join('\n')}

MEDICARE COMPLIANCE RULES TO CHECK:
${medicareRules.map(r => `
- ${r.rule_name} (${r.cop_reference}) [${r.severity}]
  Description: ${r.description}
  Required Elements: ${r.required_elements?.join(', ')}
`).join('\n')}

AUDIT REQUIREMENTS:
1. Check each Medicare rule against the patient documentation
2. Identify what is properly documented (compliant areas)
3. Flag missing or inadequate documentation (issues)
4. For each issue, provide:
   - Element name (what's missing/inadequate)
   - Severity (critical, high, medium, low)
   - CoP reference (specific 42 CFR section)
   - Problem description
   - Specific corrective actions for the nurse
   - Medicare CoP guidance
5. Provide overall compliance score (0-100)
6. Give actionable recommendations
7. Suggest training topics if needed

Focus on:
- Homebound status documentation
- Skilled need justification
- Care plan documentation
- Assessment completeness
- Progress notes quality
- Medication management
- Safety assessment
- Infection control
- Patient/caregiver education
- Coordination of care
- Functional status tracking
- Vital signs documentation

Return comprehensive audit results.`;

    const auditResults = await base44.integrations.Core.InvokeLLM({
      prompt: auditPrompt,
      response_json_schema: {
        type: "object",
        properties: {
          overall_score: {
            type: "number",
            description: "Overall compliance score 0-100"
          },
          summary: {
            type: "string",
            description: "Overall assessment summary"
          },
          compliant_areas: {
            type: "array",
            items: { type: "string" },
            description: "Areas where documentation is compliant"
          },
          issues: {
            type: "array",
            items: {
              type: "object",
              properties: {
                element: { type: "string" },
                severity: { 
                  type: "string",
                  enum: ["critical", "high", "medium", "low"]
                },
                cop_reference: { type: "string" },
                problem: { type: "string" },
                corrective_actions: {
                  type: "array",
                  items: { type: "string" }
                },
                medicare_guidance: { type: "string" }
              },
              required: ["element", "severity", "problem", "corrective_actions"]
            }
          },
          recommendations: {
            type: "array",
            items: { type: "string" },
            description: "Overall recommendations for improvement"
          },
          training_needed: {
            type: "array",
            items: { type: "string" },
            description: "Recommended training topics"
          }
        },
        required: ["overall_score", "summary", "compliant_areas", "issues"]
      }
    });

    // Log the audit
    await base44.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'ai_compliance_audit',
      details: {
        patient_id: patientContext.demographics.name,
        compliance_score: auditResults.overall_score,
        issues_found: auditResults.issues?.length || 0
      },
      page: 'compliance_audit'
    });

    return Response.json({
      success: true,
      data: {
        overall_score: auditResults.overall_score || 0,
        summary: auditResults.summary || 'Audit completed',
        compliant_areas: auditResults.compliant_areas || [],
        issues: auditResults.issues || [],
        recommendations: auditResults.recommendations || [],
        training_needed: auditResults.training_needed || []
      }
    });

  } catch (error) {
    console.error('Error in AI compliance audit:', error);
    return Response.json({ 
      error: 'Failed to complete compliance audit',
      details: error.message 
    }, { status: 500 });
  }
});