import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { visit_id, patient_id, billing_codes, clinical_documentation } = body;

    if (!visit_id && !patient_id) {
      return Response.json({ error: 'Visit ID or Patient ID required' }, { status: 400 });
    }

    console.log('[detectBillingDiscrepancies] Analyzing billing for', visit_id || patient_id);

    let visit = null;
    let patient = null;

    if (visit_id) {
      const visits = await base44.asServiceRole.entities.Visit.filter({ id: visit_id });
      visit = visits[0];
      
      if (visit) {
        const patients = await base44.asServiceRole.entities.Patient.filter({ id: visit.patient_id });
        patient = patients[0];
      }
    } else {
      const patients = await base44.asServiceRole.entities.Patient.filter({ id: patient_id });
      patient = patients[0];
      
      // Get most recent visit
      const visits = await base44.asServiceRole.entities.Visit.filter({ patient_id }, '-visit_date', 1);
      visit = visits[0];
    }

    if (!patient) {
      return Response.json({ error: 'Patient not found' }, { status: 404 });
    }

    const clinicalData = clinical_documentation || visit?.nurse_notes || '';
    
    const analysisContext = {
      patient: {
        name: `${patient.first_name} ${patient.last_name}`,
        primary_diagnosis: patient.primary_diagnosis,
        secondary_diagnoses: patient.secondary_diagnoses || [],
        care_type: patient.care_type
      },
      visit: visit ? {
        date: visit.visit_date,
        type: visit.visit_type,
        documentation: visit.nurse_notes,
        vitals: visit.vital_signs,
        duration: visit.end_time && visit.start_time ? 
          `${visit.start_time} - ${visit.end_time}` : null
      } : null,
      proposed_codes: billing_codes || [],
      clinical_documentation: clinicalData
    };

    const prompt = `You are an expert medical billing compliance auditor and certified coder specializing in home health and healthcare billing.

ANALYSIS CONTEXT:
${JSON.stringify(analysisContext, null, 2)}

Perform a comprehensive billing compliance analysis:

1. DOCUMENTATION REVIEW
   - Assess if documentation supports level of service claimed
   - Check for required elements (assessment, interventions, response, etc.)
   - Verify medical necessity is clearly documented
   - Check time documentation if time-based billing

2. CODING ACCURACY
   - Verify ICD-10 codes match documented diagnoses
   - Check CPT/HCPCS codes align with services documented
   - Identify missing diagnoses that should be coded
   - Flag codes that lack documentation support

3. COMPLIANCE ISSUES
   - Medicare/Medicaid compliance violations
   - Missing required signatures or dates
   - Incomplete visit documentation
   - Homebound status documentation (if home health)
   - Skilled need justification

4. UPCODING/DOWNCODING RISKS
   - Services billed at higher level than documented
   - Services billed at lower level (revenue loss)
   - Bundling issues
   - Modifier usage errors

5. COMMON BILLING ERRORS
   - Duplicate billing risks
   - Medical necessity gaps
   - Missing or incomplete documentation
   - Time documentation issues
   - Place of service errors

6. OPTIMIZATION OPPORTUNITIES
   - Additional billable services that were documented but not coded
   - More specific diagnosis codes available
   - Missed opportunities for reimbursement

Provide specific, actionable findings with severity ratings and clear recommendations.`;

    const result = await base44.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: 'object',
        properties: {
          overall_compliance_score: {
            type: 'number',
            description: 'Overall score 0-100'
          },
          risk_level: {
            type: 'string',
            enum: ['low', 'medium', 'high', 'critical']
          },
          summary: { type: 'string' },
          discrepancies: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                category: {
                  type: 'string',
                  enum: [
                    'documentation',
                    'coding_accuracy',
                    'medical_necessity',
                    'compliance',
                    'upcoding_risk',
                    'downcoding_risk',
                    'time_documentation',
                    'modifier_usage',
                    'bundling'
                  ]
                },
                severity: {
                  type: 'string',
                  enum: ['critical', 'high', 'medium', 'low']
                },
                issue: { type: 'string' },
                impact: { type: 'string' },
                documentation_gap: { type: 'string' },
                recommendation: { type: 'string' },
                regulatory_reference: { type: 'string' },
                financial_impact: {
                  type: 'string',
                  enum: ['potential_denial', 'potential_audit', 'revenue_loss', 'none']
                }
              }
            }
          },
          coding_recommendations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                code_type: {
                  type: 'string',
                  enum: ['ICD-10', 'CPT', 'HCPCS', 'Revenue Code']
                },
                current_code: { type: 'string' },
                recommended_code: { type: 'string' },
                rationale: { type: 'string' },
                documentation_support: { type: 'string' },
                reimbursement_impact: { type: 'string' }
              }
            }
          },
          missing_documentation: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                element: { type: 'string' },
                required_for: { type: 'string' },
                urgency: {
                  type: 'string',
                  enum: ['immediate', 'high', 'medium', 'low']
                }
              }
            }
          },
          optimization_opportunities: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                opportunity: { type: 'string' },
                potential_additional_revenue: { type: 'string' },
                action_needed: { type: 'string' }
              }
            }
          },
          compliance_checklist: {
            type: 'object',
            properties: {
              medical_necessity_documented: { type: 'boolean' },
              skilled_need_justified: { type: 'boolean' },
              homebound_status_documented: { type: 'boolean' },
              time_documented: { type: 'boolean' },
              physician_orders_referenced: { type: 'boolean' },
              patient_response_documented: { type: 'boolean' },
              safety_addressed: { type: 'boolean' }
            }
          },
          action_items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                action: { type: 'string' },
                priority: {
                  type: 'string',
                  enum: ['urgent', 'high', 'medium', 'low']
                },
                responsible_party: { type: 'string' },
                deadline: { type: 'string' }
              }
            }
          }
        }
      }
    });

    return Response.json({
      success: true,
      analysis: result,
      analyzed_at: new Date().toISOString(),
      visit_id: visit?.id,
      patient_id: patient.id
    });
  } catch (error) {
    console.error('[detectBillingDiscrepancies] Error:', error.message);
    return Response.json({
      error: 'Billing analysis failed',
      details: error.message
    }, { status: 500 });
  }
});