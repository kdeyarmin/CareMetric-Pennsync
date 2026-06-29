// Enhanced voice commands for Smart Note Assistant with multi-language support

export const smartNoteCommands = [
  // Navigation Commands
  {
    trigger: "select patient",
    aliases: ["choose patient", "pick patient", "patient select"],
    action: "focus_patient_select",
    category: "navigation",
    description: "Focus on patient selection field"
  },
  {
    trigger: "next step",
    aliases: ["continue", "proceed", "next"],
    action: "next_step",
    category: "navigation",
    description: "Move to next documentation step"
  },
  {
    trigger: "previous step",
    aliases: ["go back", "back", "previous"],
    action: "previous_step",
    category: "navigation",
    description: "Return to previous step"
  },
  
  // Data Entry Commands
  {
    trigger: "blood pressure",
    aliases: ["bp", "set blood pressure"],
    action: "enter_blood_pressure",
    category: "vitals",
    description: "Enter blood pressure (e.g., 'blood pressure 120 over 80')",
    extractValue: true
  },
  {
    trigger: "heart rate",
    aliases: ["hr", "pulse", "set heart rate"],
    action: "enter_heart_rate",
    category: "vitals",
    description: "Enter heart rate (e.g., 'heart rate 72')",
    extractValue: true
  },
  {
    trigger: "temperature",
    aliases: ["temp", "set temperature"],
    action: "enter_temperature",
    category: "vitals",
    description: "Enter temperature (e.g., 'temperature 98.6')",
    extractValue: true
  },
  {
    trigger: "oxygen saturation",
    aliases: ["o2 sat", "sats", "oxygen"],
    action: "enter_oxygen",
    category: "vitals",
    description: "Enter O2 saturation (e.g., 'oxygen saturation 95')",
    extractValue: true
  },
  {
    trigger: "pain level",
    aliases: ["pain scale", "pain"],
    action: "enter_pain",
    category: "vitals",
    description: "Enter pain level 0-10 (e.g., 'pain level 3')",
    extractValue: true
  },
  
  // Action Commands
  {
    trigger: "enhance note",
    aliases: ["transform note", "improve note", "enhance"],
    action: "enhance_note",
    category: "action",
    description: "Transform rough notes to Medicare-compliant"
  },
  {
    trigger: "copy note",
    aliases: ["copy to clipboard", "copy"],
    action: "copy_note",
    category: "action",
    description: "Copy enhanced note to clipboard"
  },
  {
    trigger: "save note",
    aliases: ["save visit", "save"],
    action: "save_note",
    category: "action",
    description: "Save note to patient record"
  },
  {
    trigger: "clear note",
    aliases: ["start over", "new note", "clear"],
    action: "clear_note",
    category: "action",
    description: "Clear current note and start fresh"
  },
  {
    trigger: "generate tasks",
    aliases: ["create tasks", "task generation"],
    action: "generate_tasks",
    category: "action",
    description: "Generate follow-up tasks from note"
  },
  
  // Visit Type Selection
  {
    trigger: "admission visit",
    aliases: ["set admission", "admission"],
    action: "set_visit_admission",
    category: "visit_type",
    description: "Set visit type to admission"
  },
  {
    trigger: "routine visit",
    aliases: ["set routine", "routine"],
    action: "set_visit_routine",
    category: "visit_type",
    description: "Set visit type to routine"
  },
  {
    trigger: "recertification visit",
    aliases: ["recert", "recertification"],
    action: "set_visit_recert",
    category: "visit_type",
    description: "Set visit type to recertification"
  },
  
  // Clinical Phrases
  {
    trigger: "patient alert and oriented",
    aliases: ["alert oriented", "a and o"],
    action: "insert_phrase",
    value: "Patient is alert and oriented to person, place, time, and situation.",
    category: "phrase",
    description: "Insert A&O phrase"
  },
  {
    trigger: "lungs clear bilaterally",
    aliases: ["clear lung sounds", "lungs clear"],
    action: "insert_phrase",
    value: "Bilateral lung sounds clear to auscultation, no wheezes, crackles, or rhonchi noted.",
    category: "phrase",
    description: "Insert clear lungs phrase"
  },
  {
    trigger: "heart regular rhythm",
    aliases: ["regular heart", "rrr"],
    action: "insert_phrase",
    value: "Heart rhythm regular, S1 and S2 present, no murmurs, gallops, or rubs appreciated.",
    category: "phrase",
    description: "Insert regular heart rhythm phrase"
  },
  {
    trigger: "patient tolerating medications",
    aliases: ["med tolerance", "tolerating meds"],
    action: "insert_phrase",
    value: "Patient reports tolerating current medication regimen without adverse effects.",
    category: "phrase",
    description: "Insert medication tolerance phrase"
  },
  {
    trigger: "patient homebound",
    aliases: ["homebound status", "homebound"],
    action: "insert_phrase",
    value: "Patient remains homebound due to significant mobility limitations. Leaving home would require considerable and taxing effort.",
    category: "phrase",
    description: "Insert homebound status phrase"
  }
];

// Parse vital signs from spoken text with improved accuracy
export const parseVitalSigns = (text) => {
  const vitals = {};
  const _normalizedText = text.toLowerCase();
  
  // Blood Pressure - multiple formats
  const bpPatterns = [
    /(\d{2,3})\s*over\s*(\d{2,3})/i,
    /(\d{2,3})\s*\/\s*(\d{2,3})/,
    /blood pressure\s*(\d{2,3})\s*over\s*(\d{2,3})/i,
    /bp\s*(\d{2,3})\s*over\s*(\d{2,3})/i
  ];
  
  for (const pattern of bpPatterns) {
    const bpMatch = text.match(pattern);
    if (bpMatch) {
      vitals.bp = `${bpMatch[1]}/${bpMatch[2]}`;
      break;
    }
  }
  
  // Heart Rate
  const hrPatterns = [
    /heart rate\s*(\d{2,3})/i,
    /pulse\s*(\d{2,3})/i,
    /hr\s*(\d{2,3})/i
  ];
  
  for (const pattern of hrPatterns) {
    const hrMatch = text.match(pattern);
    if (hrMatch) {
      vitals.hr = hrMatch[1];
      break;
    }
  }
  
  // Temperature
  const tempPatterns = [
    /temperature\s*(\d{2,3}\.?\d*)/i,
    /temp\s*(\d{2,3}\.?\d*)/i
  ];
  
  for (const pattern of tempPatterns) {
    const tempMatch = text.match(pattern);
    if (tempMatch) {
      vitals.temp = tempMatch[1];
      break;
    }
  }
  
  // Oxygen Saturation
  const o2Patterns = [
    /oxygen\s*(?:saturation)?\s*(\d{2,3})/i,
    /o2\s*sat\s*(\d{2,3})/i,
    /sats?\s*(\d{2,3})/i
  ];
  
  for (const pattern of o2Patterns) {
    const o2Match = text.match(pattern);
    if (o2Match) {
      vitals.o2 = o2Match[1];
      break;
    }
  }
  
  // Pain Level
  const painPatterns = [
    /pain\s*(?:level)?\s*(\d{1,2})/i,
    /pain\s*scale\s*(\d{1,2})/i
  ];
  
  for (const pattern of painPatterns) {
    const painMatch = text.match(pattern);
    if (painMatch) {
      vitals.pain = painMatch[1];
      break;
    }
  }
  
  return vitals;
};