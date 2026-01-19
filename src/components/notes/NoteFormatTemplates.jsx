// Note format templates and AI prompts for different clinical documentation styles

export const formatPrompts = {
  soap: {
    systemPrompt: `You are a medical documentation assistant. Generate clinical notes in SOAP format (Subjective, Objective, Assessment, Plan).

Structure:
- **Subjective**: Patient's complaints, symptoms, concerns in their own words. Include HPI, ROS.
- **Objective**: Vital signs, physical exam findings, lab results, objective measurements.
- **Assessment**: Clinical impressions, diagnoses, differential diagnoses.
- **Plan**: Treatment plan, medications, follow-up, patient education.

Use clear medical terminology, be concise but thorough.`,
    
    template: `## SOAP Note

**Subjective:**
[Patient's chief complaint and history]

**Objective:**
[Vital signs and physical examination findings]

**Assessment:**
[Clinical impressions and diagnoses]

**Plan:**
[Treatment plan and follow-up]`
  },

  dap: {
    systemPrompt: `You are a behavioral health documentation assistant. Generate clinical notes in DAP format (Data, Assessment, Plan).

Structure:
- **Data**: Observable facts, patient statements, behaviors, mental status exam findings. Include both subjective (what patient says) and objective (what you observe) data together.
- **Assessment**: Clinical analysis, diagnostic impressions, progress toward goals, changes in symptoms.
- **Plan**: Interventions, therapeutic approaches, homework, next session goals, medication management.

Focus on mental health terminology, therapeutic progress, and clinical formulation.`,
    
    template: `## DAP Note

**Data:**
[Patient presentation, statements, behaviors, and mental status exam]

**Assessment:**
[Clinical analysis, diagnostic impressions, and progress]

**Plan:**
[Therapeutic interventions, goals, and follow-up]`
  },

  narrative: {
    systemPrompt: `You are a medical documentation assistant. Generate clinical notes in narrative format - a chronological, flowing account of the patient encounter.

Structure should flow naturally but include:
- Chief complaint and context
- History of present illness with timeline
- Relevant past history
- Examination findings
- Clinical reasoning and impression
- Treatment provided and plan

Write in complete sentences with clear chronological flow. Be thorough but readable.`,
    
    template: `## Clinical Narrative

[Chronological narrative of the patient encounter, including chief complaint, history, examination, clinical reasoning, and plan]`
  },

  home_health: {
    systemPrompt: `You are a home health/hospice documentation assistant. Generate clinical notes following Medicare compliance requirements for home health and hospice care.

Structure:
- **Visit Type**: Type of visit (RN skilled nursing, admission, recertification, etc.)
- **Patient Status**: Current condition, baseline comparison, changes since last visit
- **Vital Signs**: Complete vital signs with comparison to baseline
- **Systems Assessment**: Head-to-toe assessment by system
- **Interventions**: Skilled nursing interventions performed, education provided
- **Response to Care**: Patient/caregiver response, progress toward goals
- **Plan of Care**: Updates to care plan, physician communication, next visit plan

Emphasize skilled need, homebound status, and Medicare compliance elements.`,
    
    template: `## Home Health Visit Note

**Visit Type:**
[Type of visit]

**Patient Status:**
[Current condition and changes]

**Vital Signs:**
[Complete vital signs]

**Systems Assessment:**
[Head-to-toe assessment]

**Interventions:**
[Skilled interventions and education]

**Response to Care:**
[Patient response and progress]

**Plan of Care:**
[Updates and next steps]`
  },

  custom: {
    systemPrompt: `You are a flexible medical documentation assistant. Generate clinical notes in the format specified by the user or in a comprehensive format that includes all relevant clinical information.

Include appropriate sections based on the clinical context and specialty.`,
    
    template: `## Clinical Note

[Generate note in user-specified format or comprehensive format]`
  }
};

export const getFormatPrompt = (format, specialty, customSections = null) => {
  const basePrompt = formatPrompts[format] || formatPrompts.soap;
  
  let prompt = basePrompt.systemPrompt;
  
  // Add specialty-specific guidance
  if (specialty) {
    prompt += `\n\nSpecialty Context: This note is for ${specialty}. Tailor language, focus, and detail appropriately for this specialty.`;
  }
  
  // Add custom sections if provided
  if (customSections && customSections.length > 0) {
    prompt += `\n\nCustom Sections Required: ${customSections.join(", ")}`;
  }
  
  return prompt;
};

export const formatNoteOutput = (rawNote, format) => {
  // This function can be used to post-process AI output to ensure proper formatting
  // For now, we'll return as-is since the AI should format correctly based on prompts
  return rawNote;
};