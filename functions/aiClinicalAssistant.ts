import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { action, patient_id, note_content, visit_type, diagnosis, provider_type, care_setting, vital_signs } = body;

    if (action === 'summarize_history') {
      return Response.json(await summarizeHistory(base44, patient_id));
    }

    if (action === 'generate_draft_note') {
      return Response.json(await generateDraftNote(base44, patient_id, visit_type, diagnosis, provider_type, care_setting, vital_signs));
    }

    if (action === 'suggest_assessments') {
      return Response.json(await suggestAssessments(base44, patient_id, note_content, visit_type, diagnosis));
    }

    if (action === 'quality_feedback') {
      return Response.json(await qualityFeedback(base44, note_content, visit_type, diagnosis, provider_type, care_setting));
    }

    if (action === 'drug_interaction_check') {
      return Response.json(await drugInteractionCheck(base44, patient_id, note_content, diagnosis));
    }

    if (action === 'diagnostic_referral_suggestions') {
      return Response.json(await diagnosticReferralSuggestions(base44, patient_id, note_content, visit_type, diagnosis, provider_type, care_setting));
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 });

  } catch (error) {
    console.error('AI Clinical Assistant error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

async function summarizeHistory(base44, patientId) {
  if (!patientId) return { error: 'patient_id required' };

  const patients = await base44.asServiceRole.entities.Patient.list();
  const patient = patients.find(p => p.id === patientId);
  if (!patient) return { error: 'Patient not found' };

  const visits = await base44.asServiceRole.entities.Visit.filter({ patient_id: patientId }, '-visit_date', 20);
  const carePlans = await base44.asServiceRole.entities.CarePlan.filter({ patient_id: patientId });
  const alerts = await base44.asServiceRole.entities.PatientAlert.filter({ patient_id: patientId });
  const documents = await base44.asServiceRole.entities.PatientDocument.filter({ patient_id: patientId }, '-created_date', 5);
  const riskAnalyses = await base44.asServiceRole.entities.RiskAnalysis.filter({ patient_id: patientId }, '-created_date', 3);

  const context = buildEnhancedPatientContext(patient, visits, carePlans, alerts, documents, riskAnalyses);

  const res = await base44.integrations.Core.InvokeLLM({
    prompt: `You are an expert clinical documentation specialist with deep knowledge of home health, skilled nursing, and Medicare compliance. Your task is to create a comprehensive yet highly actionable medical history summary that enables clinicians to immediately understand the patient's clinical status and make informed decisions.

${context}

**CRITICAL INSTRUCTIONS:**
1. Analyze the COMPLETE patient data to identify patterns, trends, and correlations across multiple data points
2. Prioritize information by CLINICAL URGENCY and ACTIONABILITY - what needs immediate attention?
3. Flag ANY concerning patterns with specific evidence (dates, values, changes over time)
4. Identify gaps in care, missed assessments, or areas where documentation is insufficient
5. Provide SPECIFIC, QUANTIFIABLE details - never use vague terms like "some" or "several"
6. Cross-reference medications with diagnoses to identify potential adherence issues or therapeutic gaps
7. Analyze vital signs trends for early warning signs of deterioration
8. Consider social determinants and their direct impact on clinical outcomes
9. Highlight interdisciplinary coordination needs (PT/OT/ST, pharmacy, physician)
10. Include recommended focus areas that are SPECIFIC and TIME-BOUND

**OUTPUT REQUIREMENTS:**
- Use precise clinical terminology appropriate for the care setting
- Include exact dates, values, and measurements whenever available
- Quantify changes (e.g., "BP increased from 140/90 on 1/15 to 165/95 on 2/10 - 18% increase")
- Link clinical findings to their implications for care planning
- Provide clear, evidence-based rationales for all recommendations
- Identify immediate red flags that require urgent clinical attention`,
    response_json_schema: {
      type: "object",
      properties: {
        clinical_snapshot: {
          type: "object",
          properties: {
            patient_summary: { type: "string", description: "2-3 sentence executive summary" },
            acuity_level: { type: "string", enum: ["stable", "improving", "declining", "critical"] },
            primary_concerns: { type: "array", items: { type: "string" } }
          }
        },
        diagnoses_summary: {
          type: "array",
          items: {
            type: "object",
            properties: {
              diagnosis: { type: "string" },
              status: { type: "string", enum: ["active", "resolving", "worsening", "stable"] },
              key_notes: { type: "string" }
            }
          }
        },
        medication_review: {
          type: "object",
          properties: {
            total_medications: { type: "number" },
            high_risk_medications: { type: "array", items: { type: "string" } },
            interaction_warnings: { type: "array", items: { type: "string" } },
            adherence_concerns: { type: "string" }
          }
        },
        vitals_trend: {
          type: "object",
          properties: {
            trend_summary: { type: "string" },
            concerning_trends: { type: "array", items: { type: "string" } },
            stable_parameters: { type: "array", items: { type: "string" } }
          }
        },
        visit_pattern: {
          type: "object",
          properties: {
            total_recent_visits: { type: "number" },
            visit_frequency: { type: "string" },
            last_visit_findings: { type: "string" },
            missed_visits: { type: "number" }
          }
        },
        care_plan_status: {
          type: "array",
          items: {
            type: "object",
            properties: {
              problem: { type: "string" },
              progress: { type: "string" },
              on_track: { type: "boolean" }
            }
          }
        },
        risk_factors: {
          type: "array",
          items: {
            type: "object",
            properties: {
              factor: { type: "string" },
              severity: { type: "string", enum: ["low", "moderate", "high", "critical"] },
              recommendation: { type: "string" }
            }
          }
        },
        next_visit_focus: {
          type: "array",
          items: {
            type: "object",
            properties: {
              focus_area: { type: "string" },
              urgency: { type: "string", enum: ["immediate", "high", "moderate", "routine"] },
              rationale: { type: "string" },
              specific_action: { type: "string" },
              expected_outcome: { type: "string" }
            }
          },
          description: "Top 5-7 recommended areas to focus on during the next visit with specific actions"
        },
        red_flags: {
          type: "array",
          items: {
            type: "object",
            properties: {
              flag: { type: "string" },
              evidence: { type: "string" },
              clinical_significance: { type: "string" },
              recommended_timeframe: { type: "string" }
            }
          },
          description: "Immediate clinical concerns requiring urgent attention"
        },
        trending_changes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              parameter: { type: "string" },
              trend_direction: { type: "string", enum: ["improving", "stable", "declining", "fluctuating"] },
              quantified_change: { type: "string" },
              clinical_impact: { type: "string" }
            }
          },
          description: "Quantified changes in key clinical parameters over time"
        },
        care_gaps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              gap_type: { type: "string" },
              description: { type: "string" },
              impact: { type: "string", enum: ["critical", "high", "moderate", "low"] },
              recommendation: { type: "string" }
            }
          },
          description: "Identified gaps in care delivery or documentation"
        }
      }
    }
  });
  return { success: true, data: res };
}

