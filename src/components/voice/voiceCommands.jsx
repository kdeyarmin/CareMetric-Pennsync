/**
 * Voice Command Registry
 * Defines all available voice commands for different contexts
 */

export const dashboardCommands = [
  {
    name: "Navigate to Patients",
    category: "Navigation",
    triggers: ["go to patients", "show patients", "open patients", "patients page"],
    action: "navigate_patients",
    description: "Navigate to the patients list page",
    example: "Say 'go to patients' to view all patients"
  },
  {
    name: "Navigate to Dashboard",
    category: "Navigation",
    triggers: ["go to dashboard", "show dashboard", "home page", "go home"],
    action: "navigate_dashboard",
    description: "Return to the main dashboard",
    example: "Say 'go to dashboard' to return to today's visits"
  },
  {
    name: "Refresh Data",
    category: "Actions",
    triggers: ["refresh", "reload", "update data", "get latest"],
    action: "refresh_data",
    description: "Refresh the current page data",
    example: "Say 'refresh' to reload the current data"
  },
  {
    name: "Search",
    category: "Actions",
    triggers: ["search for", "find patient", "look for"],
    action: "search",
    description: "Activate search functionality",
    example: "Say 'search for John Smith' to find a patient"
  }
];

export const smartNoteCommands = [
  // Vital Signs - Direct Data Entry
  {
    name: "Blood Pressure",
    category: "Vital Signs",
    triggers: ["blood pressure", "bp is", "bp"],
    action: "vital_bp",
    description: "Enter blood pressure reading",
    example: "Say 'blood pressure 120 over 80'",
    extractData: true
  },
  {
    name: "Heart Rate",
    category: "Vital Signs",
    triggers: ["heart rate", "pulse", "hr is"],
    action: "vital_hr",
    description: "Enter heart rate reading",
    example: "Say 'heart rate 72' or 'pulse 80'",
    extractData: true
  },
  {
    name: "Temperature",
    category: "Vital Signs",
    triggers: ["temperature", "temp is", "temp"],
    action: "vital_temp",
    description: "Enter temperature reading",
    example: "Say 'temperature 98.6'",
    extractData: true
  },
  {
    name: "Oxygen Saturation",
    category: "Vital Signs",
    triggers: ["oxygen", "o2 sat", "o2 is", "sat is", "oxygen saturation"],
    action: "vital_o2",
    description: "Enter oxygen saturation reading",
    example: "Say 'oxygen 97 percent' or 'o2 sat 98'",
    extractData: true
  },
  {
    name: "Pain Level",
    category: "Vital Signs",
    triggers: ["pain level", "pain is", "pain"],
    action: "vital_pain",
    description: "Enter pain level (0-10)",
    example: "Say 'pain level 5 out of 10'",
    extractData: true
  },
  {
    name: "Respiratory Rate",
    category: "Vital Signs",
    triggers: ["respiratory rate", "respirations", "rr is"],
    action: "vital_rr",
    description: "Enter respiratory rate",
    example: "Say 'respiratory rate 18'",
    extractData: true
  },
  {
    name: "Weight",
    category: "Vital Signs",
    triggers: ["weight is", "patient weighs", "weight"],
    action: "vital_weight",
    description: "Enter patient weight",
    example: "Say 'weight 165 pounds'",
    extractData: true
  },

  // Clinical Phrases - Quick Insert
  {
    name: "Lungs Clear",
    category: "Clinical Phrases",
    triggers: ["lungs clear", "clear lungs", "lung sounds clear"],
    action: "phrase_lungs_clear",
    insertText: "Lungs clear to auscultation bilaterally, no adventitious sounds noted.",
    description: "Insert normal lung assessment"
  },
  {
    name: "No Edema",
    category: "Clinical Phrases",
    triggers: ["no edema", "no swelling", "no peripheral edema"],
    action: "phrase_no_edema",
    insertText: "No peripheral edema noted in bilateral lower extremities.",
    description: "Insert no edema finding"
  },
  {
    name: "Alert and Oriented",
    category: "Clinical Phrases",
    triggers: ["alert and oriented", "oriented times four", "a and o"],
    action: "phrase_oriented",
    insertText: "Patient alert and oriented x4 (person, place, time, situation).",
    description: "Insert orientation status"
  },
  {
    name: "Medication Compliant",
    category: "Clinical Phrases",
    triggers: ["med compliant", "medication compliant", "taking medications"],
    action: "phrase_med_compliant",
    insertText: "Patient reports compliance with prescribed medication regimen.",
    description: "Insert medication compliance"
  },
  {
    name: "Denies Pain",
    category: "Clinical Phrases",
    triggers: ["denies pain", "no pain", "pain free"],
    action: "phrase_denies_pain",
    insertText: "Patient denies pain at this time.",
    description: "Insert pain denial"
  },
  {
    name: "Wound Healing",
    category: "Clinical Phrases",
    triggers: ["wound healing", "healing well", "wound looks good"],
    action: "phrase_wound_healing",
    insertText: "Wound healing well with no signs of infection. Wound bed pink with granulation tissue.",
    description: "Insert wound healing status"
  },
  {
    name: "Tolerating Diet",
    category: "Clinical Phrases",
    triggers: ["tolerating diet", "eating well", "good appetite"],
    action: "phrase_diet",
    insertText: "Patient tolerating diet well with no nausea, vomiting, or difficulty swallowing.",
    description: "Insert diet tolerance"
  },
  {
    name: "Skin Intact",
    category: "Clinical Phrases",
    triggers: ["skin intact", "no skin breakdown", "skin normal"],
    action: "phrase_skin_intact",
    insertText: "Skin warm, dry, and intact with no signs of breakdown or pressure injuries.",
    description: "Insert skin assessment"
  },
  {
    name: "Bowel Sounds Normal",
    category: "Clinical Phrases",
    triggers: ["bowel sounds normal", "normal bowel sounds", "bowel sounds present"],
    action: "phrase_bowel_sounds",
    insertText: "Bowel sounds present and active in all four quadrants.",
    description: "Insert bowel sounds assessment"
  },
  {
    name: "Heart Sounds Normal",
    category: "Clinical Phrases",
    triggers: ["heart sounds normal", "regular heart rhythm", "normal cardiac"],
    action: "phrase_heart_normal",
    insertText: "Heart sounds S1/S2 regular rate and rhythm, no murmurs, rubs, or gallops.",
    description: "Insert cardiac assessment"
  },

  // Actions
  {
    name: "Start Dictation",
    category: "Actions",
    triggers: ["start dictation", "begin dictation", "dictate note"],
    action: "action_start_dictation",
    description: "Start voice dictation for notes"
  },
  {
    name: "Stop Dictation",
    category: "Actions",
    triggers: ["stop dictation", "end dictation", "done dictating"],
    action: "action_stop_dictation",
    description: "Stop voice dictation"
  },
  {
    name: "Enhance Note",
    category: "Actions",
    triggers: ["enhance note", "process note", "ai enhance"],
    action: "action_enhance_note",
    description: "Trigger AI note enhancement"
  },
  {
    name: "Save Note",
    category: "Actions",
    triggers: ["save note", "save documentation", "save visit"],
    action: "action_save_note",
    description: "Save the current documentation"
  },
  {
    name: "Copy Note",
    category: "Actions",
    triggers: ["copy note", "copy to clipboard", "copy documentation"],
    action: "action_copy_note",
    description: "Copy enhanced note to clipboard"
  },
  {
    name: "Clear Note",
    category: "Actions",
    triggers: ["clear note", "start over", "new note"],
    action: "action_clear_note",
    description: "Clear current note content"
  },
  {
    name: "Report Incident",
    category: "Actions",
    triggers: ["report incident", "incident report", "document incident"],
    action: "action_report_incident",
    description: "Open incident reporting"
  },

  // Medicare Compliance
  {
    name: "Add Homebound Status",
    category: "Compliance",
    triggers: ["add homebound", "homebound status", "document homebound"],
    action: "compliance_homebound",
    insertText: "Patient remains homebound due to [condition/mobility limitation]. Leaving home requires considerable and taxing effort.",
    description: "Insert homebound status"
  },
  {
    name: "Add Skilled Need",
    category: "Compliance",
    triggers: ["add skilled need", "skilled nursing", "document skilled"],
    action: "compliance_skilled",
    insertText: "Skilled nursing required for [assessment/teaching/treatment] that requires the knowledge and judgment of a licensed nurse.",
    description: "Insert skilled need justification"
  }
];

