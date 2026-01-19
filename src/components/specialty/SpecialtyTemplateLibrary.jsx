// Predefined specialty-specific templates with AI prompts and clinical guidance

export const SPECIALTY_TEMPLATES = {
  "Psychiatry": {
    name: "Psychiatry / Mental Health",
    formats: ["dap", "soap"],
    defaultFormat: "dap",
    templates: {
      "Initial Psychiatric Evaluation": {
        sections: [
          "Chief Complaint",
          "History of Present Illness",
          "Psychiatric History",
          "Medical History",
          "Substance Use History",
          "Family History",
          "Social History",
          "Mental Status Exam",
          "Assessment & Diagnosis",
          "Treatment Plan"
        ],
        aiPrompt: `Focus on mental health assessment including mood, affect, thought process, thought content, suicidal/homicidal ideation, insight, and judgment. Include relevant DSM-5 diagnoses.`,
        commonCodes: {
          icd10: ["F32.9", "F41.1", "F43.10", "F31.81", "F90.2"],
          cpt: ["90791", "90834", "90837", "90853"]
        }
      },
      "Therapy Progress Note": {
        sections: [
          "Presenting Problem",
          "Interventions Used",
          "Patient Response",
          "Progress Toward Goals",
          "Plan for Next Session"
        ],
        aiPrompt: `Document therapeutic interventions (CBT, DBT, MI, etc.), patient engagement, progress on treatment goals, and homework assignments.`,
        commonCodes: {
          icd10: ["F32.9", "F41.1", "F43.10"],
          cpt: ["90834", "90837", "90846"]
        }
      }
    }
  },
  
  "Cardiology": {
    name: "Cardiology",
    formats: ["soap"],
    defaultFormat: "soap",
    templates: {
      "Cardiac Consultation": {
        sections: [
          "Chief Complaint",
          "Cardiac History",
          "Risk Factors",
          "Cardiac Exam",
          "EKG Findings",
          "Diagnostic Studies",
          "Assessment",
          "Treatment Plan"
        ],
        aiPrompt: `Focus on cardiovascular symptoms, chest pain characteristics, dyspnea, palpitations, syncope. Include cardiac risk factors, functional class, and echocardiogram/stress test findings.`,
        commonCodes: {
          icd10: ["I25.10", "I50.9", "I48.91", "I10", "I25.5"],
          cpt: ["93000", "93306", "93015", "99244"]
        }
      },
      "Heart Failure Follow-up": {
        sections: [
          "Current Symptoms",
          "NYHA Functional Class",
          "Volume Status",
          "Medication Compliance",
          "Vitals & Physical Exam",
          "Labs & BNP",
          "Assessment",
          "Medication Adjustments"
        ],
        aiPrompt: `Document volume status, dyspnea, edema, functional capacity, medication adherence, and guideline-directed medical therapy optimization.`,
        commonCodes: {
          icd10: ["I50.9", "I50.23", "I50.33"],
          cpt: ["99213", "99214"]
        }
      }
    }
  },
  
  "Home Health": {
    name: "Home Health / Hospice",
    formats: ["home_health", "soap"],
    defaultFormat: "home_health",
    templates: {
      "Skilled Nursing Visit": {
        sections: [
          "Homebound Status",
          "Patient Status & Changes",
          "Vital Signs",
          "Systems Assessment",
          "Skilled Interventions",
          "Patient/Caregiver Education",
          "Response to Care",
          "Physician Communication",
          "Plan of Care Updates"
        ],
        aiPrompt: `Emphasize skilled nursing need, homebound justification, Medicare compliance, patient safety, caregiver competency, and progress toward goals. Document medical necessity.`,
        commonCodes: {
          icd10: ["I50.9", "E11.9", "I10", "J44.9", "M79.3"],
          cpt: ["99509", "99504", "99505"]
        }
      },
      "OASIS Recertification Visit": {
        sections: [
          "Homebound Status Verification",
          "Functional Status Assessment",
          "ADL Performance",
          "IADL Performance",
          "Medication Management",
          "Clinical Status",
          "Progress Toward Goals",
          "Recertification Justification"
        ],
        aiPrompt: `Document all OASIS items, functional improvements/decline, ongoing skilled need, and justification for continued home health services per Medicare guidelines.`,
        commonCodes: {
          icd10: ["I50.9", "E11.65", "I10"],
          cpt: ["99509"]
        }
      }
    }
  },
  
  "Primary Care": {
    name: "Primary Care / Family Medicine",
    formats: ["soap"],
    defaultFormat: "soap",
    templates: {
      "Annual Wellness Visit": {
        sections: [
          "Review of Systems",
          "Preventive Screening Review",
          "Chronic Disease Management",
          "Vital Signs & Physical Exam",
          "Health Maintenance",
          "Immunizations",
          "Counseling Provided",
          "Plan & Follow-up"
        ],
        aiPrompt: `Focus on preventive care, health maintenance, chronic disease management, and age-appropriate screening. Include counseling on diet, exercise, and lifestyle.`,
        commonCodes: {
          icd10: ["Z00.00", "E11.9", "I10", "E78.5"],
          cpt: ["G0438", "G0439", "99213", "99214"]
        }
      },
      "Chronic Disease Management": {
        sections: [
          "Chief Complaint",
          "Chronic Conditions Review",
          "Medication Review",
          "Labs & Vitals",
          "Physical Exam",
          "Assessment & Control",
          "Medication Adjustments",
          "Follow-up Plan"
        ],
        aiPrompt: `Document disease control, medication adherence, A1C/BP goals, lifestyle modifications, and guideline-based therapy adjustments.`,
        commonCodes: {
          icd10: ["E11.9", "I10", "E78.5", "J44.9"],
          cpt: ["99213", "99214", "99215"]
        }
      }
    }
  },
  
  "Emergency Medicine": {
    name: "Emergency Medicine",
    formats: ["narrative", "soap"],
    defaultFormat: "narrative",
    templates: {
      "ED Evaluation": {
        sections: [
          "Chief Complaint",
          "HPI with Timeline",
          "Triage Vitals",
          "Physical Examination",
          "Diagnostic Studies",
          "ED Course & Treatment",
          "Medical Decision Making",
          "Disposition"
        ],
        aiPrompt: `Chronological narrative format. Document time-sensitive findings, critical interventions, emergency procedures, risk stratification, and disposition reasoning.`,
        commonCodes: {
          icd10: ["R07.9", "R10.9", "R51", "I63.9", "I21.9"],
          cpt: ["99284", "99285", "99291"]
        }
      }
    }
  },
  
  "Pediatrics": {
    name: "Pediatrics",
    formats: ["soap"],
    defaultFormat: "soap",
    templates: {
      "Well Child Visit": {
        sections: [
          "Interval History",
          "Developmental Milestones",
          "Growth Parameters",
          "Physical Exam",
          "Immunizations",
          "Anticipatory Guidance",
          "Assessment",
          "Plan"
        ],
        aiPrompt: `Focus on age-appropriate developmental milestones, growth charts, immunization schedule, nutrition, safety counseling, and parent education.`,
        commonCodes: {
          icd10: ["Z00.129", "Z00.121", "Z23"],
          cpt: ["99391", "99392", "99393", "90460"]
        }
      }
    }
  }
};

export const getSpecialtyTemplate = (specialty, templateName) => {
  return SPECIALTY_TEMPLATES[specialty]?.templates[templateName];
};

export const getSpecialtyTemplates = (specialty) => {
  return SPECIALTY_TEMPLATES[specialty]?.templates || {};
};

export const getAllSpecialties = () => {
  return Object.keys(SPECIALTY_TEMPLATES);
};