async function generateDraftNote(base44, patientId, visitType, diagnosis, providerType, careSetting, vitalSigns) {
  let patientContext = '';
  if (patientId) {
    const patients = await base44.asServiceRole.entities.Patient.list();
    const patient = patients.find(p => p.id === patientId);
    if (patient) {
      const visits = await base44.asServiceRole.entities.Visit.filter({ patient_id: patientId }, '-visit_date', 5);
      const carePlans = await base44.asServiceRole.entities.CarePlan.filter({ patient_id: patientId });
      patientContext = buildPatientContext(patient, visits, carePlans, []);
    }
  }

  const vitalsStr = vitalSigns ? `
CURRENT VITAL SIGNS:
- Temp: ${vitalSigns.temperature || 'N/A'}°F
- HR: ${vitalSigns.heart_rate || 'N/A'} bpm
- RR: ${vitalSigns.respiratory_rate || 'N/A'}
- BP: ${vitalSigns.bp_systolic || 'N/A'}/${vitalSigns.bp_diastolic || 'N/A'} mmHg
- O2 Sat: ${vitalSigns.oxygen_saturation || 'N/A'}%` : '';

  const res = await base44.integrations.Core.InvokeLLM({
    prompt: `You are an expert ${providerType || 'RN'} clinical documentation specialist in ${careSetting || 'home_health'}. Generate a comprehensive draft clinical note for the following visit.

VISIT TYPE: ${visitType || 'skilled_nursing'}
PRIMARY DIAGNOSIS: ${diagnosis || 'Not specified'}
${vitalsStr}

${patientContext || 'No patient data available - generate a template note.'}

Generate a Medicare-compliant clinical note that:
1. Uses the SOAP format (Subjective, Objective, Assessment, Plan)
2. Includes homebound status justification
3. Documents skilled need and medical necessity
4. References specific diagnoses with ICD-10 awareness
5. Includes patient education provided
6. Documents care coordination activities
7. Notes medication reconciliation
8. Includes safety assessment findings
9. References care plan goals and progress
10. Is ready for clinician review and personalization

Mark sections where the clinician needs to add specifics with [FILL IN].`,
    response_json_schema: {
      type: "object",
      properties: {
        draft_note: { type: "string", description: "Complete formatted clinical note" },
        note_sections: {
          type: "object",
          properties: {
            subjective: { type: "string" },
            objective: { type: "string" },
            assessment: { type: "string" },
            plan: { type: "string" },
            homebound_justification: { type: "string" },
            skilled_need: { type: "string" },
            education_provided: { type: "string" },
            care_coordination: { type: "string" }
          }
        },
        fill_in_prompts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              section: { type: "string" },
              prompt: { type: "string" },
              importance: { type: "string", enum: ["required", "recommended", "optional"] }
            }
          },
          description: "Sections where clinician needs to add their own observations"
        },
        compliance_notes: {
          type: "array",
          items: { type: "string" },
          description: "Key compliance items included in this note"
        },
        icd10_suggestions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              code: { type: "string" },
              description: { type: "string" },
              supporting_documentation: { type: "string" }
            }
          },
          description: "Suggested ICD-10 codes based on documented findings"
        },
        oasis_considerations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              oasis_item: { type: "string" },
              documented_support: { type: "string" },
              scoring_guidance: { type: "string" }
            }
          },
          description: "OASIS items that should be considered based on this visit documentation"
        },
        quality_indicators: {
          type: "object",
          properties: {
            homebound_strength: { type: "string", enum: ["strong", "adequate", "weak", "missing"] },
            skilled_need_strength: { type: "string", enum: ["strong", "adequate", "weak", "missing"] },
            specificity_level: { type: "string", enum: ["excellent", "good", "needs_improvement", "insufficient"] },
            measurable_data: { type: "boolean" },
            care_plan_integration: { type: "boolean" }
          }
        }
      }
    }
  });
  return { success: true, data: res };
}

