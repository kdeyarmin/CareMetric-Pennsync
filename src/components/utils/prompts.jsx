import { getProviderCompliancePrompt } from "@/components/utils/providerSpecificConfig";

export const getSmartNoteEnhancementPrompt = ({
  visitType,
  selectedDiagnosis,
  providerType = 'RN',
  roughNotes,
}) => {
  const compliancePrompt = getProviderCompliancePrompt(providerType, visitType);

  return `You are a healthcare documentation specialist. Analyze the following rough clinical note and:

1. Extract key clinical data (diagnoses, medications, symptoms, vital signs)
2. Enhance it into a Medicare-compliant, professional clinical note
3. Perform comprehensive compliance checks based on the visit type and diagnosis
4. Provide specific compliance feedback and suggestions

Visit Type: ${visitType}
Primary Diagnosis: ${selectedDiagnosis}
Provider Type: ${providerType}
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

export const getSmartNoteResponseSchema = () => {
    return {
        type: "object",
        properties: {
          extracted_data: {
            type: "object",
            properties: {
              diagnoses: { type: "array", items: { type: "string" } },
              medications: { type: "array", items: { type: "string" } },
              symptoms: { type: "array", items: { type: "string" } },
              vitals: { type: "object" }
            }
          },
          enhanced_note: { type: "string" },
          compliance_check: {
            type: "object",
            properties: {
              compliance_score: { type: "number" },
              status: { type: "string" },
              issues: { type: "array" },
              compliant_elements: { type: "array" }
            }
          }
        }
      };
}