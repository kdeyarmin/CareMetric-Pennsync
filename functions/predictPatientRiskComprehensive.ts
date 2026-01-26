import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { patient_id } = await req.json();

    if (!patient_id) {
      return Response.json({ error: 'patient_id is required' }, { status: 400 });
    }

    console.log('Predicting comprehensive patient risk for:', patient_id);

    // Fetch all relevant patient data
    const [patient, visits, carePlans, complianceViolations, alerts, incidents] = await Promise.all([
      base44.entities.Patient.filter({ id: patient_id }).then(p => p[0]),
      base44.entities.Visit.filter({ patient_id }).catch(() => []),
      base44.entities.CarePlan.filter({ patient_id }).catch(() => []),
      base44.entities.ComplianceViolation.filter({ entity_id: patient_id }).catch(() => []),
      base44.entities.PatientAlert.filter({ patient_id, status: 'active' }).catch(() => []),
      base44.entities.Incident.filter({ patient_id }).catch(() => [])
    ]);

    if (!patient) {
      return Response.json({ error: 'Patient not found' }, { status: 404 });
    }

    // Calculate patient age
    const age = patient.date_of_birth ? 
      Math.floor((new Date() - new Date(patient.date_of_birth)) / (365.25 * 24 * 60 * 60 * 1000)) : null;

    // Get recent completed visits (last 10)
    const recentVisits = visits
      .filter(v => v.status === 'completed')
      .sort((a, b) => new Date(b.visit_date) - new Date(a.visit_date))
      .slice(0, 10);

    // Build comprehensive AI prompt
    const riskPrompt = `You are an expert clinical risk assessment specialist. Analyze this patient's comprehensive data to predict risk levels for readmission, falls, medication non-compliance, and overall clinical deterioration.

PATIENT DEMOGRAPHICS:
- Name: ${patient.first_name} ${patient.last_name}
- Age: ${age || 'Unknown'}
- Care Type: ${patient.care_type || 'home_health'}

PRIMARY DIAGNOSIS: ${patient.primary_diagnosis || 'None documented'}

COMORBIDITIES: ${patient.secondary_diagnoses?.length > 0 ? patient.secondary_diagnoses.join(', ') : 'None documented'}

CHRONIC CONDITIONS: ${patient.chronic_conditions?.length > 0 ? 
  patient.chronic_conditions.map(c => `${c.condition} (${c.severity})`).join(', ') : 'None'}

CURRENT MEDICATIONS: ${patient.current_medications?.length || 0} medications
${patient.current_medications?.slice(0, 10).map(m => `- ${m.name} ${m.dosage} ${m.frequency}`).join('\n') || ''}

ALLERGIES: ${patient.allergies || 'NKDA'}

FUNCTIONAL STATUS:
${patient.functional_status ? `- Ambulation: ${patient.functional_status.ambulation}
- ADL Independence: ${patient.functional_status.adl_independence}
- Cognitive Status: ${patient.functional_status.cognitive_status}
- Fall Risk: ${patient.functional_status.fall_risk}` : 'Not documented'}

SOCIAL DETERMINANTS:
${patient.social_determinants ? `- Housing: ${patient.social_determinants.housing_stability}
- Food Security: ${patient.social_determinants.food_security}
- Social Isolation: ${patient.social_determinants.social_isolation}
- Caregiver Burden: ${patient.social_determinants.caregiver_burden}
- Health Literacy: ${patient.social_determinants.health_literacy}` : 'Not documented'}

BASELINE VITALS:
${patient.baseline_vitals ? `- BP: ${patient.baseline_vitals.blood_pressure_systolic}/${patient.baseline_vitals.blood_pressure_diastolic}
- HR: ${patient.baseline_vitals.heart_rate} bpm
- O2 Sat: ${patient.baseline_vitals.oxygen_saturation}%
- Weight: ${patient.baseline_vitals.weight} lbs
- BMI: ${patient.baseline_vitals.bmi}` : 'Not documented'}

PAST HOSPITALIZATIONS: ${patient.past_hospitalizations?.length || 0} documented
${patient.past_hospitalizations?.slice(0, 3).map(h => `- ${h.reason} (${h.date})`).join('\n') || ''}

RECENT VISITS (Last ${recentVisits.length}):
${recentVisits.map((v, i) => `${i+1}. ${v.visit_date} - ${v.visit_type}
   Notes: ${v.nurse_notes?.substring(0, 200) || 'No notes'}...
   ${v.vital_signs ? `Vitals: BP ${v.vital_signs.blood_pressure_systolic}/${v.vital_signs.blood_pressure_diastolic}, HR ${v.vital_signs.heart_rate}` : ''}`).join('\n\n')}

ACTIVE CARE PLANS: ${carePlans.filter(cp => cp.status === 'active').length}
${carePlans.filter(cp => cp.status === 'active').map(cp => `- Problem: ${cp.problem}\n  Goal: ${cp.goal}\n  Status: ${cp.status}`).join('\n')}

COMPLIANCE ISSUES: ${complianceViolations.filter(v => v.status === 'open').length} open violations
${complianceViolations.filter(v => v.status === 'open' && v.severity === 'critical').length > 0 ? 
  `Critical issues: ${complianceViolations.filter(v => v.status === 'open' && v.severity === 'critical').map(v => v.violation_description).join('; ')}` : ''}

ACTIVE ALERTS: ${alerts.length}
${alerts.map(a => `- ${a.title} (${a.severity})`).join('\n')}

RECENT INCIDENTS: ${incidents.length}
${incidents.slice(0, 3).map(i => `- ${i.incident_type}: ${i.description?.substring(0, 100)}`).join('\n')}

TASK: Provide a comprehensive risk assessment with specific numeric scores and actionable interventions.

Analyze for:
1. READMISSION RISK (0-100): Based on diagnoses, recent hospitalizations, vital signs trends, medication complexity, social factors
2. FALL RISK (0-100): Based on functional status, medications, cognitive status, past falls/incidents, environmental factors
3. MEDICATION NON-COMPLIANCE RISK (0-100): Based on medication count, complexity, cognitive status, health literacy, caregiver support
4. CLINICAL DETERIORATION RISK (0-100): Based on vital signs trends, disease progression, care plan adherence, recent visit notes
5. OVERALL RISK SCORE (0-100): Weighted combination of all risk factors

For each risk category:
- Provide specific score (0-100)
- Identify contributing factors from patient data
- Suggest 3-5 specific, actionable interventions
- Recommend documentation improvements to better track risk
- Identify care plan adjustments needed

Be specific and evidence-based in your recommendations.`;

    const riskAnalysis = await base44.integrations.Core.InvokeLLM({
      prompt: riskPrompt,
      response_json_schema: {
        type: "object",
        properties: {
          overall_risk_score: { type: "number" },
          overall_risk_level: { 
            type: "string", 
            enum: ["low", "moderate", "high", "critical"] 
          },
          confidence_level: { type: "number" },
          readmission_risk: {
            type: "object",
            properties: {
              score: { type: "number" },
              level: { type: "string" },
              contributing_factors: {
                type: "array",
                items: { type: "string" }
              },
              interventions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    action: { type: "string" },
                    priority: { type: "string", enum: ["critical", "high", "medium", "low"] },
                    timeframe: { type: "string" },
                    responsible_role: { type: "string" }
                  }
                }
              },
              documentation_recommendations: {
                type: "array",
                items: { type: "string" }
              }
            }
          },
          fall_risk: {
            type: "object",
            properties: {
              score: { type: "number" },
              level: { type: "string" },
              contributing_factors: {
                type: "array",
                items: { type: "string" }
              },
              interventions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    action: { type: "string" },
                    priority: { type: "string" },
                    timeframe: { type: "string" },
                    responsible_role: { type: "string" }
                  }
                }
              },
              documentation_recommendations: {
                type: "array",
                items: { type: "string" }
              }
            }
          },
          medication_compliance_risk: {
            type: "object",
            properties: {
              score: { type: "number" },
              level: { type: "string" },
              contributing_factors: {
                type: "array",
                items: { type: "string" }
              },
              interventions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    action: { type: "string" },
                    priority: { type: "string" },
                    timeframe: { type: "string" },
                    responsible_role: { type: "string" }
                  }
                }
              },
              documentation_recommendations: {
                type: "array",
                items: { type: "string" }
              }
            }
          },
          clinical_deterioration_risk: {
            type: "object",
            properties: {
              score: { type: "number" },
              level: { type: "string" },
              contributing_factors: {
                type: "array",
                items: { type: "string" }
              },
              interventions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    action: { type: "string" },
                    priority: { type: "string" },
                    timeframe: { type: "string" },
                    responsible_role: { type: "string" }
                  }
                }
              },
              documentation_recommendations: {
                type: "array",
                items: { type: "string" }
              }
            }
          },
          category_scores: {
            type: "object",
            properties: {
              clinical_stability: { type: "number" },
              functional_status: { type: "number" },
              safety_risk: { type: "number" },
              readmission_risk: { type: "number" },
              social_factors: { type: "number" }
            }
          },
          critical_interventions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                intervention: { type: "string" },
                rationale: { type: "string" },
                timeline: { type: "string" },
                expected_impact: { type: "string" }
              }
            }
          },
          recommended_care_plan_adjustments: {
            type: "array",
            items: { type: "string" }
          },
          monitoring_recommendations: {
            type: "array",
            items: { type: "string" }
          }
        }
      }
    });

    // Update patient with risk assessment
    await base44.entities.Patient.update(patient_id, {
      risk_assessment: {
        score: riskAnalysis.overall_risk_score,
        level: riskAnalysis.overall_risk_level,
        last_calculated: new Date().toISOString(),
        confidence: riskAnalysis.confidence_level,
        category_scores: riskAnalysis.category_scores
      }
    });

    console.log('Risk assessment completed and saved');

    return Response.json({
      success: true,
      risk_analysis: riskAnalysis
    });

  } catch (error) {
    console.error('[predictPatientRiskComprehensive] Error:', error);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
});