async function suggestAssessments(base44, patientId, noteContent, visitType, diagnosis) {
  let patientContext = '';
  if (patientId) {
    const patients = await base44.asServiceRole.entities.Patient.list();
    const patient = patients.find(p => p.id === patientId);
    if (patient) {
      const visits = await base44.asServiceRole.entities.Visit.filter({ patient_id: patientId }, '-visit_date', 5);
      const carePlans = await base44.asServiceRole.entities.CarePlan.filter({ patient_id: patientId });
      const alerts = await base44.asServiceRole.entities.PatientAlert.filter({ patient_id: patientId });
      patientContext = buildPatientContext(patient, visits, carePlans, alerts.filter(a => a.status === 'active'));
    }
  }

  const res = await base44.integrations.Core.InvokeLLM({
    prompt: `You are a Medicare compliance expert and OASIS-E specialist with deep knowledge of CMS regulations, PDGM grouping, and home health quality measures. Provide evidence-based assessment recommendations.

**CLINICAL CONTEXT:**
VISIT TYPE: ${visitType || 'skilled_nursing'}
DIAGNOSIS: ${diagnosis || 'Not specified'}

${patientContext || 'No patient context available.'}

**CURRENT DOCUMENTATION:**
${noteContent || 'No note content yet - provide comprehensive assessment recommendations based on visit type and diagnosis.'}

**ANALYSIS REQUIREMENTS:**

1. **OASIS-E Item Recommendations:**
   - Identify ALL relevant OASIS items based on: diagnosis, functional status, wounds, medications, equipment, cognitive status, behaviors, and visit timing
   - For EACH item, provide:
     * Specific clinical evidence from patient data supporting the need for assessment
     * Expected score range based on documented findings (with confidence level)
     * PDGM impact: how this item affects case mix grouping and payment
     * Documentation requirements to support the scoring
   - Prioritize items with HIGH PDGM impact (clinical grouping, functional impairment, comorbidity adjustment)

2. **Evidence-Based Clinical Rationale:**
   - Link every recommendation to specific patient data points (diagnosis, age, functional status, etc.)
   - Cite relevant Medicare guidelines or clinical standards
   - Explain clinical significance - why this assessment matters for patient outcomes
   - Identify potential risks if assessment is not completed

3. **Compliance Gap Analysis:**
   - Identify missing required documentation elements for Medicare compliance
   - Flag areas where current documentation is insufficient to support OASIS scoring
   - Note any conflicting information that needs clarification
   - Highlight missing assessments that could trigger survey findings

4. **Screening Tool Recommendations:**
   - Recommend validated screening tools based on diagnosis and risk factors (PHQ-9 for depression, Braden for pressure injury risk, MMSE for cognitive, IADL scales, etc.)
   - Specify frequency of administration based on CMS guidelines
   - Explain how results inform care planning and OASIS scoring

5. **Quality Measure Applicability:**
   - Identify applicable HHQRP measures for this patient
   - Note documentation needed to support quality measure reporting
   - Flag opportunities for quality improvement

6. **Prioritization:**
   - Rank recommendations by URGENCY (immediate vs. next visit vs. routine)
   - Consider clinical acuity, payment impact, and compliance risk
   - Focus on high-value assessments that improve both care and reimbursement

**OUTPUT STANDARDS:**
- Be SPECIFIC with item numbers (e.g., "M1860 - Ambulation/Locomotion")
- Provide ACTIONABLE guidance that nurses can immediately use
- Include confidence levels for scoring recommendations
- Cite evidence basis for every recommendation`,
    response_json_schema: {
      type: "object",
      properties: {
        oasis_items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              item_number: { type: "string" },
              item_name: { type: "string" },
              relevance: { type: "string" },
              suggested_response: { type: "string" },
              clinical_rationale: { type: "string" },
              pdgm_impact: { type: "string", enum: ["high", "moderate", "low", "none"] },
              pdgm_grouping_affected: { type: "string", description: "Which PDGM component this impacts (clinical, functional, comorbidity)" },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
              evidence_from_documentation: { type: "string", description: "Specific evidence from patient data supporting this recommendation" },
              documentation_needed: { type: "string", description: "What additional documentation is needed to support accurate scoring" }
            }
          }
        },
        screening_tools: {
          type: "array",
          items: {
            type: "object",
            properties: {
              tool_name: { type: "string" },
              reason: { type: "string" },
              urgency: { type: "string", enum: ["required_now", "recommended", "if_indicated"] },
              frequency: { type: "string" },
              evidence_basis: { type: "string", description: "Clinical evidence or guidelines supporting this recommendation" },
              expected_outcome: { type: "string", description: "What this screening will reveal or inform" }
            }
          }
        },
        compliance_gaps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              gap: { type: "string" },
              requirement: { type: "string" },
              regulation_reference: { type: "string", description: "Specific CMS regulation or guideline" },
              severity: { type: "string", enum: ["critical", "high", "moderate", "low"] },
              potential_consequences: { type: "string", description: "What could happen if gap is not addressed" },
              fix_suggestion: { type: "string" },
              example_documentation: { type: "string", description: "Example of compliant documentation" }
            }
          }
        },
        quality_measures: {
          type: "array",
          items: {
            type: "object",
            properties: {
              measure: { type: "string" },
              applicable: { type: "boolean" },
              documentation_needed: { type: "string" }
            }
          }
        }
      }
    }
  });
  return { success: true, data: res };
}

