import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { 
      enhancedNote, 
      roughNote,
      visitType, 
      diagnosis, 
      patientId,
      vitalSigns,
      nurseType = 'RN'
    } = await req.json();

    // Fetch patient data for context
    const patient = patientId ? await base44.entities.Patient.filter({ id: patientId }) : null;
    const patientData = patient?.[0];

    // Run all compliance checks in parallel
    const [
      medicareCompliance,
      generalCompliance,
      visitTypeCompliance,
      oasisMapping,
      pdgmAnalysis,
      clinicalAlerts,
      documentationGaps
    ] = await Promise.all([
      // 1. Medicare CoP Compliance
      base44.integrations.Core.InvokeLLM({
        prompt: `Analyze this clinical note against Medicare Conditions of Participation for Home Health.
        
NOTE: ${enhancedNote}
VISIT TYPE: ${visitType}
DIAGNOSIS: ${diagnosis}
NURSE TYPE: ${nurseType}

Check for required Medicare elements:
1. Homebound Status: Specific mobility limitations, why leaving home is taxing
2. Skilled Need: Why RN/LPN skills are medically necessary
3. Patient Response: Verbal understanding, teach-back, demonstrated competency
4. Safety Assessment: Fall risk, environment hazards, caregiver competency
5. Functional Status: ADL/IADL abilities, assistance needed
6. Plan of Care: Continuing plan, next visit, when to contact MD/nurse

IMPORTANT: Patient identifiers (names, ages, DOB) are REQUIRED for home health documentation - do NOT flag them as violations.

Return compliance analysis with specific violations and fixes.`,
        add_context_from_internet: true,
        response_json_schema: {
          type: "object",
          properties: {
            overall_score: { type: "number" },
            violations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  element: { type: "string" },
                  severity: { type: "string" },
                  issue: { type: "string" },
                  suggested_fix: { type: "string" },
                  regulatory_reference: { type: "string" }
                }
              }
            },
            compliant_elements: { type: "array", items: { type: "string" } }
          }
        }
      }),

      // 2. General Clinical Guidelines
      base44.integrations.Core.InvokeLLM({
        prompt: `Review this note against current clinical documentation best practices for ${diagnosis}.

NOTE: ${enhancedNote}
VISIT TYPE: ${visitType}

Check for:
- Condition-specific assessments and monitoring
- Evidence-based interventions
- Patient education documentation
- Coordination of care elements
- Clinical reasoning and judgment

Identify any missing best practice elements.`,
        add_context_from_internet: true,
        response_json_schema: {
          type: "object",
          properties: {
            guideline_gaps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  guideline: { type: "string" },
                  gap: { type: "string" },
                  recommendation: { type: "string" },
                  priority: { type: "string" }
                }
              }
            }
          }
        }
      }),

      // 3. Visit Type Specific Requirements
      base44.integrations.Core.InvokeLLM({
        prompt: `Analyze if this ${visitType} note meets all visit-type specific requirements.

NOTE: ${enhancedNote}

${visitType === 'admission' ? 'ADMISSION REQUIREMENTS: Comprehensive baseline assessment, initial care plan, safety evaluation, patient/caregiver orientation' : ''}
${visitType === 'recertification' ? 'RECERTIFICATION REQUIREMENTS: Progress since admission, justification for continued care, comparison to baseline, goals for next period' : ''}
${visitType === 'discharge' ? 'DISCHARGE REQUIREMENTS: Outcomes achieved, discharge plan, patient/caregiver competency, follow-up arrangements' : ''}
${visitType === 'routine_visit' ? 'ROUTINE VISIT REQUIREMENTS: Status update, interventions provided, progress toward goals, ongoing assessment' : ''}

Identify missing visit-type specific elements.`,
        response_json_schema: {
          type: "object",
          properties: {
            visit_type_gaps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  requirement: { type: "string" },
                  status: { type: "string" },
                  recommendation: { type: "string" }
                }
              }
            }
          }
        }
      }),

      // 4. OASIS Item Mapping
      base44.integrations.Core.InvokeLLM({
        prompt: `Map this clinical note to OASIS-E items with confidence scores.

NOTE: ${enhancedNote}
PATIENT AGE: ${patientData?.date_of_birth ? Math.floor((new Date() - new Date(patientData.date_of_birth)) / (365.25 * 24 * 60 * 60 * 1000)) : 'Unknown'}

Map to functional items (M1800-M1890), wounds, medications, and high-impact items.
For each mapping, provide confidence score and evidence.`,
        response_json_schema: {
          type: "object",
          properties: {
            mappings: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  oasis_item: { type: "string" },
                  suggested_value: { type: "string" },
                  confidence: { type: "number" },
                  evidence: { type: "string" },
                  pdgm_impact: { type: "string" }
                }
              }
            },
            missing_oasis_documentation: { type: "array", items: { type: "string" } }
          }
        }
      }),

      // 5. PDGM Optimization
      base44.integrations.Core.InvokeLLM({
        prompt: `Analyze for PDGM case-mix optimization opportunities.

NOTE: ${enhancedNote}
DIAGNOSIS: ${diagnosis}
PATIENT DATA: ${JSON.stringify(patientData || {})}

Identify:
1. Undocumented comorbidities (implied by meds/findings)
2. Functional impairment documentation gaps
3. Clinical grouping optimization opportunities
4. Revenue impact of documentation improvements`,
        response_json_schema: {
          type: "object",
          properties: {
            opportunities: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  finding: { type: "string" },
                  documentation_needed: { type: "string" },
                  revenue_impact: { type: "number" },
                  priority: { type: "string" }
                }
              }
            },
            estimated_revenue_gain: { type: "number" }
          }
        }
      }),

      // 6. Clinical Alerts
      base44.integrations.Core.InvokeLLM({
        prompt: `Identify any clinical red flags or safety concerns in this note.

NOTE: ${enhancedNote}
VITALS: ${JSON.stringify(vitalSigns)}
DIAGNOSIS: ${diagnosis}

Flag any:
- Vital sign abnormalities requiring immediate attention
- Symptom patterns suggesting deterioration
- Medication safety concerns
- Fall/safety risks
- Need for MD notification`,
        response_json_schema: {
          type: "object",
          properties: {
            clinical_alerts: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  alert_type: { type: "string" },
                  severity: { type: "string" },
                  finding: { type: "string" },
                  recommended_action: { type: "string" },
                  time_sensitive: { type: "boolean" }
                }
              }
            }
          }
        }
      }),

      // 7. Documentation Quality Gaps
      base44.integrations.Core.InvokeLLM({
        prompt: `Compare rough note to enhanced note and identify remaining documentation gaps.

ROUGH NOTE: ${roughNote}
ENHANCED NOTE: ${enhancedNote}

What critical elements are STILL missing even after AI enhancement?
What areas need nurse's clinical judgment or additional data collection?`,
        response_json_schema: {
          type: "object",
          properties: {
            remaining_gaps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  element: { type: "string" },
                  why_missing: { type: "string" },
                  how_to_address: { type: "string" },
                  can_fix_now: { type: "boolean" }
                }
              }
            }
          }
        }
      })
    ]);

    // Save training recommendations for gaps identified
    const trainingRecommendations = [];
    
    medicareCompliance.violations?.forEach(v => {
      trainingRecommendations.push({
        nurse_email: user.email,
        recommendation_type: 'compliance',
        recommendation_text: `Improve documentation of ${v.element}: ${v.issue}`,
        source: 'compliance_checker',
        severity: v.severity,
        patient_id: patientId,
        context_data: {
          element: v.element,
          note_snippet: enhancedNote.substring(0, 200),
          full_context: v.suggested_fix
        }
      });
    });

    generalCompliance.guideline_gaps?.forEach(g => {
      if (g.priority === 'high') {
        trainingRecommendations.push({
          nurse_email: user.email,
          recommendation_type: 'clinical',
          recommendation_text: `Review best practices for ${g.guideline}`,
          source: 'compliance_checker',
          severity: 'medium',
          patient_id: patientId,
          context_data: {
            element: g.guideline,
            note_snippet: enhancedNote.substring(0, 200),
            full_context: g.recommendation
          }
        });
      }
    });

    // Batch create training recommendations
    if (trainingRecommendations.length > 0) {
      try {
        await base44.asServiceRole.entities.TrainingRecommendation.bulkCreate(trainingRecommendations);
      } catch (error) {
        console.error('Error saving training recommendations:', error);
      }
    }

    // Consolidate all findings
    const consolidatedInsights = {
      overall_compliance_score: medicareCompliance.overall_score || 0,
      
      critical_issues: [
        ...medicareCompliance.violations?.filter(v => v.severity === 'critical') || [],
        ...generalCompliance.guideline_gaps?.filter(g => g.priority === 'high') || [],
        ...visitTypeCompliance.visit_type_gaps?.filter(g => g.status === 'missing') || []
      ],

      compliance_violations: medicareCompliance.violations || [],
      
      guideline_gaps: generalCompliance.guideline_gaps || [],
      
      visit_type_gaps: visitTypeCompliance.visit_type_gaps || [],
      
      oasis_mappings: oasisMapping.mappings || [],
      missing_oasis_items: oasisMapping.missing_oasis_documentation || [],
      
      pdgm_opportunities: pdgmAnalysis.opportunities || [],
      estimated_revenue_gain: pdgmAnalysis.estimated_revenue_gain || 0,
      
      clinical_alerts: clinicalAlerts.clinical_alerts || [],
      
      remaining_documentation_gaps: documentationGaps.remaining_gaps || [],
      
      compliant_elements: medicareCompliance.compliant_elements || [],
      
      priority_action_items: [
        ...medicareCompliance.violations?.filter(v => v.severity === 'critical' || v.severity === 'high').slice(0, 5) || [],
        ...clinicalAlerts.clinical_alerts?.filter(a => a.time_sensitive).slice(0, 3) || []
      ],

      summary: {
        total_issues: (medicareCompliance.violations?.length || 0) + 
                     (generalCompliance.guideline_gaps?.length || 0) +
                     (visitTypeCompliance.visit_type_gaps?.length || 0),
        critical_count: medicareCompliance.violations?.filter(v => v.severity === 'critical').length || 0,
        high_priority_count: medicareCompliance.violations?.filter(v => v.severity === 'high').length || 0,
        revenue_opportunity: pdgmAnalysis.estimated_revenue_gain || 0,
        oasis_items_mapped: oasisMapping.mappings?.length || 0,
        training_recommendations_created: trainingRecommendations.length
      }
    };

    return Response.json({
      success: true,
      insights: consolidatedInsights
    });

  } catch (error) {
    console.error('Comprehensive compliance check error:', error);
    return Response.json(
      { error: 'Failed to run compliance check', details: error.message },
      { status: 500 }
    );
  }
});