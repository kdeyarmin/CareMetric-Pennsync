import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const {
      patient_id,
      note_type = 'SOAP', // SOAP, Progress, Admission, Discharge
      encounter_data = {},
      visit_type,
      diagnosis,
      provider_type,
      care_setting,
      include_patient_history = true,
      free_text_input = ''
    } = await req.json();

    // Fetch patient data and history if requested
    let patient_context = null;
    if (patient_id && include_patient_history) {
      const patient = await base44.asServiceRole.entities.Patient.get(patient_id);
      
      const recent_visits = await base44.asServiceRole.entities.Visit.filter(
        { patient_id },
        '-visit_date',
        5
      );

      const active_care_plans = await base44.asServiceRole.entities.CarePlan.filter({
        patient_id,
        status: 'active'
      });

      patient_context = {
        demographics: {
          name: `${patient.first_name} ${patient.last_name}`,
          age: patient.date_of_birth ? calculateAge(patient.date_of_birth) : null,
          mrn: patient.medical_record_number
        },
        medical_history: {
          primary_diagnosis: patient.primary_diagnosis,
          secondary_diagnoses: patient.secondary_diagnoses || [],
          allergies: patient.allergies,
          medications: patient.current_medications || [],
          past_medical_history: patient.past_medical_history || []
        },
        recent_notes: recent_visits.slice(0, 3).map(v => ({
          date: v.visit_date,
          type: v.visit_type,
          summary: v.nurse_notes?.substring(0, 200) + '...'
        })),
        active_care_plans: active_care_plans.map(cp => ({
          problem: cp.problem,
          goal: cp.goal,
          interventions: cp.interventions,
          status: cp.status
        })),
        baseline_vitals: patient.baseline_vitals || {}
      };
    }

    // Build AI prompt based on note type
    const prompt = buildNoteGenerationPrompt({
      note_type,
      encounter_data,
      visit_type,
      diagnosis,
      provider_type,
      care_setting,
      patient_context,
      free_text_input
    });

    // Define schema based on note type
    const schema = getNoteSchema(note_type);

    // Generate note using LLM
    const generated_note = await base44.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: schema
    });

    // Format the note for display
    const formatted_note = formatGeneratedNote(generated_note, note_type);

    return Response.json({
      success: true,
      generated_note: formatted_note,
      structured_data: generated_note,
      metadata: {
        note_type,
        generated_at: new Date().toISOString(),
        provider: user.email,
        patient_id
      }
    });
  } catch (error) {
    console.error('Smart note generation error:', error);
    return Response.json({
      error: error.message,
      success: false
    }, { status: 500 });
  }
});