async function qualityFeedback(base44, noteContent, visitType, diagnosis, providerType, careSetting) {
  if (!noteContent || noteContent.trim().length < 20) {
    return { success: true, data: { overall_score: 0, feedback: "Note is too short to evaluate." } };
  }

  const res = await base44.integrations.Core.InvokeLLM({
    prompt: `You are an expert clinical documentation quality analyst with specialized training in ${careSetting || 'home_health'} Medicare compliance for ${providerType || 'RN'} documentation. You have extensive experience reviewing notes for CMS audits and understand what differentiates excellent documentation from adequate or deficient documentation.

**VISIT CONTEXT:**
VISIT TYPE: ${visitType || 'skilled_nursing'}
DIAGNOSIS: ${diagnosis || 'Not specified'}
PROVIDER: ${providerType || 'RN'}
CARE SETTING: ${careSetting || 'home_health'}

**NOTE TO EVALUATE:**
${noteContent}

**EVALUATION FRAMEWORK:**

Analyze this note using a comprehensive quality framework. For EACH criterion, you must:
1. Identify what is PRESENT and done well (be specific - quote exact phrases)
2. Identify what is MISSING or deficient (be specific - what elements are absent?)
3. Assess the CLINICAL IMPACT of any deficiencies
4. Provide ACTIONABLE improvement suggestions with EXAMPLE TEXT that can be directly used

**SCORING CRITERIA (0-100 for each):**

1. **Clinical Completeness** (0-100):
   - Are all SOAP elements fully developed?
   - Is assessment detailed and system-specific?
   - Are clinical findings quantified and measured?
   - Is there a clear clinical narrative?

2. **Medicare Compliance** (0-100):
   - Does it meet CMS documentation standards?
   - Are all mandatory elements present?
   - Would this withstand an audit?
   - Are there any compliance red flags?

3. **Skilled Need Justification** (0-100):
   - Is the complexity of care clearly articulated?
   - Is skilled nursing/therapy explicitly justified?
   - Are interventions beyond caregiver capability?
   - Is ongoing assessment need documented?

4. **Homebound Status** (0-100):
   - Are specific limitations documented?
   - Is "taxing effort" language used?
   - Are assistive devices/support needs noted?
   - Is leaving home contraindicated?

5. **Specificity & Detail** (0-100):
   - Are measurements quantified (not "improved" but "edema reduced from 3+ to 1+")?
   - Are dates and times included?
   - Are comparisons to baseline made?
   - Is medical terminology precise?

6. **Care Plan Alignment** (0-100):
   - Are care plan goals referenced by name/number?
   - Is progress quantified with objective data?
   - Are interventions linked to goals?
   - Are barriers to progress identified?

7. **Patient Education** (0-100):
   - Are specific topics documented?
   - Is teach-back method used and response documented?
   - Are patient's exact words quoted?
   - Are barriers to learning noted?

8. **Safety Assessment** (0-100):
   - Is fall risk assessed with specific factors?
   - Is medication safety addressed?
   - Is home environment evaluated?
   - Is emergency preparedness documented?

9. **Medication Documentation** (0-100):
   - Is medication reconciliation performed?
   - Are side effects assessed?
   - Is adherence evaluated?
   - Is patient knowledge documented?

10. **Professional Language** (0-100):
   - Is clinical terminology appropriate for provider type?
   - Is language objective and professional?
   - Are abbreviations appropriate and standard?
   - Is grammar and structure clear?

**SCORING STANDARDS:**
- 90-100: Excellent - Exemplary documentation, audit-ready
- 80-89: Good - Solid documentation with minor improvements needed
- 70-79: Adequate - Meets minimum requirements but lacks depth
- 60-69: Needs Improvement - Missing key elements, compliance concerns
- Below 60: Deficient - Significant gaps, would not withstand audit

**IMPROVEMENT GUIDANCE:**
For ANY element scoring below 85 (not just 80), provide:
1. Specific issue with quoted examples from the note
2. Why this matters for compliance/quality/payment
3. Actionable fix with EXAMPLE TEXT that demonstrates excellence
4. Impact on overall note quality if fixed

**OUTPUT REQUIREMENTS:**
- Be constructively critical - identify both strengths AND weaknesses
- Provide example text that is specific to THIS patient and visit
- Prioritize improvements by impact (what gives biggest quality boost?)
- Consider the cumulative effect of multiple minor issues`,
    response_json_schema: {
      type: "object",
      properties: {
        overall_score: { type: "number", description: "Weighted average 0-100" },
        letter_grade: { type: "string", enum: ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D", "F"] },
        score_breakdown: {
          type: "object",
          properties: {
            clinical_completeness: { type: "number" },
            medicare_compliance: { type: "number" },
            skilled_need: { type: "number" },
            homebound_status: { type: "number" },
            specificity: { type: "number" },
            care_plan_alignment: { type: "number" },
            patient_education: { type: "number" },
            safety_assessment: { type: "number" },
            medication_documentation: { type: "number" },
            professional_language: { type: "number" }
          }
        },
        strengths: {
          type: "array",
          items: { type: "string" },
          description: "What the note does well"
        },
        improvements: {
          type: "array",
          items: {
            type: "object",
            properties: {
              category: { type: "string" },
              current_text: { type: "string", description: "Quote from note showing the issue" },
              issue: { type: "string" },
              severity: { type: "string", enum: ["critical", "important", "suggested"] },
              why_it_matters: { type: "string", description: "Clinical, compliance, or payment impact" },
              suggestion: { type: "string" },
              example_text: { type: "string", description: "Specific example text that demonstrates excellent documentation" },
              impact_on_score: { type: "number", description: "Potential score improvement if fixed (0-20 points)" }
            }
          }
        },
        missing_elements: {
          type: "array",
          items: { type: "string" },
          description: "Required elements completely missing"
        },
        quick_fixes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              fix: { type: "string" },
              section: { type: "string", description: "Where to add this (Subjective, Objective, Assessment, Plan)" },
              impact: { type: "string", enum: ["high", "medium", "low"] },
              score_improvement: { type: "number", description: "Estimated points gained (0-15)" },
              text_to_add: { type: "string" },
              placement_guidance: { type: "string", description: "Exactly where in the section to add this" }
            }
          },
          description: "Quick text additions that would improve the score, prioritized by impact"
        },
        audit_readiness: {
          type: "object",
          properties: {
            overall_assessment: { type: "string", enum: ["audit_ready", "minor_revisions_needed", "major_revisions_needed", "not_audit_ready"] },
            compliance_risks: { type: "array", items: { type: "string" } },
            payment_risks: { type: "array", items: { type: "string" } },
            quality_measure_impact: { type: "string" }
          }
        },
        comparison_to_best_practice: {
          type: "object",
          properties: {
            what_excellent_notes_include: { type: "array", items: { type: "string" } },
            gaps_from_excellence: { type: "array", items: { type: "string" } }
          }
        }
      }
    }
  });
  return { success: true, data: res };
}

