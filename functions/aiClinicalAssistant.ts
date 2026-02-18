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

  const context = buildPatientContext(patient, visits, carePlans, alerts);

  const res = await base44.integrations.Core.InvokeLLM({
    prompt: `You are a clinical documentation specialist. Create a comprehensive yet concise medical history summary for the following patient. This summary will help clinicians quickly understand the patient's clinical picture before a visit.

${context}

Generate a structured, clinician-ready summary that includes:
1. Demographics & key identifiers
2. Active diagnoses prioritized by clinical significance
3. Medication overview with interactions/concerns
4. Recent visit pattern & findings
5. Active care plan status
6. Key risk factors
7. Social determinants affecting care
8. Trending vital signs analysis
9. Outstanding alerts or concerns
10. Recommended focus areas for the next visit

Be specific with dates, values, and clinical details. Flag any concerning patterns.`,
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
          items: { type: "string" },
          description: "Top 5 recommended areas to focus on during the next visit"
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
    prompt: `You are a CMS compliance and clinical assessment expert. Based on the patient data, visit type, and current documentation, suggest relevant OASIS items and other standardized assessments that should be completed or reviewed.

VISIT TYPE: ${visitType || 'skilled_nursing'}
DIAGNOSIS: ${diagnosis || 'Not specified'}

${patientContext || 'No patient context available.'}

CURRENT NOTE CONTENT:
${noteContent || 'No note content yet.'}

Analyze and suggest:
1. OASIS-E items that are relevant based on diagnosis, functional status, and visit type
2. Compliance gaps in the current documentation that need standardized assessments
3. Clinical screening tools that should be administered (PHQ-9, Braden, Morse Fall Scale, etc.)
4. Missing documentation elements required for Medicare compliance
5. Quality measures that apply to this patient
6. Areas where OASIS scoring may be affected by the current clinical picture

For each suggestion, explain WHY it matters for this specific patient.`,
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
              confidence: { type: "string", enum: ["high", "medium", "low"] }
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
              frequency: { type: "string" }
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
              severity: { type: "string", enum: ["critical", "high", "moderate", "low"] },
              fix_suggestion: { type: "string" }
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
    prompt: `You are a clinical documentation quality analyst specializing in ${careSetting || 'home_health'} for ${providerType || 'RN'} notes. Provide real-time quality and completeness feedback on this clinical note.

VISIT TYPE: ${visitType || 'skilled_nursing'}
DIAGNOSIS: ${diagnosis || 'Not specified'}
PROVIDER: ${providerType || 'RN'}
CARE SETTING: ${careSetting || 'home_health'}

NOTE CONTENT:
${noteContent}

Evaluate the note on ALL of the following criteria. Be specific about what's present and what's missing:

1. **Clinical Completeness** (0-100): Are all required clinical elements present?
2. **Medicare Compliance** (0-100): Does it meet CMS documentation requirements?
3. **Skilled Need Justification** (0-100): Is skilled need clearly documented?
4. **Homebound Status** (0-100): Is homebound status justified?
5. **Specificity & Detail** (0-100): Are findings specific with measurable data?
6. **Care Plan Alignment** (0-100): Does the note reference care plan goals/progress?
7. **Patient Education** (0-100): Is education documented with patient response?
8. **Safety Assessment** (0-100): Are safety concerns addressed?
9. **Medication Documentation** (0-100): Is medication management documented?
10. **Professional Language** (0-100): Is clinical terminology used appropriately?

For each element scored below 80, provide a specific, actionable improvement suggestion with example text.`,
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
              issue: { type: "string" },
              severity: { type: "string", enum: ["critical", "important", "suggested"] },
              suggestion: { type: "string" },
              example_text: { type: "string" }
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
              impact: { type: "string", enum: ["high", "medium", "low"] },
              text_to_add: { type: "string" }
            }
          },
          description: "Quick text additions that would improve the score"
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

  const medications = (patient.current_medications || []).map(m => `${m.name} ${m.dosage} ${m.frequency}`).join('; ');
  const diagnoses = [patient.primary_diagnosis, ...(patient.secondary_diagnoses || [])].filter(Boolean).join(', ');
  const allergies = patient.allergies || 'NKDA';
  const age = patient.date_of_birth ? Math.floor((Date.now() - new Date(patient.date_of_birth).getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : null;

  const res = await base44.integrations.Core.InvokeLLM({
    prompt: `Clinical pharmacology expert. Analyze drug interactions and contraindications.

PATIENT: Age ${age || 'unknown'}, Allergies: ${allergies}
DIAGNOSES: ${diagnoses}
MEDICATIONS: ${medications || 'None'}
VISIT DIAGNOSIS: ${diagnosis || 'N/A'}

Check: drug-drug interactions, drug-disease contraindications, drug-allergy conflicts, dose concerns, duplicate therapy, high-risk meds, missing medications, polypharmacy risk. Be concise.`,
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
              mechanism: { type: "string" },
              clinical_significance: { type: "string" },
              recommended_action: { type: "string" },
              monitoring_needed: { type: "string" },
              requires_physician_notification: { type: "boolean" }
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
              frequency: { type: "string" },
              target_range: { type: "string" }
            }
          }
        },
        physician_notifications: {
          type: "array",
          items: {
            type: "object",
            properties: {
              issue: { type: "string" },
              urgency: { type: "string", enum: ["immediate", "within_24hrs", "next_visit", "routine"] },
              suggested_message: { type: "string" }
            }
          }
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

  const res = await base44.integrations.Core.InvokeLLM({
    prompt: `Clinical decision support specialist. Recommend diagnostic tests and specialist referrals.

VISIT: ${visitType || 'skilled_nursing'}, DIAGNOSIS: ${diagnosis || 'N/A'}, PROVIDER: ${providerType || 'RN'}, SETTING: ${careSetting || 'home_health'}

${patientContext || 'No patient context.'}

${noteContent ? `NOTES: ${noteContent.substring(0, 500)}\n` : ''}

Suggest: overdue labs, indicated imaging, screening tools, medication monitoring tests, point-of-care tests, specialist referrals, therapy referrals (PT/OT/ST), preventive care gaps. Cite evidence basis. Be concise.`,
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
              clinical_indication: { type: "string" },
              evidence_basis: { type: "string" },
              expected_findings: { type: "string" },
              nurse_action: { type: "string", description: "What the nurse should do — order, collect, notify physician, etc." },
              requires_physician_order: { type: "boolean" }
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
              clinical_rationale: { type: "string" },
              key_findings_to_share: { type: "string" },
              expected_outcome: { type: "string" },
              evidence_basis: { type: "string" }
            }
          }
        },
        therapy_recommendations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              therapy_type: { type: "string", enum: ["physical_therapy", "occupational_therapy", "speech_therapy", "respiratory_therapy"] },
              indication: { type: "string" },
              goals: { type: "string" },
              frequency_suggestion: { type: "string" },
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
              last_done: { type: "string" },
              due: { type: "string" },
              action_needed: { type: "string" }
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