function calculateAge(dob) {
  const today = new Date();
  const birthDate = new Date(dob);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

function buildNoteGenerationPrompt({
  note_type,
  encounter_data,
  visit_type,
  diagnosis,
  provider_type,
  care_setting,
  patient_context,
  free_text_input
}) {
  let base_prompt = `You are an expert ${provider_type || 'healthcare provider'} creating comprehensive clinical documentation for a ${care_setting?.replace(/_/g, ' ')} setting.

Generate a detailed ${note_type} note based on the following information:`;

  // Add patient context if available
  if (patient_context) {
    base_prompt += `

PATIENT INFORMATION:
- Name: ${patient_context.demographics.name}
- Age: ${patient_context.demographics.age || 'Unknown'}
- MRN: ${patient_context.demographics.mrn || 'N/A'}
- Primary Diagnosis: ${patient_context.medical_history.primary_diagnosis || diagnosis}
- Active Medications: ${patient_context.medical_history.medications?.length || 0} medications
- Allergies: ${patient_context.medical_history.allergies || 'None documented'}

RECENT CLINICAL HISTORY:
${patient_context.recent_notes?.map((note, i) => 
  `${i + 1}. ${note.date}: ${note.type} - ${note.summary}`
).join('\n') || 'No recent visit history'}

ACTIVE CARE PLANS:
${patient_context.active_care_plans?.map((cp, i) => 
  `${i + 1}. Problem: ${cp.problem}\n   Goal: ${cp.goal}\n   Status: ${cp.status}`
).join('\n') || 'No active care plans'}`;
  }

  // Add current encounter data
  base_prompt += `

CURRENT ENCOUNTER:
- Visit Type: ${visit_type || 'Standard Visit'}
- Primary Diagnosis/Focus: ${diagnosis || 'Not specified'}`;

  if (encounter_data.chief_complaint) {
    base_prompt += `\n- Chief Complaint: ${encounter_data.chief_complaint}`;
  }

  if (encounter_data.vital_signs) {
    base_prompt += `\n- Vital Signs: ${JSON.stringify(encounter_data.vital_signs)}`;
  }

  if (encounter_data.symptoms) {
    base_prompt += `\n- Symptoms: ${encounter_data.symptoms}`;
  }

  if (encounter_data.physical_exam) {
    base_prompt += `\n- Physical Examination Findings: ${encounter_data.physical_exam}`;
  }

  if (encounter_data.medications_reviewed) {
    base_prompt += `\n- Medications Reviewed: ${encounter_data.medications_reviewed}`;
  }

  if (encounter_data.interventions) {
    base_prompt += `\n- Interventions Performed: ${encounter_data.interventions}`;
  }

  if (encounter_data.patient_response) {
    base_prompt += `\n- Patient Response: ${encounter_data.patient_response}`;
  }

  if (encounter_data.plan) {
    base_prompt += `\n- Plan/Recommendations: ${encounter_data.plan}`;
  }

  // Add free text input
  if (free_text_input) {
    base_prompt += `

ADDITIONAL CLINICAL NOTES:
${free_text_input}`;
  }

  // Add note type specific instructions
  base_prompt += `

${getNoteTypeInstructions(note_type, provider_type)}

CRITICAL REQUIREMENTS:
1. Incorporate relevant information from the patient's history and care plans
2. Ensure clinical accuracy and appropriate medical terminology
3. Make the note Medicare/insurance compliant with proper documentation
4. Include objective measurements and specific findings
5. Document patient status changes or progression since last visit
6. Be thorough but concise
7. Use professional medical language appropriate for ${provider_type || 'healthcare provider'}
8. Ensure continuity of care by referencing prior treatments/plans`;

  return base_prompt;
}

function getNoteTypeInstructions(note_type, provider_type) {
  switch (note_type) {
    case 'SOAP':
      return `Create a comprehensive SOAP note with:
- Subjective: Patient's reported symptoms, concerns, and history
- Objective: Physical findings, vital signs, test results, observations
- Assessment: Clinical impression, diagnosis, problem list
- Plan: Treatment plan, medications, follow-up, education provided`;

    case 'Progress':
      return `Create a progress note documenting:
- Current status and changes since last visit
- Response to treatments and interventions
- Progress toward care plan goals
- Any new concerns or complications
- Updated plan of care`;

    case 'Admission':
      return `Create a comprehensive admission note including:
- Reason for admission/referral
- Complete history and physical
- Comprehensive assessment
- Initial care plan
- Risk assessments (fall risk, pressure injury, etc.)
- Baseline measurements and status`;

    case 'Discharge':
      return `Create a discharge summary including:
- Summary of care provided
- Patient's status at discharge
- Goals achieved
- Discharge instructions and education
- Follow-up appointments
- Medication reconciliation
- Disposition and discharge location`;

    default:
      return `Create a comprehensive clinical note appropriate for a ${provider_type || 'healthcare provider'}.`;
  }
}

function getNoteSchema(note_type) {
  const base_schema = {
    type: "object",
    properties: {
      date: { type: "string" },
      time: { type: "string" }
    }
  };

  switch (note_type) {
    case 'SOAP':
      return {
        ...base_schema,
        properties: {
          ...base_schema.properties,
          subjective: {
            type: "object",
            properties: {
              chief_complaint: { type: "string" },
              history_of_present_illness: { type: "string" },
              review_of_systems: { type: "string" },
              patient_statements: { type: "string" }
            }
          },
          objective: {
            type: "object",
            properties: {
              vital_signs: { type: "string" },
              physical_examination: { type: "string" },
              observations: { type: "string" },
              test_results: { type: "string" }
            }
          },
          assessment: {
            type: "object",
            properties: {
              primary_diagnosis: { type: "string" },
              differential_diagnoses: {
                type: "array",
                items: { type: "string" }
              },
              clinical_impression: { type: "string" },
              problem_list: {
                type: "array",
                items: { type: "string" }
              }
            }
          },
          plan: {
            type: "object",
            properties: {
              interventions: {
                type: "array",
                items: { type: "string" }
              },
              medications: { type: "string" },
              follow_up: { type: "string" },
              patient_education: { type: "string" },
              goals: {
                type: "array",
                items: { type: "string" }
              }
            }
          }
        }
      };

    case 'Progress':
      return {
        ...base_schema,
        properties: {
          ...base_schema.properties,
          current_status: { type: "string" },
          changes_since_last_visit: { type: "string" },
          response_to_treatment: { type: "string" },
          vital_signs: { type: "string" },
          current_assessment: { type: "string" },
          progress_toward_goals: { type: "string" },
          interventions_today: {
            type: "array",
            items: { type: "string" }
          },
          updated_plan: { type: "string" },
          next_visit: { type: "string" }
        }
      };

    case 'Admission':
      return {
        ...base_schema,
        properties: {
          ...base_schema.properties,
          reason_for_admission: { type: "string" },
          referral_source: { type: "string" },
          chief_complaint: { type: "string" },
          history_of_present_illness: { type: "string" },
          past_medical_history: { type: "string" },
          medications: { type: "string" },
          allergies: { type: "string" },
          social_history: { type: "string" },
          physical_examination: { type: "string" },
          baseline_vitals: { type: "string" },
          risk_assessments: { type: "string" },
          initial_care_plan: { type: "string" },
          goals_of_care: {
            type: "array",
            items: { type: "string" }
          }
        }
      };

    case 'Discharge':
      return {
        ...base_schema,
        properties: {
          ...base_schema.properties,
          summary_of_care: { type: "string" },
          diagnoses_addressed: {
            type: "array",
            items: { type: "string" }
          },
          treatments_provided: { type: "string" },
          goals_achieved: {
            type: "array",
            items: { type: "string" }
          },
          patient_status_at_discharge: { type: "string" },
          discharge_instructions: { type: "string" },
          medications_at_discharge: { type: "string" },
          follow_up_appointments: { type: "string" },
          education_provided: { type: "string" },
          disposition: { type: "string" }
        }
      };

    default:
      return base_schema;
  }
}

function formatGeneratedNote(data, note_type) {
  const date = new Date().toLocaleDateString();
  const time = new Date().toLocaleTimeString();

  let formatted = `Clinical Note - ${note_type}\nDate: ${date}\nTime: ${time}\n\n`;

  switch (note_type) {
    case 'SOAP':
      formatted += `SUBJECTIVE:\n`;
      if (data.subjective) {
        if (data.subjective.chief_complaint) formatted += `Chief Complaint: ${data.subjective.chief_complaint}\n\n`;
        if (data.subjective.history_of_present_illness) formatted += `History of Present Illness:\n${data.subjective.history_of_present_illness}\n\n`;
        if (data.subjective.review_of_systems) formatted += `Review of Systems:\n${data.subjective.review_of_systems}\n\n`;
        if (data.subjective.patient_statements) formatted += `Patient Statements:\n${data.subjective.patient_statements}\n\n`;
      }

      formatted += `OBJECTIVE:\n`;
      if (data.objective) {
        if (data.objective.vital_signs) formatted += `Vital Signs:\n${data.objective.vital_signs}\n\n`;
        if (data.objective.physical_examination) formatted += `Physical Examination:\n${data.objective.physical_examination}\n\n`;
        if (data.objective.observations) formatted += `Observations:\n${data.objective.observations}\n\n`;
        if (data.objective.test_results) formatted += `Test Results:\n${data.objective.test_results}\n\n`;
      }

      formatted += `ASSESSMENT:\n`;
      if (data.assessment) {
        if (data.assessment.primary_diagnosis) formatted += `Primary Diagnosis: ${data.assessment.primary_diagnosis}\n\n`;
        if (data.assessment.clinical_impression) formatted += `Clinical Impression:\n${data.assessment.clinical_impression}\n\n`;
        if (data.assessment.problem_list?.length) {
          formatted += `Problem List:\n${data.assessment.problem_list.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n\n`;
        }
      }

      formatted += `PLAN:\n`;
      if (data.plan) {
        if (data.plan.interventions?.length) {
          formatted += `Interventions:\n${data.plan.interventions.map((i, idx) => `${idx + 1}. ${i}`).join('\n')}\n\n`;
        }
        if (data.plan.medications) formatted += `Medications:\n${data.plan.medications}\n\n`;
        if (data.plan.patient_education) formatted += `Patient Education:\n${data.plan.patient_education}\n\n`;
        if (data.plan.follow_up) formatted += `Follow-up:\n${data.plan.follow_up}\n\n`;
      }
      break;

    case 'Progress':
      if (data.current_status) formatted += `Current Status:\n${data.current_status}\n\n`;
      if (data.vital_signs) formatted += `Vital Signs:\n${data.vital_signs}\n\n`;
      if (data.changes_since_last_visit) formatted += `Changes Since Last Visit:\n${data.changes_since_last_visit}\n\n`;
      if (data.response_to_treatment) formatted += `Response to Treatment:\n${data.response_to_treatment}\n\n`;
      if (data.progress_toward_goals) formatted += `Progress Toward Goals:\n${data.progress_toward_goals}\n\n`;
      if (data.current_assessment) formatted += `Current Assessment:\n${data.current_assessment}\n\n`;
      if (data.interventions_today?.length) {
        formatted += `Interventions Today:\n${data.interventions_today.map((i, idx) => `${idx + 1}. ${i}`).join('\n')}\n\n`;
      }
      if (data.updated_plan) formatted += `Updated Plan:\n${data.updated_plan}\n\n`;
      if (data.next_visit) formatted += `Next Visit:\n${data.next_visit}\n`;
      break;

    case 'Admission':
      if (data.reason_for_admission) formatted += `Reason for Admission:\n${data.reason_for_admission}\n\n`;
      if (data.referral_source) formatted += `Referral Source: ${data.referral_source}\n\n`;
      if (data.chief_complaint) formatted += `Chief Complaint: ${data.chief_complaint}\n\n`;
      if (data.history_of_present_illness) formatted += `History of Present Illness:\n${data.history_of_present_illness}\n\n`;
      if (data.past_medical_history) formatted += `Past Medical History:\n${data.past_medical_history}\n\n`;
      if (data.medications) formatted += `Current Medications:\n${data.medications}\n\n`;
      if (data.allergies) formatted += `Allergies: ${data.allergies}\n\n`;
      if (data.physical_examination) formatted += `Physical Examination:\n${data.physical_examination}\n\n`;
      if (data.baseline_vitals) formatted += `Baseline Vital Signs:\n${data.baseline_vitals}\n\n`;
      if (data.risk_assessments) formatted += `Risk Assessments:\n${data.risk_assessments}\n\n`;
      if (data.initial_care_plan) formatted += `Initial Care Plan:\n${data.initial_care_plan}\n\n`;
      if (data.goals_of_care?.length) {
        formatted += `Goals of Care:\n${data.goals_of_care.map((g, i) => `${i + 1}. ${g}`).join('\n')}\n`;
      }
      break;

    case 'Discharge':
      if (data.summary_of_care) formatted += `Summary of Care:\n${data.summary_of_care}\n\n`;
      if (data.diagnoses_addressed?.length) {
        formatted += `Diagnoses Addressed:\n${data.diagnoses_addressed.map((d, i) => `${i + 1}. ${d}`).join('\n')}\n\n`;
      }
      if (data.treatments_provided) formatted += `Treatments Provided:\n${data.treatments_provided}\n\n`;
      if (data.goals_achieved?.length) {
        formatted += `Goals Achieved:\n${data.goals_achieved.map((g, i) => `${i + 1}. ${g}`).join('\n')}\n\n`;
      }
      if (data.patient_status_at_discharge) formatted += `Patient Status at Discharge:\n${data.patient_status_at_discharge}\n\n`;
      if (data.discharge_instructions) formatted += `Discharge Instructions:\n${data.discharge_instructions}\n\n`;
      if (data.medications_at_discharge) formatted += `Medications at Discharge:\n${data.medications_at_discharge}\n\n`;
      if (data.follow_up_appointments) formatted += `Follow-up Appointments:\n${data.follow_up_appointments}\n\n`;
      if (data.education_provided) formatted += `Education Provided:\n${data.education_provided}\n\n`;
      if (data.disposition) formatted += `Disposition: ${data.disposition}\n`;
      break;
  }

  return formatted;
}