async function drugInteractionCheck(base44, patientId, noteContent, diagnosis) {
  if (!patientId) return { success: true, data: { interaction_alerts: [], summary: 'No patient selected.' } };

  const patients = await base44.asServiceRole.entities.Patient.list();
  const patient = patients.find(p => p.id === patientId);
  if (!patient) return { error: 'Patient not found' };

  const medications = (patient.current_medications || []).map(m => ({
    name: m.name,
    dosage: m.dosage,
    frequency: m.frequency,
    route: m.route,
    indication: m.indication,
    start_date: m.start_date
  }));
  const medListStr = medications.map(m => `${m.name} ${m.dosage} ${m.frequency} ${m.route || ''} (${m.indication || 'indication not specified'})`).join('; ');
  
  const diagnoses = [patient.primary_diagnosis, ...(patient.secondary_diagnoses || [])].filter(Boolean);
  const chronicConditions = (patient.chronic_conditions || []).map(c => `${c.condition} (${c.severity || 'unspecified severity'})`);
  const allConditions = [...diagnoses, ...chronicConditions].join(', ');
  
  const allergies = patient.allergies || 'NKDA';
  const age = patient.date_of_birth ? Math.floor((Date.now() - new Date(patient.date_of_birth).getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : null;
  
  const renalFunction = patient.lab_results?.find(l => l.test_name?.toLowerCase().includes('creatinine') || l.test_name?.toLowerCase().includes('gfr'));
  const hepaticFunction = patient.lab_results?.find(l => l.test_name?.toLowerCase().includes('alt') || l.test_name?.toLowerCase().includes('ast'));

  const res = await base44.integrations.Core.InvokeLLM({
    prompt: `You are a board-certified clinical pharmacist with expertise in geriatric pharmacotherapy, polypharmacy management, and medication safety in home health settings. Perform a comprehensive medication safety analysis.

**PATIENT PROFILE:**
- Age: ${age || 'unknown'} years
- Documented Allergies: ${allergies}
- Active Diagnoses: ${allConditions || 'None documented'}
- Current Visit Diagnosis: ${diagnosis || 'N/A'}
${renalFunction ? `- Renal Function: ${renalFunction.value} ${renalFunction.unit} (${renalFunction.date})` : '- Renal Function: Not available'}
${hepaticFunction ? `- Hepatic Function: ${hepaticFunction.value} ${hepaticFunction.unit} (${hepaticFunction.date})` : '- Hepatic Function: Not available'}

**COMPLETE MEDICATION LIST (${medications.length} medications):**
${medListStr || 'No medications documented'}

**COMPREHENSIVE ANALYSIS REQUIRED:**

1. **Drug-Drug Interactions:**
   - Screen for ALL potential interactions (major, moderate, minor)
   - Explain pharmacokinetic/pharmacodynamic mechanisms
   - Assess clinical significance in THIS specific patient context
   - Consider timing of administration for interaction mitigation

2. **Drug-Disease Contraindications:**
   - Cross-reference each medication against ALL patient diagnoses
   - Identify absolute and relative contraindications
   - Assess risk-benefit for necessary medications with contraindications
   - Flag medications that could worsen existing conditions

3. **Drug-Allergy Conflicts:**
   - Check for direct allergies and cross-sensitivities
   - Assess severity of potential reactions
   - Identify safer alternatives if conflicts exist

4. **Dosing Concerns:**
   - Evaluate appropriateness for age, renal function, hepatic function
   - Flag super therapeutic or subtherapeutic doses
   - Identify need for dose adjustments or therapeutic monitoring
   - Consider pharmacogenomic factors if age >65 or multiple comorbidities

5. **Duplicate Therapy:**
   - Identify medications in same therapeutic class
   - Assess if duplication is intentional/appropriate
   - Calculate cumulative effects (e.g., anticholinergic burden, CNS depression)

6. **High-Risk Medications:**
   - Flag Beers Criteria medications in elderly patients
   - Identify anticoagulants, diabetes medications, opioids requiring monitoring
   - Note medications requiring patient education and monitoring

7. **Therapeutic Gaps:**
   - Identify missing medications based on diagnoses and evidence-based guidelines
   - Flag undertreated conditions
   - Note preventive medications that should be considered

8. **Polypharmacy Risk Assessment:**
   - Calculate medication burden and complexity
   - Assess adherence challenges
   - Identify deprescribing opportunities
   - Consider drug-induced problems contributing to current presentation

**MONITORING & ACTION REQUIREMENTS:**
- Specify WHAT to monitor, HOW OFTEN, and WHAT VALUES indicate concern
- Prioritize actions by URGENCY: immediate physician notification vs. next visit discussion
- Provide specific, actionable recommendations that home health nurses can implement
- Include patient/caregiver education points

**OUTPUT STANDARDS:**
- Cite evidence basis (drug interaction databases, guidelines, pharmacology principles)
- Be specific with medication names, doses, and clinical effects
- Provide clear risk stratification
- Focus on clinically significant issues (avoid overwhelming with minor interactions)
- Consider home health context (medication adherence, caregiver capability, monitoring feasibility)`,
    response_json_schema: {
      type: "object",
      properties: {
        risk_level: { type: "string", enum: ["safe", "low_risk", "moderate_risk", "high_risk", "critical"] },
        summary: { type: "string", description: "Executive summary of medication safety status" },
        total_medications: { type: "number" },
        polypharmacy_risk: { type: "string", enum: ["none", "low", "moderate", "high"] },
        interaction_alerts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              alert_type: { type: "string", enum: ["drug_drug", "drug_disease", "drug_allergy", "dose_concern", "duplicate_therapy", "high_risk_med", "missing_medication"] },
              severity: { type: "string", enum: ["critical", "high", "moderate", "low", "informational"] },
              title: { type: "string" },
              medications_involved: { type: "array", items: { type: "string" } },
              mechanism: { type: "string", description: "Pharmacokinetic/pharmacodynamic explanation" },
              clinical_significance: { type: "string", description: "What could happen to THIS patient" },
              evidence_basis: { type: "string", description: "Reference to interaction database or clinical literature" },
              onset_timeframe: { type: "string", description: "When effects might be seen" },
              recommended_action: { type: "string", description: "Specific action for home health nurse" },
              alternative_medications: { type: "array", items: { type: "string" }, description: "Safer alternatives if change needed" },
              monitoring_needed: { type: "string", description: "Specific parameters to monitor" },
              patient_education_points: { type: "array", items: { type: "string" } },
              requires_physician_notification: { type: "boolean" },
              notification_urgency: { type: "string", enum: ["immediate", "within_24hrs", "next_visit", "routine"] }
            }
          }
        },
        safe_medications: { type: "array", items: { type: "string" }, description: "Medications with no identified concerns" },
        monitoring_schedule: {
          type: "array",
          items: {
            type: "object",
            properties: {
              medication: { type: "string" },
              what_to_monitor: { type: "string" },
              frequency: { type: "string" }
            }
          }
        },
        deprescribing_opportunities: {
          type: "array",
          items: {
            type: "object",
            properties: {
              medication: { type: "string" },
              rationale: { type: "string" },
              safety_benefit: { type: "string" },
              tapering_needed: { type: "boolean" }
            }
          },
          description: "Medications that could potentially be discontinued"
        },
        adherence_assessment: {
          type: "object",
          properties: {
            complexity_score: { type: "string", enum: ["low", "moderate", "high", "very_high"] },
            barriers_identified: { type: "array", items: { type: "string" } },
            adherence_aids_recommended: { type: "array", items: { type: "string" } }
          }
        },
        physician_notifications: {
          type: "array",
          items: {
            type: "object",
            properties: {
              issue: { type: "string" },
              urgency: { type: "string", enum: ["immediate", "within_24hrs", "next_visit", "routine"] },
              suggested_communication: { type: "string", description: "Draft message for physician communication" },
              requires_order: { type: "boolean" },
              specific_questions: { type: "array", items: { type: "string" } }
            }
          }
        },
        beers_criteria_alerts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              medication: { type: "string" },
              beers_category: { type: "string" },
              rationale: { type: "string" },
              alternative: { type: "string" }
            }
          },
          description: "Potentially inappropriate medications in elderly patients"
        }
      }
    }
  });
  return { success: true, data: res };
}