export const documentationCommands = [
  // Navigation sections
  {
    name: "Cardiovascular Section",
    category: "Documentation",
    triggers: ["cardiovascular section", "cardio section", "heart assessment"],
    action: "insert_cardiovascular",
    description: "Insert cardiovascular assessment template",
    example: "Say 'cardiovascular section' to add heart assessment"
  },
  {
    name: "Respiratory Section",
    category: "Documentation",
    triggers: ["respiratory section", "lung section", "breathing assessment"],
    action: "insert_respiratory",
    description: "Insert respiratory assessment template",
    example: "Say 'respiratory section' to add lung assessment"
  },
  {
    name: "Medication Section",
    category: "Documentation",
    triggers: ["medication section", "med review", "medication management"],
    action: "insert_medication",
    description: "Insert medication management template",
    example: "Say 'medication section' to add medication review"
  },
  {
    name: "Education Section",
    category: "Documentation",
    triggers: ["education section", "teaching section", "patient education"],
    action: "insert_education",
    description: "Insert patient education template",
    example: "Say 'education section' to add teaching documentation"
  },

  // Auto-fill commands
  {
    name: "Normal Findings",
    category: "Quick Fill",
    triggers: ["add normal findings", "normal assessment", "all normal"],
    action: "insert_normal_findings",
    description: "Insert comprehensive normal assessment",
    example: "Say 'add normal findings' for standard normal assessment"
  },
  {
    name: "Normal Cardiovascular",
    category: "Quick Fill",
    triggers: ["add normal cardiovascular", "normal heart", "normal cardiac"],
    action: "insert_normal_cardiovascular",
    description: "Insert normal cardiovascular findings",
    example: "Say 'normal heart' for normal cardiac exam"
  },
  {
    name: "Normal Respiratory",
    category: "Quick Fill",
    triggers: ["add normal respiratory", "lungs clear", "clear lungs"],
    action: "insert_normal_respiratory",
    description: "Insert normal respiratory findings",
    example: "Say 'lungs clear' for normal lung assessment"
  },

  // Medicare compliance
  {
    name: "Homebound Status",
    category: "Medicare Compliance",
    triggers: ["add homebound", "homebound status", "homebound justification"],
    action: "insert_homebound",
    description: "Insert homebound status justification",
    example: "Say 'add homebound' for homebound documentation"
  },
  {
    name: "Skilled Need",
    category: "Medicare Compliance",
    triggers: ["skilled need", "skilled nursing", "skilled justification"],
    action: "insert_skilled_need",
    description: "Insert skilled nursing necessity rationale",
    example: "Say 'skilled need' for skilled nursing justification"
  },
  {
    name: "Physician Notification",
    category: "Communication",
    triggers: ["notify physician", "called doctor", "physician notification"],
    action: "insert_physician_notification",
    description: "Insert physician notification template",
    example: "Say 'notify physician' to document MD communication"
  },

  // Data insertion
  {
    name: "Insert Vital Signs",
    category: "Data Entry",
    triggers: ["insert vital signs", "add vitals", "vital signs narrative"],
    action: "insert_vitals",
    description: "Add entered vital signs to narrative",
    example: "Say 'insert vital signs' to add vitals to note"
  },
  {
    name: "Copy Previous Visit",
    category: "Efficiency",
    triggers: ["copy from last visit", "same as previous", "use last note"],
    action: "copy_previous",
    description: "Copy content from previous visit",
    example: "Say 'copy from last visit' to use previous documentation"
  },

  // Visit actions
  {
    name: "Save Documentation",
    category: "Actions",
    triggers: ["save note", "save documentation", "complete visit"],
    action: "save_documentation",
    description: "Save and complete visit documentation",
    example: "Say 'save note' to save your documentation"
  },
  {
    name: "Generate Template",
    category: "Actions",
    triggers: ["generate template", "smart template", "create template"],
    action: "generate_template",
    description: "Generate AI smart template",
    example: "Say 'generate template' for AI-generated note template"
  },
  
  // Incident reporting
  {
    name: "Report Fall",
    category: "Incidents",
    triggers: ["patient fall", "report fall", "fall incident"],
    action: "report_fall",
    description: "Open fall incident report",
    example: "Say 'patient fall' to start fall incident report"
  },
  {
    name: "Report Hospitalization",
    category: "Incidents",
    triggers: ["patient hospitalized", "report hospitalization", "er visit"],
    action: "report_hospitalization",
    description: "Open hospitalization incident report",
    example: "Say 'patient hospitalized' for hospitalization report"
  }
];

