export const getEnhanceNotePrompt = ({ visitType, selectedDiagnosis, providerType, compliancePrompt, roughNotes, customRules = [] }) => {
  const customRulesSection = customRules.length > 0 ? `

CUSTOM ORGANIZATIONAL COMPLIANCE RULES:
${customRules.map((rule, idx) => `
${idx + 1}. ${rule.rule_name} (${rule.severity.toUpperCase()})
   Category: ${rule.category}
   Requirement: ${rule.validation_criteria}
   ${rule.remediation_guidance ? `How to comply: ${rule.remediation_guidance}` : ''}
`).join('\n')}

IMPORTANT: Check compliance against ALL custom rules above and include any violations in the issues array with reference to the rule name.
` : '';

  return `You are a healthcare documentation specialist. Analyze the following rough clinical note and:${customRulesSection}

1. Extract key clinical data (diagnoses, medications, symptoms, vital signs)
2. Enhance it into a Medicare-compliant, professional clinical note
3. Perform comprehensive compliance checks based on the visit type and diagnosis
4. Provide specific compliance feedback and suggestions

Visit Type: ${visitType}
Primary Diagnosis: ${selectedDiagnosis}
Provider Type: ${providerType || 'RN'}
Compliance Requirements: ${compliancePrompt}

Rough Note:
${roughNotes}

Return your analysis in the following JSON format:
{
  "extracted_data": {
    "diagnoses": ["list of diagnoses found"],
    "medications": ["list of medications"],
    "symptoms": ["list of symptoms"],
    "vitals": {"temperature": "", "blood_pressure": "", "heart_rate": "", etc}
  },
  "enhanced_note": "The full Medicare-compliant enhanced clinical note with proper formatting",
  "compliance_check": {
    "compliance_score": 0-100,
    "status": "passed" | "flagged" | "critical",
    "issues": [{"element": "", "severity": "", "problem": "", "suggestion": ""}],
    "compliant_elements": ["list of elements that passed"]
  }
}`;
};