async function diagnosticReferralSuggestions(base44, patientId, noteContent, visitType, diagnosis, providerType, careSetting) {
  let patientContext = '';
  if (patientId) {
    const patients = await base44.asServiceRole.entities.Patient.list();
    const patient = patients.find(p => p.id === patientId);
    if (patient) {
      const visits = await base44.asServiceRole.entities.Visit.filter({ patient_id: patientId }, '-visit_date', 5);
      const carePlans = await base44.asServiceRole.entities.CarePlan.filter({ patient_id: patientId });
      patientContext = buildPatientContext(patient, visits, carePlans, []);
    }
  }

  const patient = patients.find(p => p.id === patientId);
  const patientAge = patient?.date_of_birth ? Math.floor((Date.now() - new Date(patient.date_of_birth).getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : null;
  const patientGender = patient?.gender || 'unknown';
  const lastLabDate = patient?.lab_results?.[0]?.date || 'No recent labs on file';
  const medications = (patient?.current_medications || []).map(m => m.name).join(', ');

  const res = await base44.integrations.Core.InvokeLLM({
    prompt: `You are an expert clinical decision support specialist with deep knowledge of evidence-based medicine, clinical practice guidelines, preventive care recommendations, and Medicare coverage criteria. Provide comprehensive, actionable diagnostic and referral recommendations.

**CLINICAL CONTEXT:**
VISIT TYPE: ${visitType || 'skilled_nursing'}
PRIMARY DIAGNOSIS: ${diagnosis || 'N/A'}
PROVIDER: ${providerType || 'RN'}
CARE SETTING: ${careSetting || 'home_health'}
PATIENT AGE: ${patientAge || 'unknown'}
PATIENT GENDER: ${patientGender}
MEDICATIONS: ${medications || 'None'}
LAST LABS: ${lastLabDate}

**COMPREHENSIVE PATIENT DATA:**
${patientContext || 'Limited patient context available.'}

${noteContent ? `**CURRENT VISIT NOTES:**\n${noteContent.substring(0, 800)}\n` : '**No visit notes available yet.**\n'}

**ANALYSIS REQUIREMENTS:**

1. **Diagnostic Testing Recommendations:**
   - Review diagnosis and identify ALL indicated tests per clinical guidelines
   - Consider: disease monitoring labs, medication monitoring, screening tests, diagnostic workup
   - For EACH recommended test, provide:
     * Specific clinical indication linking to patient data
     * Evidence basis (cite guidelines: CDC, USPSTF, disease-specific societies)
     * Optimal timing/urgency based on clinical status
     * What the test will reveal and how it impacts care
     * Medicare coverage requirements and medical necessity justification
     * Specific action for home health nurse (order needed? patient education? physician communication?)
   
   - Prioritize by:
     * Clinical urgency (STAT → Routine)
     * Impact on immediate care decisions
     * Patient safety considerations
     * Overdue screening/monitoring

2. **Specialist Referral Recommendations:**
   - Analyze diagnoses and identify conditions requiring specialist input
   - Consider: lack of improvement, disease complexity, need for specialized procedures
   - For EACH referral, provide:
     * Compelling clinical rationale with specific patient findings
     * Type of specialist needed
     * Urgency based on clinical trajectory
     * Key clinical information to share with specialist
     * Expected benefit to patient care
     * Questions for specialist to address
   
   - Use evidence-based referral criteria
   - Consider patient preferences and access barriers

3. **Therapy Referral Recommendations (PT/OT/ST):**
   - Assess functional deficits and therapy needs
   - Link recommendations to specific functional limitations and goals
   - For EACH therapy type:
     * Clinical indication with objective functional data
     * Expected functional goals (specific, measurable)
     * Recommended frequency and duration
     * How therapy impacts homebound status and OASIS scoring
     * Medical necessity justification
   
   - Consider patient's rehabilitation potential and motivation
   - Note contraindications or precautions

4. **Preventive Care Gap Analysis:**
   - Apply age-based and gender-based screening guidelines
   - Check immunization status (influenza, pneumococcal, COVID, shingles, Tdap)
   - Assess cancer screening status (colorectal, breast, cervical, lung based on risk)
   - Review cardiovascular screening (lipids, BP, diabetes screening)
   - Consider bone density, vision, hearing, fall risk screening
   - For EACH gap:
     * What is overdue
     * Why it matters for THIS patient
     * How to facilitate completion
     * Patient education needed

5. **Point-of-Care Testing:**
   - Identify tests feasible in home health setting (glucose, INR, urine dipstick, pulse ox)
   - Link to immediate clinical decision-making needs
   - Provide frequency and action thresholds

6. **Physician Communication Planning:**
   - Identify findings requiring physician notification
   - Draft specific, concise communication with clinical rationale
   - Clarify what orders are needed
   - Frame questions to get actionable responses

**CRITICAL CONSIDERATIONS:**
- Provider role: ${providerType} can assess/recommend but not order independently
- Care setting: Home health context affects test feasibility and urgency
- Patient preferences: Consider patient's values and goals of care
- Medicare coverage: Ensure medical necessity is clear
- Coordination: Multiple recommendations need prioritization and sequencing

**OUTPUT STANDARDS:**
- Every recommendation must have clear, patient-specific evidence basis
- Cite specific guidelines, studies, or clinical criteria
- Prioritize ruthlessly - focus on high-impact, clinically necessary recommendations
- Make actionable - tell nurse exactly what to do next
- Consider feasibility in home health setting
- Link recommendations to patient outcomes and quality measures`,
    response_json_schema: {
      type: "object",
      properties: {
        urgency_summary: { type: "string", description: "Overall clinical urgency assessment" },
        diagnostic_tests: {
          type: "array",
          items: {
            type: "object",
            properties: {
              test_name: { type: "string" },
              test_category: { type: "string", enum: ["lab", "imaging", "screening", "medication_monitoring", "point_of_care"] },
              urgency: { type: "string", enum: ["stat", "within_24hrs", "within_week", "routine", "next_visit"] },
              clinical_indication: { type: "string", description: "Why THIS patient needs this test based on their specific clinical data" },
              evidence_basis: { type: "string", description: "Clinical guideline or standard of care (cite source)" },
              expected_findings: { type: "string", description: "What this test will reveal and how it impacts care" },
              last_performed: { type: "string", description: "When test was last done if available" },
              optimal_frequency: { type: "string", description: "How often this should be done per guidelines" },
              medicare_coverage_criteria: { type: "string", description: "Medical necessity justification for coverage" },
              nurse_action: { type: "string", description: "Specific action for home health nurse" },
              patient_preparation: { type: "string", description: "Any patient prep needed (fasting, timing, etc.)" },
              requires_physician_order: { type: "boolean" },
              order_urgency: { type: "string", enum: ["immediate", "this_week", "next_visit", "routine"] }
            }
          }
        },
        specialist_referrals: {
          type: "array",
          items: {
            type: "object",
            properties: {
              specialty: { type: "string" },
              referral_type: { type: "string", enum: ["new_referral", "follow_up", "urgent_consult", "evaluation"] },
              urgency: { type: "string", enum: ["emergent", "urgent", "routine", "when_available"] },
              clinical_rationale: { type: "string", description: "Compelling reason based on patient's clinical trajectory" },
              specific_patient_findings: { type: "array", items: { type: "string" }, description: "Key clinical data points supporting referral" },
              key_findings_to_share: { type: "string", description: "Critical information for specialist" },
              questions_for_specialist: { type: "array", items: { type: "string" }, description: "Specific clinical questions to address" },
              expected_specialist_actions: { type: "string", description: "What we expect specialist to do/recommend" },
              evidence_basis: { type: "string", description: "Referral criteria or guidelines" },
              patient_acceptance_factors: { type: "string", description: "Considerations for patient willingness/ability" }
            }
          }
        },
        therapy_recommendations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              therapy_type: { type: "string", enum: ["physical_therapy", "occupational_therapy", "speech_therapy", "respiratory_therapy"] },
              indication: { type: "string", description: "Specific functional deficit or therapy need" },
              objective_functional_data: { type: "string", description: "Measurable functional limitations" },
              goals: { type: "string", description: "Specific, measurable functional goals" },
              frequency_suggestion: { type: "string", description: "Recommended visits per week and duration" },
              rehabilitation_potential: { type: "string", enum: ["excellent", "good", "fair", "poor"] },
              impact_on_independence: { type: "string", description: "How therapy will improve patient's function" },
              oasis_considerations: { type: "string", description: "Impact on functional OASIS items" },
              medical_necessity_statement: { type: "string", description: "Justification for Medicare coverage" },
              urgency: { type: "string", enum: ["urgent", "routine", "when_available"] }
            }
          }
        },
        physician_communications: {
          type: "array",
          items: {
            type: "object",
            properties: {
              topic: { type: "string" },
              urgency: { type: "string", enum: ["immediate", "within_24hrs", "next_visit", "routine"] },
              suggested_message: { type: "string" },
              requires_order: { type: "boolean" }
            }
          }
        },
        preventive_care_gaps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              measure: { type: "string" },
              guideline_source: { type: "string", description: "USPSTF, CDC, or other guideline" },
              patient_risk_factors: { type: "string", description: "Why this is especially important for this patient" },
              last_done: { type: "string" },
              due: { type: "string" },
              overdue_by: { type: "string", description: "How long overdue if applicable" },
              action_needed: { type: "string", description: "Specific steps to complete screening" },
              barriers: { type: "string", description: "Potential obstacles to completion" },
              patient_education_needed: { type: "string" }
            }
          }
        }
      }
    }
  });
  return { success: true, data: res };
}