export const patientCommands = [
  {
    name: "Add New Patient",
    category: "Actions",
    triggers: ["add patient", "new patient", "create patient"],
    action: "add_patient",
    description: "Open new patient form",
    example: "Say 'add patient' to register a new patient"
  },
  {
    name: "Schedule Visit",
    category: "Actions",
    triggers: ["schedule visit", "add visit", "new visit"],
    action: "schedule_visit",
    description: "Open visit scheduling form",
    example: "Say 'schedule visit' to book a new appointment"
  },
  {
    name: "Search Patients",
    category: "Actions",
    triggers: ["search for", "find patient", "look up"],
    action: "search_patients",
    description: "Activate patient search",
    example: "Say 'search for John Smith' to find a patient"
  }
];

export const adminCommands = [
  {
    name: "View Users",
    category: "Navigation",
    triggers: ["show users", "view users", "user management"],
    action: "view_users",
    description: "Navigate to user management",
    example: "Say 'show users' to manage users"
  },
  {
    name: "View Security Logs",
    category: "Navigation",
    triggers: ["show logs", "security logs", "audit trail"],
    action: "view_security_logs",
    description: "Navigate to security audit logs",
    example: "Say 'security logs' to view audit trail"
  },
  {
    name: "View Quality Metrics",
    category: "Navigation",
    triggers: ["quality metrics", "show quality", "quality dashboard"],
    action: "view_quality_metrics",
    description: "Navigate to quality metrics dashboard",
    example: "Say 'quality metrics' to view quality data"
  },
  {
    name: "View Reports",
    category: "Navigation",
    triggers: ["show reports", "reports center", "generate reports"],
    action: "view_reports",
    description: "Navigate to reports center",
    example: "Say 'show reports' to access reports"
  },
  {
    name: "Refresh Dashboard",
    category: "Actions",
    triggers: ["refresh", "reload", "update metrics"],
    action: "refresh_admin",
    description: "Refresh admin dashboard data",
    example: "Say 'refresh' to reload dashboard metrics"
  }
];

