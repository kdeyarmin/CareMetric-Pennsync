/**
 * Centralized AI Prompts Configuration
 * 
 * This file contains all AI prompts used throughout the application.
 * Centralizing prompts makes them easier to:
 * - Manage and update
 * - A/B test different versions
 * - Track performance by prompt version
 * - Maintain consistency across features
 */

export const AI_PROMPTS = {
  // Patient Analysis Prompts
  COMPREHENSIVE_PATIENT_ANALYSIS: {
    version: "1.0",
    prompt: (comprehensiveData) => `You are an expert clinical analyst reviewing a comprehensive patient profile. Analyze the following patient data and provide:

1. **Clinical Summary** (2-3 sentences): Concise overview of the patient's current health status
2. **Key Health Risks** (bullet points): Identify 3-5 major health risks based on:
   - Chronic conditions and their severity
   - Family medical history patterns
   - Social determinants of health barriers
   - Recent incidents and trends from visit notes
   - Medication interactions or gaps
3. **Social Risk Factors** (bullet points): Critical social determinants affecting care outcomes
4. **Actionable Recommendations** (bullet points): 3-5 specific interventions to address identified risks

Patient Data:
${JSON.stringify(comprehensiveData, null, 2)}`,
    schema: {
      type: "object",
      properties: {
        clinical_summary: {
          type: "string"
        },
        key_health_risks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              risk: { type: "string" },
              severity: {
                type: "string",
                enum: ["low", "moderate", "high", "critical"]
              },
              rationale: { type: "string" }
            }
          }
        },
        social_risk_factors: {
          type: "array",
          items: {
            type: "object",
            properties: {
              factor: { type: "string" },
              impact: {
                type: "string",
                enum: ["low", "moderate", "high"]
              },
              description: { type: "string" }
            }
          }
        },
        recommendations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              action: { type: "string" },
              priority: {
                type: "string",
                enum: ["low", "medium", "high", "urgent"]
              },
              rationale: { type: "string" }
            }
          }
        }
      }
    }
  },

  // Clinical Decision Support Prompts
  DIFFERENTIAL_DIAGNOSIS: {
    version: "1.0",
    prompt: (symptoms, history) => `Based on the following patient presentation, provide a differential diagnosis list:

Symptoms: ${symptoms}
Medical History: ${JSON.stringify(history)}

Provide the top 5 most likely diagnoses with:
1. Diagnosis name
2. Probability (high/medium/low)
3. Key supporting findings
4. Recommended next steps for confirmation`,
    schema: {
      type: "object",
      properties: {
        differential_diagnoses: {
          type: "array",
          items: {
            type: "object",
            properties: {
              diagnosis: { type: "string" },
              probability: { type: "string", enum: ["high", "medium", "low"] },
              supporting_findings: { type: "array", items: { type: "string" } },
              next_steps: { type: "array", items: { type: "string" } }
            }
          }
        }
      }
    }
  },

  // Documentation Enhancement Prompts
  ENHANCE_CLINICAL_NOTE: {
    version: "1.0",
    prompt: (roughNote, visitType, diagnosis, patientContext) => `You are an expert home health nurse documentation specialist. Transform the following rough clinical note into a comprehensive, Medicare-compliant documentation.

Visit Type: ${visitType}
Diagnosis: ${diagnosis}
Rough Note: ${roughNote}

${patientContext ? `Patient Context: ${JSON.stringify(patientContext)}` : ''}

Requirements:
- Use professional medical terminology
- Include all required Medicare elements
- Document skilled need and homebound status
- Follow proper narrative structure
- Maintain clinical accuracy
- Include objective measurements where applicable`,
    schema: {
      type: "object",
      properties: {
        enhanced_note: { type: "string" },
        quality_score: { type: "number" },
        missing_elements: { type: "array", items: { type: "string" } },
        suggestions: { type: "array", items: { type: "string" } }
      }
    }
  },

  // Care Planning Prompts
  CARE_PLAN_SUGGESTIONS: {
    version: "1.0",
    prompt: (diagnosis, goals, currentPlans) => `Generate evidence-based care plan suggestions for a home health patient.

Primary Diagnosis: ${diagnosis}
Patient Goals: ${goals}
Current Care Plans: ${JSON.stringify(currentPlans)}

Provide:
1. Problems/nursing diagnoses
2. Measurable goals
3. Specific interventions
4. Expected timeframes
5. Evaluation criteria`,
    schema: {
      type: "object",
      properties: {
        suggested_problems: {
          type: "array",
          items: {
            type: "object",
            properties: {
              problem: { type: "string" },
              goal: { type: "string" },
              interventions: { type: "array", items: { type: "string" } },
              timeframe: { type: "string" },
              evaluation_criteria: { type: "string" }
            }
          }
        }
      }
    }
  },

  // Risk Assessment Prompts
  READMISSION_RISK: {
    version: "1.0",
    prompt: (patientData, recentVisits) => `Assess the patient's risk of hospital readmission within 30 days.

Patient Data: ${JSON.stringify(patientData)}
Recent Visit Notes: ${JSON.stringify(recentVisits)}

Analyze:
- Clinical stability
- Medication adherence
- Social support system
- Follow-up compliance
- Warning signs in recent visits`,
    schema: {
      type: "object",
      properties: {
        risk_level: { type: "string", enum: ["low", "moderate", "high", "critical"] },
        risk_score: { type: "number" },
        contributing_factors: { type: "array", items: { type: "string" } },
        interventions: { type: "array", items: { type: "string" } },
        monitoring_plan: { type: "string" }
      }
    }
  },

  // Patient Education Prompts
  PATIENT_EDUCATION_MATERIAL: {
    version: "1.0",
    prompt: (topic, patientLiteracy, language) => `Create patient-friendly education material about: ${topic}

Health Literacy Level: ${patientLiteracy}
Language: ${language}

Requirements:
- Simple, clear language
- Key points format
- Action steps
- Warning signs to watch for
- When to call the doctor`,
    schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        key_points: { type: "array", items: { type: "string" } },
        action_steps: { type: "array", items: { type: "string" } },
        warning_signs: { type: "array", items: { type: "string" } },
        when_to_call: { type: "array", items: { type: "string" } }
      }
    }
  },

  // Medication Safety Prompts
  MEDICATION_INTERACTION_CHECK: {
    version: "1.0",
    prompt: (medications, allergies, conditions) => `Analyze potential medication interactions and contraindications.

Current Medications: ${JSON.stringify(medications)}
Known Allergies: ${allergies}
Medical Conditions: ${JSON.stringify(conditions)}

Provide:
1. Drug-drug interactions (severity and mechanism)
2. Drug-allergy contraindications
3. Drug-condition contraindications
4. Recommendations for safer alternatives if needed
5. Monitoring parameters`,
    schema: {
      type: "object",
      properties: {
        interactions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              drugs: { type: "array", items: { type: "string" } },
              severity: { type: "string", enum: ["minor", "moderate", "severe", "critical"] },
              mechanism: { type: "string" },
              clinical_effects: { type: "string" },
              management: { type: "string" }
            }
          }
        },
        contraindications: {
          type: "array",
          items: {
            type: "object",
            properties: {
              medication: { type: "string" },
              reason: { type: "string" },
              type: { type: "string", enum: ["allergy", "condition", "age", "other"] }
            }
          }
        },
        recommendations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              current_medication: { type: "string" },
              alternative: { type: "string" },
              rationale: { type: "string" }
            }
          }
        },
        monitoring_parameters: { type: "array", items: { type: "string" } },
        overall_risk_level: { type: "string", enum: ["low", "moderate", "high", "critical"] }
      }
    }
  },

  // Compliance & Quality Prompts
  COMPLIANCE_CHECK: {
    version: "1.0",
    prompt: (documentationText, visitType, regulations) => `Review this clinical documentation for compliance with Medicare/Medicaid requirements.

Visit Type: ${visitType}
Documentation: ${documentationText}
Regulations: ${regulations}

Check for:
- Required elements present
- Skilled need justification
- Homebound status documentation
- Goal-oriented language
- Proper terminology`,
    schema: {
      type: "object",
      properties: {
        compliance_score: { type: "number" },
        compliant_elements: { type: "array", items: { type: "string" } },
        missing_elements: { type: "array", items: { type: "string" } },
        suggestions: { type: "array", items: { type: "string" } },
        severity_issues: {
          type: "array",
          items: {
            type: "object",
            properties: {
              issue: { type: "string" },
              severity: { type: "string", enum: ["critical", "high", "medium", "low"] }
            }
          }
        }
      }
    }
  }
};

/**
 * Helper function to get a prompt by name
 */
export const getPrompt = (promptName, ...args) => {
  const promptConfig = AI_PROMPTS[promptName];
  if (!promptConfig) {
    throw new Error(`Prompt "${promptName}" not found`);
  }
  return {
    prompt: promptConfig.prompt(...args),
    schema: promptConfig.schema,
    version: promptConfig.version
  };
};

/**
 * Track prompt usage for analytics
 */
export const trackPromptUsage = async (promptName, version, success, responseTime) => {
  // This can be extended to log prompt performance metrics
  console.log(`Prompt ${promptName} v${version}: ${success ? 'Success' : 'Failed'} in ${responseTime}ms`);
};