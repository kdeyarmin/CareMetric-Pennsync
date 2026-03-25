import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { patient_id, prediction_horizon_days = 30 } = body;

    if (!patient_id) {
      return Response.json({ error: 'patient_id required' }, { status: 400 });
    }

    // Gather comprehensive patient data
    const patients = await base44.asServiceRole.entities.Patient.list();
    const patient = patients.find(p => p.id === patient_id);
    if (!patient) {
      return Response.json({ error: 'Patient not found' }, { status: 404 });
    }

    const [visits, carePlans, alerts, documents, incidents, tasks, riskAnalyses] = await Promise.all([
      base44.asServiceRole.entities.Visit.filter({ patient_id }, '-visit_date', 50),
      base44.asServiceRole.entities.CarePlan.filter({ patient_id }),
      base44.asServiceRole.entities.PatientAlert.filter({ patient_id }),
      base44.asServiceRole.entities.PatientDocument.filter({ patient_id }, '-created_date', 10),
      base44.asServiceRole.entities.Incident.filter({ patient_id }),
      base44.asServiceRole.entities.Task.filter({ patient_id }),
      base44.asServiceRole.entities.RiskAnalysis.filter({ patient_id }, '-created_date', 5)
    ]);

    const patientContext = buildComprehensiveAnalyticsContext(
      patient, visits, carePlans, alerts, documents, incidents, tasks, riskAnalyses
    );

    const res = await base44.integrations.Core.InvokeLLM({
      prompt: `You are an expert clinical data scientist and predictive analytics specialist with deep knowledge of machine learning models for healthcare outcomes, risk stratification algorithms, and evidence-based clinical prediction rules. Your task is to analyze comprehensive patient data and generate accurate, actionable predictions for adverse health events.

**PREDICTION TIMEFRAME:** Next ${prediction_horizon_days} days

**COMPREHENSIVE PATIENT DATA:**
${patientContext}

**ANALYSIS REQUIREMENTS:**

Perform a multi-dimensional predictive analysis using clinical reasoning, pattern recognition, and evidence-based risk factors. For EACH prediction category, you must:

1. **Analyze Longitudinal Patterns:**
   - Identify trends, deteriorations, improvements over time
   - Detect subtle changes that may indicate early warning signs
   - Cross-reference multiple data streams (vitals, notes, adherence, functional status)

2. **Apply Evidence-Based Risk Models:**
   - HOSPITAL (Hospital score for readmission)
   - LACE+ Index (Length of stay, Acuity, Comorbidities, ED visits)
   - Morse Fall Scale factors
   - Braden Scale for pressure injury
   - Disease-specific prediction rules (HF, COPD, diabetes complications)

3. **Identify Risk Factor Clusters:**
   - Multiple concurrent risk factors amplify risk
   - Social determinants affecting outcomes
   - Medication non-adherence patterns
   - Caregiver strain indicators

4. **Generate Actionable Intelligence:**
   - Specific interventions to mitigate identified risks
   - Optimal timing for interventions
   - Resources needed
   - Expected impact of interventions

**PREDICTION CATEGORIES:**

1. **Hospital Readmission Risk:**
   - Analyze: recent hospitalizations, diagnosis stability, medication changes, adherence, functional decline, social support
   - Consider: 30-day, 60-day, 90-day windows
   - Flag: early warning signs in visit notes

2. **Fall Risk Prediction:**
   - Analyze: gait/balance trends, medication side effects (dizziness, orthostasis), cognitive status, vision, home safety, previous falls
   - Consider: intrinsic factors (patient) + extrinsic factors (environment)
   - Calculate: Morse Fall Scale equivalent

3. **Disease Exacerbation Risk:**
   - For each chronic condition, assess stability
   - Identify: early decompensation signs (vitals trends, symptom progression, treatment response)
   - Flag: conditions showing deterioration patterns

4. **Medication-Related Adverse Events:**
   - Analyze: polypharmacy burden, high-risk medications, drug interactions, adherence patterns
   - Predict: adverse drug reactions, therapeutic failures

5. **Functional Decline:**
   - Track: ADL/IADL trends, mobility changes, cognitive shifts
   - Predict: loss of independence, need for higher level of care

6. **Pressure Injury Risk:**
   - Analyze: mobility, nutrition, moisture, sensory perception
   - Calculate: Braden-like score from available data

7. **Emergency Department Visits:**
   - Identify: uncontrolled symptoms, inadequate care coordination, social crises

8. **Mortality Risk:**
   - Consider: disease severity, recent deterioration, frailty indicators
   - Be clinically appropriate and sensitive

**CONFIDENCE LEVELS:**
Base confidence on:
- Data completeness (more data = higher confidence)
- Pattern consistency (clear trends = higher confidence)
- Evidence strength (validated risk factors = higher confidence)
- Recency of data (current data = higher confidence)

**INTERVENTION RECOMMENDATIONS:**
Prioritize by:
1. Clinical urgency (immediate danger vs. preventive)
2. Feasibility (what home health can implement)
3. Evidence base (proven interventions)
4. Patient-specific factors (preferences, resources)

**OUTPUT STANDARDS:**
- Quantify risks with probabilities where possible
- Cite specific data points supporting predictions
- Provide clear, actionable next steps
- Distinguish between modifiable and non-modifiable risk factors
- Consider competing risks (patient may have multiple high risks)`,
      response_json_schema: {
        type: "object",
        properties: {
          overall_risk_summary: {
            type: "object",
            properties: {
              risk_level: { type: "string", enum: ["low", "moderate", "high", "critical"] },
              primary_concerns: { type: "array", items: { type: "string" } },
              trending_direction: { type: "string", enum: ["improving", "stable", "declining", "rapidly_declining"] },
              key_insights: { type: "string", description: "2-3 sentence executive summary" }
            }
          },
          readmission_prediction: {
            type: "object",
            properties: {
              risk_score: { type: "number", description: "0-100 probability" },
              risk_category: { type: "string", enum: ["low", "moderate", "high", "very_high"] },
              confidence_level: { type: "string", enum: ["high", "moderate", "low"] },
              timeframe: { type: "string", description: "e.g., '30 days'" },
              contributing_factors: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    factor: { type: "string" },
                    impact_level: { type: "string", enum: ["critical", "major", "moderate", "minor"] },
                    evidence: { type: "string", description: "Specific data supporting this factor" },
                    modifiable: { type: "boolean" }
                  }
                }
              },
              protective_factors: { type: "array", items: { type: "string" } },
              early_warning_signs: { type: "array", items: { type: "string" } },
              interventions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    intervention: { type: "string" },
                    priority: { type: "string", enum: ["immediate", "high", "moderate", "low"] },
                    expected_risk_reduction: { type: "string" },
                    implementation_steps: { type: "array", items: { type: "string" } }
                  }
                }
              }
            }
          },
          fall_risk_prediction: {
            type: "object",
            properties: {
              risk_score: { type: "number", description: "0-100 probability" },
              risk_category: { type: "string", enum: ["low", "moderate", "high", "very_high"] },
              confidence_level: { type: "string", enum: ["high", "moderate", "low"] },
              morse_scale_equivalent: { type: "number", description: "Calculated Morse Fall Score" },
              intrinsic_factors: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    factor: { type: "string" },
                    severity: { type: "string", enum: ["severe", "moderate", "mild"] },
                    evidence: { type: "string" }
                  }
                }
              },
              extrinsic_factors: { type: "array", items: { type: "string" } },
              fall_history: { type: "string" },
              interventions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    intervention: { type: "string" },
                    type: { type: "string", enum: ["environmental", "medical", "assistive_device", "therapy", "education"] },
                    priority: { type: "string", enum: ["immediate", "high", "moderate", "low"] },
                    expected_impact: { type: "string" }
                  }
                }
              }
            }
          },
          disease_exacerbation_predictions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                condition: { type: "string" },
                exacerbation_probability: { type: "number", description: "0-100" },
                risk_level: { type: "string", enum: ["low", "moderate", "high", "critical"] },
                confidence_level: { type: "string", enum: ["high", "moderate", "low"] },
                timeframe: { type: "string" },
                current_stability: { type: "string", enum: ["stable", "compensated", "decompensating", "unstable"] },
                warning_signs_present: { type: "array", items: { type: "string" } },
                triggers_identified: { type: "array", items: { type: "string" } },
                disease_specific_metrics: {
                  type: "object",
                  description: "e.g., for CHF: ejection fraction, weight trend, edema progression"
                },
                interventions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      intervention: { type: "string" },
                      timing: { type: "string" },
                      expected_benefit: { type: "string" }
                    }
                  }
                }
              }
            }
          },
          medication_adverse_event_risk: {
            type: "object",
            properties: {
              overall_risk: { type: "string", enum: ["low", "moderate", "high", "critical"] },
              polypharmacy_burden: { type: "string" },
              high_risk_medications: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    medication: { type: "string" },
                    risk_type: { type: "string" },
                    probability: { type: "string" },
                    monitoring_plan: { type: "string" }
                  }
                }
              },
              adherence_concerns: {
                type: "object",
                properties: {
                  overall_adherence_probability: { type: "string" },
                  barriers_identified: { type: "array", items: { type: "string" } },
                  medications_at_risk: { type: "array", items: { type: "string" } }
                }
              }
            }
          },
          functional_decline_prediction: {
            type: "object",
            properties: {
              decline_probability: { type: "number", description: "0-100" },
              risk_level: { type: "string", enum: ["low", "moderate", "high", "critical"] },
              timeframe: { type: "string" },
              current_trajectory: { type: "string", enum: ["improving", "stable", "declining", "rapid_decline"] },
              affected_domains: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    domain: { type: "string", enum: ["mobility", "adl", "iadl", "cognitive", "sensory"] },
                    current_status: { type: "string" },
                    predicted_change: { type: "string" },
                    evidence: { type: "string" }
                  }
                }
              },
              interventions: { type: "array", items: { type: "string" } }
            }
          },
          pressure_injury_risk: {
            type: "object",
            properties: {
              risk_score: { type: "number", description: "Braden-like score" },
              risk_category: { type: "string", enum: ["low", "moderate", "high", "very_high"] },
              risk_factors: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    factor: { type: "string" },
                    score: { type: "number" },
                    assessment: { type: "string" }
                  }
                }
              },
              current_wounds: { type: "string" },
              prevention_plan: { type: "array", items: { type: "string" } }
            }
          },
          ed_visit_prediction: {
            type: "object",
            properties: {
              probability: { type: "number", description: "0-100" },
              risk_level: { type: "string", enum: ["low", "moderate", "high", "critical"] },
              likely_triggers: { type: "array", items: { type: "string" } },
              prevention_strategies: { type: "array", items: { type: "string" } }
            }
          },
          mortality_risk_assessment: {
            type: "object",
            properties: {
              risk_level: { type: "string", enum: ["low", "moderate", "high", "critical"] },
              timeframe: { type: "string" },
              contributing_factors: { type: "array", items: { type: "string" } },
              palliative_care_indicated: { type: "boolean" },
              advance_care_planning_priority: { type: "string", enum: ["urgent", "important", "routine", "not_indicated"] }
            }
          },
          data_quality_assessment: {
            type: "object",
            properties: {
              overall_completeness: { type: "string", enum: ["excellent", "good", "fair", "poor"] },
              gaps_identified: { type: "array", items: { type: "string" } },
              data_recency: { type: "string" },
              confidence_impact: { type: "string" }
            }
          },
          recommended_monitoring_plan: {
            type: "array",
            items: {
              type: "object",
              properties: {
                parameter: { type: "string" },
                frequency: { type: "string" },
                alert_thresholds: { type: "string" },
                rationale: { type: "string" }
              }
            }
          },
          care_coordination_priorities: {
            type: "array",
            items: {
              type: "object",
              properties: {
                action: { type: "string" },
                urgency: { type: "string", enum: ["immediate", "within_24hrs", "this_week", "routine"] },
                responsible_party: { type: "string" },
                expected_outcome: { type: "string" }
              }
            }
          }
        }
      }
    });

    // Store the prediction for tracking
    const riskAnalysis = await base44.asServiceRole.entities.RiskAnalysis.create({
      patient_id,
      analysis_type: 'predictive_analytics',
      risk_level: res.overall_risk_summary?.risk_level || 'unknown',
      risk_score: res.readmission_prediction?.risk_score || 0,
      risk_factors: res.overall_risk_summary?.primary_concerns?.map(c => ({ factor: c, severity: 'high' })) || [],
      predictions: [
        { outcome: 'hospital_readmission', probability: res.readmission_prediction?.risk_score || 0 },
        { outcome: 'fall_risk', probability: res.fall_risk_prediction?.risk_score || 0 },
        { outcome: 'functional_decline', probability: res.functional_decline_prediction?.decline_probability || 0 }
      ],
      recommendations: res.care_coordination_priorities?.map(c => c.action) || [],
      analyzed_by: user.email
    });

    // Auto-generate intervention suggestions for high-risk predictions
    const suggestions = [];
    
    // Readmission Risk
    if (res.readmission_prediction?.risk_score >= 70) {
      const topIntervention = res.readmission_prediction.interventions?.[0];
      if (topIntervention) {
        suggestions.push({
          patient_id,
          prediction_type: 'hospital_readmission',
          risk_analysis_id: riskAnalysis.id,
          risk_score: res.readmission_prediction.risk_score,
          risk_level: res.readmission_prediction.risk_category === 'very_high' ? 'very_high' : 'high',
          suggested_intervention_category: categorizePredictiveIntervention(topIntervention.intervention),
          suggested_intervention_description: topIntervention.intervention,
          suggested_expected_outcome: topIntervention.expected_risk_reduction,
          suggested_actions: topIntervention.implementation_steps || [],
          priority: topIntervention.priority || 'high',
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        });
      }
    }

    // Fall Risk
    if (res.fall_risk_prediction?.risk_score >= 70) {
      const topIntervention = res.fall_risk_prediction.interventions?.[0];
      if (topIntervention) {
        suggestions.push({
          patient_id,
          prediction_type: 'fall_risk',
          risk_analysis_id: riskAnalysis.id,
          risk_score: res.fall_risk_prediction.risk_score,
          risk_level: res.fall_risk_prediction.risk_category === 'very_high' ? 'very_high' : 'high',
          suggested_intervention_category: topIntervention.type || 'environmental',
          suggested_intervention_description: topIntervention.intervention,
          suggested_expected_outcome: topIntervention.expected_impact,
          suggested_actions: [topIntervention.intervention],
          priority: topIntervention.priority || 'high',
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        });
      }
    }

    // Disease Exacerbations
    if (res.disease_exacerbation_predictions) {
      for (const disease of res.disease_exacerbation_predictions) {
        if (disease.exacerbation_probability >= 70 && disease.interventions?.length > 0) {
          const topIntervention = disease.interventions[0];
          suggestions.push({
            patient_id,
            prediction_type: 'disease_exacerbation',
            risk_analysis_id: riskAnalysis.id,
            risk_score: disease.exacerbation_probability,
            risk_level: disease.risk_level === 'critical' ? 'critical' : 'high',
            suggested_intervention_category: 'care_plan_update',
            suggested_intervention_description: `${disease.condition}: ${topIntervention.intervention}`,
            suggested_expected_outcome: topIntervention.expected_benefit,
            suggested_actions: [topIntervention.intervention],
            priority: disease.risk_level === 'critical' ? 'immediate' : 'high',
            expires_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
          });
        }
      }
    }

    // Create suggested interventions
    for (const suggestion of suggestions) {
      try {
        await base44.asServiceRole.entities.SuggestedIntervention.create(suggestion);
      } catch (error) {
        console.error('Error creating suggested intervention:', error);
      }
    }

    return Response.json({ 
      success: true, 
      data: res,
      suggestions_created: suggestions.length
    });

  } catch (error) {
    console.error('Predictive analytics error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

function categorizePredictiveIntervention(description) {
  const categories = {
    medication: 'medication_adjustment',
    therapy: 'therapy_referral',
    'care plan': 'care_plan_update',
    monitor: 'monitoring_increase',
    equipment: 'equipment_provision',
    education: 'education_provided',
    physician: 'physician_consult',
    home: 'environmental_modification',
    caregiver: 'caregiver_support'
  };

  const lower = description.toLowerCase();
  for (const [keyword, category] of Object.entries(categories)) {
    if (lower.includes(keyword)) return category;
  }
  return 'care_plan_update';
}

function buildComprehensiveAnalyticsContext(patient, visits, carePlans, alerts, documents, incidents, tasks, riskAnalyses) {
  const age = patient.date_of_birth ? Math.floor((Date.now() - new Date(patient.date_of_birth).getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : null;
  
  // Calculate visit frequency and missed visits
  const completedVisits = visits.filter(v => v.status === 'completed');
  const missedVisits = visits.filter(v => v.status === 'missed');
  const scheduledVisits = visits.filter(v => v.status === 'scheduled');
  
  // Analyze vital signs trends
  const vitalsWithDates = visits
    .filter(v => v.vital_signs && v.visit_date)
    .map(v => ({
      date: v.visit_date,
      ...v.vital_signs
    }))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 20);

  // Calculate medication complexity
  const medicationCount = (patient.current_medications || []).length;
  const highRiskMeds = (patient.current_medications || []).filter(m => 
    ['warfarin', 'insulin', 'opioid', 'anticoagulant'].some(hrm => 
      m.name?.toLowerCase().includes(hrm)
    )
  );

  // Analyze care plan progress
  const activePlans = carePlans.filter(cp => cp.status === 'active');
  const progressingPlans = activePlans.filter(cp => (cp.progress_percentage || 0) >= 50);
  const stalledPlans = activePlans.filter(cp => (cp.progress_percentage || 0) < 25);

  // Recent hospitalizations
  const hospitalizations = visits.filter(v => 
    v.visit_type?.toLowerCase().includes('hospital') || 
    v.nurse_notes?.toLowerCase().includes('hospital') ||
    v.nurse_notes?.toLowerCase().includes('admitted')
  ).slice(0, 5);

  // Fall history
  const fallIncidents = incidents.filter(i => 
    i.incident_type?.toLowerCase().includes('fall')
  );

  // Recent document analysis
  const recentLabResults = documents.filter(d => 
    d.document_category === 'lab_result'
  ).slice(0, 3);

  const recentImagingReports = documents.filter(d => 
    d.document_category === 'imaging_report'
  ).slice(0, 3);

  // Task completion analysis
  const overdueTasks = tasks.filter(t => 
    t.status !== 'completed' && t.due_date && new Date(t.due_date) < new Date()
  );

  return `
**PATIENT DEMOGRAPHICS & PROFILE:**
Name: ${patient.first_name} ${patient.last_name}
Age: ${age} years | Gender: ${patient.gender || 'unknown'}
MRN: ${patient.medical_record_number || 'N/A'}

**PRIMARY CLINICAL PICTURE:**
Primary Diagnosis: ${patient.primary_diagnosis || 'Not specified'}
Secondary Diagnoses: ${(patient.secondary_diagnoses || []).join(', ') || 'None'}
Chronic Conditions: ${(patient.chronic_conditions || []).map(c => 
  `${c.condition} (${c.severity || 'unspecified'}, since ${c.diagnosed_date || 'unknown'})`
).join('; ') || 'None'}
Comorbidity Count: ${(patient.chronic_conditions || []).length + (patient.secondary_diagnoses || []).length}

**MEDICATION PROFILE:**
Total Medications: ${medicationCount}
High-Risk Medications: ${highRiskMeds.map(m => m.name).join(', ') || 'None'}
Complete List:
${(patient.current_medications || []).map(m => 
  `- ${m.name} ${m.dosage} ${m.frequency} for ${m.indication || 'unspecified'} (started ${m.start_date || 'unknown'})`
).join('\n') || 'None documented'}
Allergies: ${patient.allergies || 'NKDA'}

**FUNCTIONAL STATUS BASELINE:**
ADL Independence: ${patient.functional_status?.adl_independence || 'Not assessed'}
IADL Independence: ${patient.functional_status?.iadl_independence || 'Not assessed'}
Ambulation: ${patient.functional_status?.ambulation || 'Not assessed'}
Cognitive Status: ${patient.functional_status?.cognitive_status || 'Not assessed'}
Fall Risk Assessment: ${patient.functional_status?.fall_risk || 'Not assessed'}

**VITAL SIGNS LONGITUDINAL DATA (Last 20 readings):**
${vitalsWithDates.map(v => 
  `${v.date}: BP ${v.blood_pressure_systolic || 'N/A'}/${v.blood_pressure_diastolic || 'N/A'}, HR ${v.heart_rate || 'N/A'}, O2 ${v.oxygen_saturation || 'N/A'}%, Temp ${v.temperature || 'N/A'}°F, Pain ${v.pain_level || 'N/A'}/10, Weight ${v.weight || 'N/A'} lbs`
).join('\n') || 'Limited vitals data'}

**VISIT PATTERN ANALYSIS:**
Total Completed Visits: ${completedVisits.length}
Missed Visits: ${missedVisits.length} (${missedVisits.length > 0 ? 'CONCERN' : 'good adherence'})
Scheduled Upcoming: ${scheduledVisits.length}
Recent Visit Types: ${completedVisits.slice(0, 10).map(v => v.visit_type).join(', ')}

**HOSPITALIZATION HISTORY:**
${hospitalizations.length > 0 ? hospitalizations.map(h => 
  `[${h.visit_date}] ${h.visit_type}: ${h.nurse_notes?.substring(0, 200) || 'No details'}`
).join('\n') : 'No recent hospitalizations documented'}

**FALL HISTORY:**
Total Falls Documented: ${fallIncidents.length}
${fallIncidents.length > 0 ? `Recent Falls:\n${fallIncidents.slice(0, 3).map(f => 
  `[${f.incident_date}] ${f.description?.substring(0, 150) || 'No details'} - Injury: ${f.injury_sustained ? 'Yes' : 'No'}`
).join('\n')}` : 'No falls documented'}

**CARE PLAN STATUS:**
Active Care Plans: ${activePlans.length}
Progressing Well (>50%): ${progressingPlans.length}
Stalled (<25%): ${stalledPlans.length}
Details:
${activePlans.map(cp => 
  `- ${cp.problem}: ${cp.goal} (${cp.progress_percentage || 0}% complete) - ${cp.care_plan_status || 'Active'}`
).join('\n') || 'No active care plans'}

**ACTIVE CLINICAL ALERTS:**
${alerts.filter(a => a.status === 'active').map(a => 
  `[${a.severity}] ${a.alert_type}: ${a.title} - ${a.description || 'No details'}`
).join('\n') || 'No active alerts'}

**RECENT LAB RESULTS:**
${recentLabResults.map(doc => 
  `[${doc.created_date?.split('T')[0]}] ${doc.file_name}\n  Summary: ${doc.ai_summary || 'Not analyzed'}\n  Key Findings: ${doc.extracted_data?.key_findings || 'N/A'}`
).join('\n\n') || 'No recent labs'}

**RECENT IMAGING:**
${recentImagingReports.map(doc => 
  `[${doc.created_date?.split('T')[0]}] ${doc.file_name}\n  Summary: ${doc.ai_summary || 'Not analyzed'}`
).join('\n\n') || 'No recent imaging'}

**SOCIAL DETERMINANTS & SUPPORT:**
Living Situation: ${patient.social_history?.living_situation || 'Unknown'}
Primary Caregiver: ${patient.social_history?.primary_caregiver || 'None identified'}
Caregiver Availability: ${patient.social_history?.caregiver_availability || 'Unknown'}
Transportation: ${patient.social_history?.transportation_access || 'Unknown'}
Housing Stability: ${patient.social_determinants?.housing_stability || 'Unknown'}
Food Security: ${patient.social_determinants?.food_security || 'Unknown'}
Health Literacy: ${patient.social_determinants?.health_literacy || 'Unknown'}

**ADVANCE CARE PLANNING:**
DNR: ${patient.advance_directives?.dnr_status ? 'YES' : 'No/Unknown'}
Living Will: ${patient.advance_directives?.has_living_well ? 'Yes' : 'No/Unknown'}
Healthcare Proxy: ${patient.advance_directives?.healthcare_proxy || 'None'}

**TASK ADHERENCE:**
Overdue Tasks: ${overdueTasks.length} ${overdueTasks.length > 2 ? '⚠️ CONCERNING' : ''}

**RECENT VISIT NARRATIVES (Last 10 visits - critical for pattern identification):**
${completedVisits.slice(0, 10).map(v => 
  `\n[${v.visit_date} - ${v.visit_type}]\nNurse Notes: ${v.nurse_notes?.substring(0, 800) || 'No notes'}\n`
).join('\n')}

**HISTORICAL RISK ANALYSES:**
${riskAnalyses.slice(0, 3).map(ra => 
  `[${ra.created_date?.split('T')[0]}] Risk Level: ${ra.risk_level}, Score: ${ra.risk_score}\nFactors: ${ra.risk_factors?.map(f => f.factor).join(', ') || 'None'}`
).join('\n') || 'No previous risk analyses'}`;
}