// Helper function to get commands for specific context
export function getCommandsForContext(context) {
  switch (context) {
    case 'dashboard':
      return dashboardCommands;
    case 'documentation':
      return documentationCommands;
    case 'smartnote':
      return smartNoteCommands;
    case 'patients':
      return patientCommands;
    case 'admin':
      return adminCommands;
    default:
      return [...dashboardCommands, ...documentationCommands, ...patientCommands];
  }
}

// Parse vital signs from spoken text
export function parseVitalFromSpeech(action, spokenText) {
  const text = spokenText.toLowerCase();
  
  switch (action) {
    case 'vital_bp': {
      // Match patterns like "120 over 80", "120/80", "one twenty over eighty"
      const bpMatch = text.match(/(\d+)\s*(?:over|\/)\s*(\d+)/);
      if (bpMatch) {
        return `${bpMatch[1]}/${bpMatch[2]}`;
      }
      break;
    }
    case 'vital_hr': {
      const hrMatch = text.match(/(?:heart rate|pulse|hr)\s*(?:is|of)?\s*(\d+)/);
      if (hrMatch) return hrMatch[1];
      // Just extract any number
      const numMatch = text.match(/(\d+)/);
      if (numMatch) return numMatch[1];
      break;
    }
    case 'vital_temp': {
      const tempMatch = text.match(/(\d+\.?\d*)/);
      if (tempMatch) return tempMatch[1];
      break;
    }
    case 'vital_o2': {
      const o2Match = text.match(/(\d+)\s*(?:percent|%)?/);
      if (o2Match) return o2Match[1];
      break;
    }
    case 'vital_pain': {
      const painMatch = text.match(/(\d+)\s*(?:out of|\/)\s*\d+/);
      if (painMatch) return painMatch[1];
      const simpleMatch = text.match(/pain\s*(?:level|is|of)?\s*(\d+)/);
      if (simpleMatch) return simpleMatch[1];
      break;
    }
    case 'vital_rr': {
      const rrMatch = text.match(/(\d+)/);
      if (rrMatch) return rrMatch[1];
      break;
    }
    case 'vital_weight': {
      const weightMatch = text.match(/(\d+\.?\d*)\s*(?:pounds|lbs|kilograms|kg)?/);
      if (weightMatch) return weightMatch[1];
      break;
    }
  }
  return null;
}