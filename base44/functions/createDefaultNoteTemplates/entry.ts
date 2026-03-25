import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Check if templates already exist
    const existing = await base44.asServiceRole.entities.NoteTemplate.filter({ is_system_template: true });
    if (existing.length > 0) {
      return Response.json({ 
        message: 'System templates already exist', 
        count: existing.length 
      });
    }

    const templates = [
      // RN Follow-up Visit Template
      {
        name: "RN Routine Follow-up",
        visit_type: "routine",
        provider_type: "RN",
        description: "Standard follow-up visit for routine care",
        is_system_template: true,
        diagnosis_tags: ["CHF", "COPD", "Diabetes", "Hypertension"],
        sections: [
          {
            section_name: "Vital Signs",
            template_text: "Temperature: ___°F\nBlood Pressure: ___/___\nHeart Rate: ___ bpm\nRespiratory Rate: ___ breaths/min\nO2 Saturation: ___% on room air/supplemental O2\nPain Level: ___/10",
            order: 1
          },
          {
            section_name: "Chief Complaint",
            template_text: "Patient reports [describe primary concern or reason for visit]",
            order: 2
          },
          {
            section_name: "Assessment",
            template_text: "General Appearance: Alert and oriented x3, appears [comfortable/distressed]\nCardiovascular: Heart rate regular/irregular, no edema/trace edema noted\nRespiratory: Breath sounds clear bilaterally, no respiratory distress\nNeurological: Moves all extremities, follows commands\nSkin Integrity: Intact without breakdown\nNutritional Status: [describe appetite and intake]\nMedication Compliance: [compliant/partial compliance/non-compliant]",
            order: 3
          },
          {
            section_name: "Interventions",
            template_text: "- Vital signs obtained and documented\n- Medication review completed\n- Patient/caregiver education provided on [topic]\n- [Additional interventions as needed]",
            order: 4
          },
          {
            section_name: "Plan",
            template_text: "- Continue current plan of care\n- Monitor [specific symptoms or conditions]\n- Next scheduled visit: [date]\n- Physician notification: [if applicable]\n- Patient/caregiver verbalized understanding of plan",
            order: 5
          }
        ]
      },

      // NP Initial Evaluation Template
      {
        name: "NP Initial Evaluation",
        visit_type: "initial_evaluation",
        provider_type: "NP",
        description: "Comprehensive initial assessment for new patient",
        is_system_template: true,
        diagnosis_tags: [],
        sections: [
          {
            section_name: "Chief Complaint",
            template_text: "[Primary reason for visit]",
            order: 1
          },
          {
            section_name: "History of Present Illness",
            template_text: "[Detailed description of current illness/condition including onset, duration, severity, aggravating/alleviating factors]",
            order: 2
          },
          {
            section_name: "Past Medical History",
            template_text: "Previous diagnoses:\nPrevious surgeries:\nHospitalizations:\nAllergies:",
            order: 3
          },
          {
            section_name: "Current Medications",
            template_text: "[List all current medications with dosages and frequencies]",
            order: 4
          },
          {
            section_name: "Review of Systems",
            template_text: "Constitutional: No fever, weight loss, or fatigue\nCardiovascular: No chest pain, palpitations, or edema\nRespiratory: No shortness of breath or cough\nGastrointestinal: No nausea, vomiting, or diarrhea\nGenitourinary: No dysuria or frequency\nMusculoskeletal: No joint pain or swelling\nNeurological: No headache, dizziness, or weakness",
            order: 5
          },
          {
            section_name: "Physical Examination",
            template_text: "Vital Signs: [documented above]\nGeneral: Alert, oriented x3, well-nourished\nHEENT: Normocephalic, PERRLA\nCardiovascular: RRR, no murmurs\nRespiratory: Clear to auscultation bilaterally\nAbdomen: Soft, non-tender, non-distended\nExtremities: No edema, full ROM\nSkin: Warm, dry, intact",
            order: 6
          },
          {
            section_name: "Assessment & Diagnosis",
            template_text: "[Primary and secondary diagnoses with ICD-10 codes]",
            order: 7
          },
          {
            section_name: "Plan",
            template_text: "Diagnostic: [labs, imaging, tests ordered]\nTherapeutic: [medications prescribed, treatments initiated]\nEducation: [patient education provided]\nFollow-up: [when and why]\nReferrals: [if applicable]",
            order: 8
          }
        ]
      },

      // Physician Annual Physical Template
      {
        name: "Annual Physical Examination",
        visit_type: "preventive",
        provider_type: "PHYSICIAN",
        description: "Comprehensive annual wellness exam",
        is_system_template: true,
        diagnosis_tags: [],
        sections: [
          {
            section_name: "Vital Signs",
            template_text: "Height: ___ Weight: ___ BMI: ___\nBlood Pressure: ___/___\nHeart Rate: ___ bpm\nTemperature: ___°F\nRespiratory Rate: ___",
            order: 1
          },
          {
            section_name: "Chief Complaint",
            template_text: "Annual physical examination / wellness visit",
            order: 2
          },
          {
            section_name: "Review of Systems",
            template_text: "Constitutional: [positive/negative findings]\nCardiovascular: [positive/negative findings]\nRespiratory: [positive/negative findings]\nGastrointestinal: [positive/negative findings]\nGenitourinary: [positive/negative findings]\nMusculoskeletal: [positive/negative findings]\nNeurological: [positive/negative findings]\nPsychiatric: [positive/negative findings]\nEndocrine: [positive/negative findings]",
            order: 3
          },
          {
            section_name: "Physical Exam",
            template_text: "General: Well-appearing, no acute distress\nHEENT: Normocephalic, atraumatic, PERRLA, EOMI\nNeck: Supple, no thyromegaly or lymphadenopathy\nCardiovascular: Regular rate and rhythm, no murmurs/rubs/gallops\nRespiratory: Clear to auscultation bilaterally, no wheezes/rales/rhonchi\nAbdomen: Soft, non-tender, non-distended, normal bowel sounds\nMusculoskeletal: Normal strength and ROM in all extremities\nNeurological: Cranial nerves II-XII intact, normal gait\nSkin: No suspicious lesions noted",
            order: 4
          },
          {
            section_name: "Health Maintenance",
            template_text: "Immunizations: Up to date/Due for [specify]\nScreenings: [mammogram, colonoscopy, etc. - status]\nPreventive counseling: [diet, exercise, smoking cessation, etc.]",
            order: 5
          },
          {
            section_name: "Assessment",
            template_text: "[List active problems and diagnoses]",
            order: 6
          },
          {
            section_name: "Plan",
            template_text: "- Continue current medications\n- Order screening labs: [CBC, CMP, lipid panel, etc.]\n- Referrals: [if needed]\n- Follow-up: In 12 months or sooner if concerns arise\n- Patient counseled on [specific topics]",
            order: 7
          }
        ]
      },

      // Therapist Admission Template
      {
        name: "Therapy Admission Evaluation",
        visit_type: "admission",
        provider_type: "THERAPIST",
        description: "Initial therapy evaluation and assessment",
        is_system_template: true,
        diagnosis_tags: ["Stroke", "Joint Replacement", "Fall", "Weakness"],
        sections: [
          {
            section_name: "Chief Complaint / Reason for Referral",
            template_text: "[Reason for therapy services]",
            order: 1
          },
          {
            section_name: "Functional Status Assessment",
            template_text: "Prior Level of Function: [describe baseline]\nCurrent Functional Status:\n- Mobility: [ambulatory with/without device, wheelchair dependent]\n- Transfers: [independent/requires assistance]\n- ADLs: [independent/requires assistance with bathing, dressing, toileting]\n- Balance: [stable/unstable, fall risk assessment]",
            order: 2
          },
          {
            section_name: "Physical Assessment",
            template_text: "Range of Motion: [affected areas]\nMuscle Strength: [affected areas, graded 0-5]\nCoordination: [assessment]\nEndurance: [assessment]\nPain: [location, intensity, character]",
            order: 3
          },
          {
            section_name: "Goals",
            template_text: "Short-term goals (2-4 weeks):\n1. [Specific, measurable goal]\n2. [Specific, measurable goal]\n\nLong-term goals (8-12 weeks):\n1. [Specific, measurable goal]\n2. [Specific, measurable goal]",
            order: 4
          },
          {
            section_name: "Treatment Plan",
            template_text: "Frequency: ___ times per week for ___ weeks\nDuration: ___ minutes per session\nModalities: [therapeutic exercises, manual therapy, functional training, etc.]\nHome Exercise Program: [to be provided]",
            order: 5
          },
          {
            section_name: "Patient Response",
            template_text: "Patient tolerated evaluation well. Patient/caregiver verbalized understanding of goals and treatment plan.",
            order: 6
          }
        ]
      },

      // MSW Psychosocial Assessment Template
      {
        name: "MSW Psychosocial Assessment",
        visit_type: "admission",
        provider_type: "MSW",
        description: "Comprehensive psychosocial evaluation",
        is_system_template: true,
        diagnosis_tags: ["Depression", "Anxiety", "Palliative Care", "Family Support"],
        sections: [
          {
            section_name: "Presenting Issue",
            template_text: "[Reason for social work referral]",
            order: 1
          },
          {
            section_name: "Mental Health Status",
            template_text: "Mood: [describe current mood]\nAffect: [appropriate/flat/anxious]\nCognitive Status: [alert, oriented x3, memory intact]\nSafety: [no SI/HI, denies abuse/neglect]",
            order: 2
          },
          {
            section_name: "Psychosocial Factors",
            template_text: "Living Situation: [alone, with family, assisted living]\nSupport System: [describe family/friend support]\nFinancial: [adequate resources/financial concerns]\nCoping Mechanisms: [describe how patient manages stress]\nCultural/Spiritual Considerations: [relevant factors]",
            order: 3
          },
          {
            section_name: "Interventions",
            template_text: "- Psychosocial assessment completed\n- Therapeutic support provided\n- Community resources discussed: [list resources]\n- Care coordination with: [team members/agencies]\n- Patient/family education on: [topics]",
            order: 4
          },
          {
            section_name: "Plan",
            template_text: "- Continue supportive counseling\n- Connect with [specific resources/services]\n- Monitor for changes in mental health status\n- Next visit scheduled: [date]\n- Patient/family verbalized understanding",
            order: 5
          }
        ]
      },

      // LPN Routine Visit Template
      {
        name: "LPN Routine Visit",
        visit_type: "routine",
        provider_type: "LPN",
        description: "Standard LPN routine skilled visit",
        is_system_template: true,
        diagnosis_tags: ["Wound Care", "Medication Management", "Diabetic Care"],
        sections: [
          {
            section_name: "Vital Signs",
            template_text: "Temperature: ___°F\nBlood Pressure: ___/___\nHeart Rate: ___ bpm\nRespiratory Rate: ___\nO2 Saturation: ___%\nPain: ___/10",
            order: 1
          },
          {
            section_name: "Skilled Observation",
            template_text: "Patient observed for changes in condition. General appearance: [alert, oriented]\nCardiovascular: [observations]\nRespiratory: [observations]\nSkin: [observations]\nNeurological: [observations]",
            order: 2
          },
          {
            section_name: "Skilled Interventions",
            template_text: "- Vital signs obtained and documented\n- Medication review completed, compliance assessed\n- [Specific skilled task: wound care, injection, etc.]\n- Patient/caregiver education reinforced on [topic]\n- RN supervisor notified of: [any significant findings]",
            order: 3
          },
          {
            section_name: "Plan",
            template_text: "- Continue current care plan as ordered by RN\n- Next visit: [date]\n- No significant changes to report / RN notified of: [changes]",
            order: 4
          }
        ]
      }
    ];

    // Create all templates
    const created = await Promise.all(
      templates.map(template => 
        base44.asServiceRole.entities.NoteTemplate.create(template)
      )
    );

    return Response.json({ 
      success: true,
      message: `Created ${created.length} system templates`,
      templates: created.map(t => ({ id: t.id, name: t.name }))
    });

  } catch (error) {
    console.error('Error creating templates:', error);
    return Response.json({ 
      error: error.message,
      details: error.toString()
    }, { status: 500 });
  }
});