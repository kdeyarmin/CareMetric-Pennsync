// Provider-specific note types and documentation requirements
// Based on Medicare/Medicaid home health documentation standards

export const providerNoteTypes = {
  RN: {
    label: "Registered Nurse (RN)",
    noteTypes: [
      {
        type: "skilled_nursing_visit",
        label: "Skilled Nursing Visit Note",
        required_elements: [
          "Vital signs",
          "Assessment findings",
          "Skilled interventions performed",
          "Patient/caregiver education provided",
          "Patient response to treatment",
          "Progress toward goals",
          "Clinical judgment and skilled observation",
          "Homebound status verification"
        ],
        description: "Routine skilled nursing visit documentation"
      },
      {
        type: "admission_evaluation",
        label: "Admission/Start of Care Evaluation",
        required_elements: [
          "Comprehensive assessment",
          "Medical history review",
          "Medication reconciliation",
          "Safety assessment",
          "Care plan development",
          "Patient/family education",
          "Physician orders verification",
          "OASIS completion"
        ],
        description: "Initial comprehensive assessment for new patients"
      },
      {
        type: "recertification",
        label: "Recertification Assessment",
        required_elements: [
          "Progress summary",
          "Current status assessment",
          "Goals review and revision",
          "Continued need for skilled care",
          "Homebound status verification",
          "Updated plan of care",
          "OASIS recertification"
        ],
        description: "Assessment for continuing care authorization"
      },
      {
        type: "discharge_summary",
        label: "Discharge Summary",
        required_elements: [
          "Final assessment",
          "Goals achievement status",
          "Discharge instructions",
          "Medication list",
          "Follow-up care plan",
          "Patient/caregiver education completed",
          "Discharge disposition",
          "OASIS discharge"
        ],
        description: "Final visit and discharge documentation"
      },
      {
        type: "supervisory_visit",
        label: "Supervisory Visit",
        required_elements: [
          "Aide performance evaluation",
          "Task completion verification",
          "Patient condition assessment",
          "Care plan adherence",
          "Patient/family satisfaction",
          "Recommendations for aide"
        ],
        description: "Supervision of home health aides (every 14 days)"
      }
    ]
  },
  
  LPN: {
    label: "Licensed Practical Nurse (LPN)",
    noteTypes: [
      {
        type: "skilled_nursing_visit",
        label: "Skilled Nursing Visit Note",
        required_elements: [
          "Vital signs",
          "Wound care/dressing changes",
          "Medication administration",
          "Catheter care",
          "Patient response",
          "Observations reported to RN",
          "Patient education reinforcement"
        ],
        description: "LPN visit under RN supervision"
      }
    ]
  },

  NP: {
    label: "Nurse Practitioner (NP)",
    noteTypes: [
      {
        type: "comprehensive_assessment",
        label: "Comprehensive Assessment",
        required_elements: [
          "Chief complaint",
          "History of present illness",
          "Review of systems",
          "Physical examination",
          "Assessment and diagnosis",
          "Treatment plan",
          "Medications prescribed/adjusted",
          "Patient education"
        ],
        description: "Full patient evaluation by NP"
      },
      {
        type: "follow_up_visit",
        label: "Follow-up Visit",
        required_elements: [
          "Interval history",
          "Symptom review",
          "Focused exam",
          "Medication review",
          "Plan adjustments",
          "Patient response to treatment"
        ],
        description: "Follow-up care visit"
      }
    ]
  },

  PT: {
    label: "Physical Therapist (PT)",
    noteTypes: [
      {
        type: "initial_evaluation",
        label: "PT Initial Evaluation",
        required_elements: [
          "Referral diagnosis",
          "History of present condition",
          "Prior functional status",
          "Objective measurements (ROM, strength, gait)",
          "Standardized tests and measures",
          "Functional limitations",
          "Rehab potential",
          "Treatment goals (short and long term)",
          "Treatment plan and frequency",
          "Projected duration"
        ],
        description: "Comprehensive PT evaluation"
      },
      {
        type: "progress_note",
        label: "PT Progress Note (SOAP)",
        required_elements: [
          "Subjective: Patient reported symptoms/progress",
          "Objective: Measurable findings (ROM, strength, distance)",
          "Assessment: Clinical interpretation and progress",
          "Plan: Modifications and next steps",
          "Skilled interventions performed",
          "Response to treatment"
        ],
        description: "Treatment session documentation (minimum every 10 visits)"
      },
      {
        type: "daily_treatment",
        label: "PT Daily Treatment Note",
        required_elements: [
          "Interventions provided",
          "Duration of treatment",
          "Patient response",
          "Progress toward goals",
          "Safety concerns"
        ],
        description: "Brief daily treatment record"
      },
      {
        type: "discharge_summary",
        label: "PT Discharge Summary",
        required_elements: [
          "Initial vs final measurements",
          "Goals achievement status",
          "Functional outcomes",
          "Home exercise program",
          "Discharge recommendations",
          "Follow-up care needed"
        ],
        description: "Final PT documentation"
      }
    ]
  },

  OT: {
    label: "Occupational Therapist (OT)",
    noteTypes: [
      {
        type: "initial_evaluation",
        label: "OT Initial Evaluation",
        required_elements: [
          "Occupational profile",
          "ADL/IADL assessment",
          "Cognitive assessment",
          "Upper extremity function",
          "Safety and home assessment",
          "Performance skills analysis",
          "Goals (functional, measurable)",
          "Treatment plan",
          "Frequency and duration"
        ],
        description: "Comprehensive OT evaluation"
      },
      {
        type: "progress_note",
        label: "OT Progress Note (SOAP)",
        required_elements: [
          "Subjective: Patient's perspective on function",
          "Objective: ADL performance, measurements",
          "Assessment: Functional progress analysis",
          "Plan: Treatment modifications",
          "Adaptive equipment recommendations",
          "Caregiver training"
        ],
        description: "Progress documentation (minimum every 10 visits)"
      },
      {
        type: "daily_treatment",
        label: "OT Daily Treatment Note",
        required_elements: [
          "Therapeutic activities performed",
          "ADL training provided",
          "Adaptive equipment used",
          "Patient performance level",
          "Assistance level required"
        ],
        description: "Daily treatment record"
      },
      {
        type: "home_assessment",
        label: "Home Safety Assessment",
        required_elements: [
          "Environmental hazards identified",
          "Accessibility evaluation",
          "DME recommendations",
          "Home modifications suggested",
          "Safety education provided"
        ],
        description: "Environmental assessment and recommendations"
      }
    ]
  },

  ST: {
    label: "Speech-Language Pathologist (SLP)",
    noteTypes: [
      {
        type: "initial_evaluation",
        label: "SLP Initial Evaluation",
        required_elements: [
          "Communication assessment",
          "Swallowing evaluation",
          "Cognitive-linguistic status",
          "Standardized test results",
          "Baseline measurements",
          "Functional communication goals",
          "Treatment plan",
          "Compensatory strategies"
        ],
        description: "Comprehensive speech-language evaluation"
      },
      {
        type: "progress_note",
        label: "SLP Progress Note (SOAP)",
        required_elements: [
          "Subjective: Patient/family report",
          "Objective: Quantifiable data (accuracy %, trials)",
          "Assessment: Progress analysis",
          "Plan: Treatment adjustments",
          "Cueing levels required",
          "Functional communication status"
        ],
        description: "Progress documentation (minimum every 10 visits)"
      },
      {
        type: "dysphagia_assessment",
        label: "Dysphagia Assessment",
        required_elements: [
          "Swallow function status",
          "Diet texture level",
          "Liquid consistency",
          "Aspiration risk",
          "Compensatory strategies",
          "Patient/caregiver education",
          "Physician notification if needed"
        ],
        description: "Swallowing disorder documentation"
      },
      {
        type: "daily_treatment",
        label: "SLP Daily Treatment Note",
        required_elements: [
          "Therapeutic tasks performed",
          "Cueing provided",
          "Accuracy/success rate",
          "Patient response",
          "Carryover to functional communication"
        ],
        description: "Daily treatment record"
      }
    ]
  },

  MSW: {
    label: "Medical Social Worker (MSW)",
    noteTypes: [
      {
        type: "psychosocial_assessment",
        label: "Psychosocial Assessment",
        required_elements: [
          "Emotional/psychological status",
          "Social support system",
          "Financial concerns",
          "Environmental factors",
          "Coping mechanisms",
          "Community resource needs",
          "Barriers to care",
          "Intervention plan"
        ],
        description: "Comprehensive psychosocial evaluation"
      },
      {
        type: "counseling_session",
        label: "Counseling Session Note",
        required_elements: [
          "Presenting issues",
          "Interventions provided",
          "Patient response",
          "Progress toward psychosocial goals",
          "Coping strategies taught",
          "Referrals made"
        ],
        description: "Individual or family counseling documentation"
      },
      {
        type: "resource_coordination",
        label: "Community Resource Coordination",
        required_elements: [
          "Resources identified",
          "Referrals made",
          "Applications completed",
          "Follow-up status",
          "Barriers addressed",
          "Patient/family response"
        ],
        description: "Documentation of resource linkage activities"
      }
    ]
  },

  MD: {
    label: "Physician (MD)",
    noteTypes: [
      {
        type: "face_to_face",
        label: "Face-to-Face Encounter",
        required_elements: [
          "Date of encounter",
          "Clinical findings",
          "Homebound status documentation",
          "Skilled care need justification",
          "Diagnosis related to home health need",
          "Physician signature and date"
        ],
        description: "Required encounter for home health certification"
      },
      {
        type: "plan_of_care",
        label: "Plan of Care (485)",
        required_elements: [
          "All diagnoses",
          "Medications",
          "Orders for each discipline",
          "Frequency and duration",
          "DME orders",
          "Functional limitations",
          "Goals",
          "Physician signature"
        ],
        description: "Home health plan of care certification"
      },
      {
        type: "telephone_consult",
        label: "Telephone Consultation",
        required_elements: [
          "Reason for call",
          "Clinical information discussed",
          "Physician recommendations",
          "Orders given",
          "Follow-up plan"
        ],
        description: "Physician phone consultation documentation"
      }
    ]
  },

  DO: {
    label: "Doctor of Osteopathic Medicine (DO)",
    noteTypes: [
      {
        type: "face_to_face",
        label: "Face-to-Face Encounter",
        required_elements: [
          "Date of encounter",
          "Clinical findings",
          "Homebound status documentation",
          "Skilled care need justification",
          "Diagnosis related to home health need",
          "Physician signature and date"
        ],
        description: "Required encounter for home health certification"
      },
      {
        type: "plan_of_care",
        label: "Plan of Care (485)",
        required_elements: [
          "All diagnoses",
          "Medications",
          "Orders for each discipline",
          "Frequency and duration",
          "DME orders",
          "Functional limitations",
          "Goals",
          "Physician signature"
        ],
        description: "Home health plan of care certification"
      }
    ]
  },

  PA: {
    label: "Physician Assistant (PA)",
    noteTypes: [
      {
        type: "assessment_visit",
        label: "PA Assessment Visit",
        required_elements: [
          "Chief complaint",
          "History of present illness",
          "Physical examination",
          "Assessment and diagnosis",
          "Treatment plan",
          "Medications",
          "Patient education",
          "Supervising physician communication"
        ],
        description: "PA patient assessment"
      }
    ]
  },

  Chiropractor: {
    label: "Chiropractor",
    noteTypes: [
      {
        type: "chiropractic_visit",
        label: "Chiropractic Treatment Note",
        required_elements: [
          "Subjective complaints",
          "Objective findings (palpation, ROM)",
          "Adjustment/manipulation performed",
          "Therapeutic modalities",
          "Patient response",
          "Progress toward functional goals",
          "Home exercise instructions"
        ],
        description: "Chiropractic manipulation visit"
      },
      {
        type: "initial_evaluation",
        label: "Chiropractic Initial Evaluation",
        required_elements: [
          "History of condition",
          "Previous treatments",
          "Physical examination",
          "Postural analysis",
          "Neurological screening",
          "Treatment plan",
          "Frequency and duration"
        ],
        description: "Initial chiropractic assessment"
      }
    ]
  }
};

// Get note types for specific provider
export const getNoteTypesForProvider = (providerType) => {
  return providerNoteTypes[providerType] || null;
};

// Get all provider types that have specific note requirements
export const getAllProviderTypes = () => {
  return Object.keys(providerNoteTypes).map(key => ({
    value: key,
    label: providerNoteTypes[key].label
  }));
};

// Get required elements for a specific note type
export const getRequiredElements = (providerType, noteType) => {
  const provider = providerNoteTypes[providerType];
  if (!provider) return [];
  
  const note = provider.noteTypes.find(n => n.type === noteType);
  return note?.required_elements || [];
};

// Generate documentation checklist
export const generateDocumentationChecklist = (providerType, noteType) => {
  const elements = getRequiredElements(providerType, noteType);
  return elements.map(element => ({
    element,
    completed: false
  }));
};