function buildPatientContext(patient, visits, carePlans, alerts) {
  const recentNotes = visits
    .filter(v => v.nurse_notes && v.status === 'completed')
    .slice(0, 5)
    .map(v => `[${v.visit_date} - ${v.visit_type}]: ${v.nurse_notes.substring(0, 600)}`);

  const vitalsTrend = visits
    .filter(v => v.vital_signs)
    .slice(0, 5)
    .map(v => ({
      date: v.visit_date,
      bp: v.vital_signs.blood_pressure_systolic ? `${v.vital_signs.blood_pressure_systolic}/${v.vital_signs.blood_pressure_diastolic}` : null,
      hr: v.vital_signs.heart_rate,
      o2: v.vital_signs.oxygen_saturation,
      temp: v.vital_signs.temperature,
      pain: v.vital_signs.pain_level,
      weight: v.vital_signs.weight
    }));

  return `
PATIENT: ${patient.first_name} ${patient.last_name}, DOB: ${patient.date_of_birth || 'unknown'}
PRIMARY DIAGNOSIS: ${patient.primary_diagnosis || 'Not specified'}
SECONDARY DIAGNOSES: ${(patient.secondary_diagnoses || []).join(', ') || 'None'}
CHRONIC CONDITIONS: ${(patient.chronic_conditions || []).map(c => `${c.condition} (${c.severity || 'unknown'})`).join(', ') || 'None'}
MEDICATIONS: ${(patient.current_medications || []).map(m => `${m.name} ${m.dosage} ${m.frequency}`).join('; ') || 'None'}
ALLERGIES: ${patient.allergies || 'NKDA'}
FUNCTIONAL STATUS: ADL=${patient.functional_status?.adl_independence || 'unknown'}, Ambulation=${patient.functional_status?.ambulation || 'unknown'}, Fall Risk=${patient.functional_status?.fall_risk || 'unknown'}, Cognitive=${patient.functional_status?.cognitive_status || 'unknown'}
LIVING SITUATION: ${patient.social_history?.living_situation || 'unknown'}
RISK SCORE: ${patient.risk_assessment?.score || 'Not calculated'} (${patient.risk_assessment?.level || 'unknown'})
ACTIVE CARE PLANS: ${carePlans.filter(cp => cp.status === 'active').map(cp => `${cp.problem}: ${cp.goal} (${cp.progress_percentage || 0}%)`).join('; ') || 'None'}
ACTIVE ALERTS: ${(alerts || []).map(a => `${a.alert_type}: ${a.title}`).join('; ') || 'None'}
PAST MEDICAL HISTORY: ${(patient.past_medical_history || []).join(', ') || 'None'}
ADVANCE DIRECTIVES: DNR=${patient.advance_directives?.dnr_status ? 'Yes' : 'No/Unknown'}, Living Will=${patient.advance_directives?.has_living_will ? 'Yes' : 'No/Unknown'}
SOCIAL DETERMINANTS: Housing=${patient.social_determinants?.housing_stability || 'unknown'}, Food=${patient.social_determinants?.food_security || 'unknown'}, Health Literacy=${patient.social_determinants?.health_literacy || 'unknown'}

VITAL SIGNS TREND:
${JSON.stringify(vitalsTrend, null, 1)}

RECENT VISIT NOTES:
${recentNotes.join('\n\n')}`;
}