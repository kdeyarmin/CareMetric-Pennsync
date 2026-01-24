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

  // Clinical Note Enhancement Prompts
  ENHANCE_CLINICAL_NOTE: {
    version: "2.0",
    prompt: ({ visitType, selectedDiagnosis, providerType, compliancePrompt, roughNotes, customRules = [] }) => {
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
    },
    schema: {
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
            status: { type: "string", enum: ["passed", "flagged", "critical"] },
            issues: { type: "array", items: { type: "object" } },
            compliant_elements: { type: "array", items: { type: "string" } }
          }
        }
      }
    }
  },

  // Provider-Specific Context Builders
  PROVIDER_CONTEXT: {
    RN: {
      focusAreas: ['patient assessment', 'vital signs', 'nursing interventions', 'discharge planning', 'compliance documentation'],
      complianceEmphasis: 'Medicare Home Health Standards',
      documentationStyle: 'comprehensive nursing assessment',
      noteStructure: 'SOAP or narrative',
      suggestedCareElements: ['skilled nursing need', 'patient education', 'medication management', 'wound care', 'symptom monitoring']
    },
    LPN: {
      focusAreas: ['basic patient assessment', 'vital signs', 'supervised care delivery', 'patient comfort'],
      complianceEmphasis: 'LPN scope of practice boundaries',
      documentationStyle: 'focused patient observations',
      noteStructure: 'narrative',
      suggestedCareElements: ['vital sign changes', 'patient comfort measures', 'supervised procedures']
    },
    NP: {
      focusAreas: ['comprehensive assessment', 'diagnosis', 'treatment plans', 'medication management', 'patient education'],
      complianceEmphasis: 'NP prescribing authority and clinical decision-making',
      documentationStyle: 'detailed clinical assessment with clinical reasoning',
      noteStructure: 'SOAP with explicit assessment and plan',
      suggestedCareElements: ['differential diagnosis', 'clinical decision-making', 'medication adjustments', 'referrals']
    },
    MD: {
      focusAreas: ['diagnosis', 'treatment decisions', 'medical management', 'complex case coordination'],
      complianceEmphasis: 'Physician medical decision-making and liability',
      documentationStyle: 'clinical assessment with diagnostic reasoning',
      noteStructure: 'SOAP format',
      suggestedCareElements: ['diagnostic reasoning', 'medical decisions', 'medication management', 'specialist coordination']
    },
    DO: {
      focusAreas: ['holistic care', 'osteopathic assessment', 'medical management'],
      complianceEmphasis: 'Physician medical decision-making and OMT',
      documentationStyle: 'clinical assessment with osteopathic approach',
      noteStructure: 'SOAP format',
      suggestedCareElements: ['osteopathic assessment', 'medical decisions', 'OMT documentation']
    },
    PA: {
      focusAreas: ['patient assessment', 'diagnosis', 'treatment', 'collaborative care'],
      complianceEmphasis: 'PA scope and supervision requirements',
      documentationStyle: 'clinical assessment and treatment',
      noteStructure: 'SOAP format',
      suggestedCareElements: ['clinical assessment', 'treatment plan', 'physician collaboration']
    },
    PT: {
      focusAreas: ['physical assessment', 'mobility', 'functional capacity', 'therapy outcomes', 'fall risk'],
      complianceEmphasis: 'Rehabilitation and Medicare skilled PT requirements',
      documentationStyle: 'functional assessment and therapy progress',
      noteStructure: 'therapy note format',
      suggestedCareElements: ['range of motion', 'functional mobility', 'therapeutic exercises', 'progress toward goals']
    },
    OT: {
      focusAreas: ['occupational performance', 'ADL function', 'adaptive strategies', 'home modifications'],
      complianceEmphasis: 'Occupational therapy standards and skilled care',
      documentationStyle: 'functional and occupational assessment',
      noteStructure: 'therapy note format',
      suggestedCareElements: ['ADL independence', 'functional capacity', 'adaptive equipment', 'home safety']
    },
    ST: {
      focusAreas: ['speech/language function', 'swallowing', 'communication', 'cognitive status'],
      complianceEmphasis: 'Speech-language pathology standards',
      documentationStyle: 'communication and swallowing assessment',
      noteStructure: 'therapy note format',
      suggestedCareElements: ['speech clarity', 'swallowing function', 'communication strategies', 'cognitive status']
    },
    MSW: {
      focusAreas: ['psychosocial assessment', 'social determinants', 'discharge planning', 'resource coordination'],
      complianceEmphasis: 'Psychosocial and discharge planning standards',
      documentationStyle: 'psychosocial assessment and care coordination',
      noteStructure: 'assessment and plan format',
      suggestedCareElements: ['social situation', 'mental health status', 'family dynamics', 'discharge barriers']
    },
    Chiropractor: {
      focusAreas: ['spinal assessment', 'musculoskeletal function', 'treatment response', 'pain management'],
      complianceEmphasis: 'Chiropractic care standards',
      documentationStyle: 'structural and functional assessment',
      noteStructure: 'clinical note format',
      suggestedCareElements: ['spinal alignment', 'pain levels', 'functional improvement', 'treatment response']
    }
  },

  // Care Setting Context
  CARE_SETTING_CONTEXT: {
    home_health: {
      complianceEmphasis: 'Medicare Home Health Conditions of Participation',
      suggestedElements: ['homebound status', 'caregiver support', 'home safety', 'discharge planning'],
      relevantNotifications: ['compliance', 'discharge_planning', 'caregiver_issues']
    },
    hospice: {
      complianceEmphasis: 'Hospice comfort and symptom management',
      suggestedElements: ['symptom control', 'family support', 'goals of care', 'spiritual needs'],
      relevantNotifications: ['comfort_measures', 'family_needs', 'goal_alignment']
    },
    hospital: {
      complianceEmphasis: 'Hospital inpatient standards',
      suggestedElements: ['hospital course', 'discharge planning', 'specialist coordination'],
      relevantNotifications: ['coordination', 'discharge_planning', 'lab_results']
    },
    clinic: {
      complianceEmphasis: 'Outpatient clinical standards',
      suggestedElements: ['outpatient plan', 'follow-up appointments', 'medication refills'],
      relevantNotifications: ['follow_up', 'medication_management', 'appointment_reminders']
    },
    rehab: {
      complianceEmphasis: 'Rehabilitation and functional recovery standards',
      suggestedElements: ['functional goals', 'therapy progress', 'discharge plans'],
      relevantNotifications: ['therapy_progress', 'functional_goals', 'discharge_planning']
    },
    ltc: {
      complianceEmphasis: 'Long-term care and skilled nursing facility standards',
      suggestedElements: ['care plan updates', 'quality of life', 'family communication'],
      relevantNotifications: ['care_plan_updates', 'family_communication', 'resident_safety']
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
  },

  // Clinical Insights Prompts
  CLINICAL_INSIGHTS: {
    version: "1.0",
    prompt: (noteContent, diagnoses, symptoms, medications, vitalSigns) => `Analyze this clinical documentation and provide actionable clinical insights.

Clinical Note: ${noteContent}
Diagnoses: ${JSON.stringify(diagnoses)}
Symptoms: ${JSON.stringify(symptoms)}
Medications: ${JSON.stringify(medications)}
Vital Signs: ${JSON.stringify(vitalSigns)}

Provide:
1. Key clinical findings and their significance
2. Potential concerns or red flags
3. Recommended clinical actions
4. Patient education priorities`,
    schema: {
      type: "object",
      properties: {
        key_findings: { type: "array", items: { type: "string" } },
        concerns: { 
          type: "array", 
          items: {
            type: "object",
            properties: {
              concern: { type: "string" },
              severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
              recommendation: { type: "string" }
            }
          }
        },
        clinical_actions: { type: "array", items: { type: "string" } },
        education_priorities: { type: "array", items: { type: "string" } }
      }
    }
  },

  // Follow-Up Tasks Generation
  FOLLOW_UP_TASKS: {
    version: "1.0",
    prompt: (visitNotes, patientName, vitalSigns) => `Based on this clinical visit, suggest follow-up tasks.

Patient: ${patientName}
Visit Notes: ${visitNotes}
Vital Signs: ${JSON.stringify(vitalSigns)}

Generate tasks for:
- Required follow-up actions
- Physician notifications needed
- Care coordination needs
- Patient education to reinforce
- Monitoring parameters`,
    schema: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              priority: { type: "string", enum: ["critical", "high", "medium", "low"] },
              type: { type: "string" },
              suggested_due_timeframe: { type: "string" },
              ai_reason: { type: "string" }
            }
          }
        }
      }
    }
  },

  // OASIS Field Suggestions
  OASIS_FIELD_SUGGESTIONS: {
    version: "1.0",
    prompt: (visitType, diagnosis, noteContent) => `Suggest OASIS field values based on clinical documentation.

Visit Type: ${visitType}
Diagnosis: ${diagnosis}
Clinical Note: ${noteContent}

Provide suggested values for key OASIS items with rationale.`,
    schema: {
      type: "object",
      properties: {
        suggested_fields: {
          type: "array",
          items: {
            type: "object",
            properties: {
              oasis_item: { type: "string" },
              suggested_value: { type: "string" },
              rationale: { type: "string" },
              confidence: { type: "string", enum: ["high", "medium", "low"] }
            }
          }
        }
      }
    }
  },

  // Training Recommendations
  TRAINING_RECOMMENDATIONS: {
    version: "1.0",
    prompt: (skillGaps, performanceMetrics, providerType) => `Generate personalized training recommendations.

Provider Type: ${providerType}
Identified Skill Gaps: ${JSON.stringify(skillGaps)}
Performance Metrics: ${JSON.stringify(performanceMetrics)}

Recommend:
1. Specific training modules to address gaps
2. Priority order based on impact
3. Estimated time to complete
4. Expected outcomes`,
    schema: {
      type: "object",
      properties: {
        recommendations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              training_topic: { type: "string" },
              priority: { type: "string", enum: ["urgent", "high", "medium", "low"] },
              rationale: { type: "string" },
              estimated_duration_minutes: { type: "number" },
              expected_outcomes: { type: "array", items: { type: "string" } }
            }
          }
        }
      }
    }
  },

  // Care Plan Optimization
  CARE_PLAN_OPTIMIZATION: {
    version: "1.0",
    prompt: (currentCarePlans, progressNotes, patientGoals) => `Optimize existing care plans based on patient progress.

Current Care Plans: ${JSON.stringify(currentCarePlans)}
Recent Progress Notes: ${JSON.stringify(progressNotes)}
Patient Goals: ${patientGoals}

Analyze:
- Which goals are being met/not met
- Interventions that should be modified
- New problems that emerged
- Recommended adjustments`,
    schema: {
      type: "object",
      properties: {
        optimization_recommendations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              care_plan_id: { type: "string" },
              current_status: { type: "string" },
              recommended_action: { type: "string", enum: ["continue", "modify", "discontinue", "escalate"] },
              rationale: { type: "string" },
              suggested_modifications: { type: "string" }
            }
          }
        }
      }
    }
  },

  // Documentation Gap Detection
  DOCUMENTATION_GAPS: {
    version: "1.0",
    prompt: (noteContent, visitType, requiredElements) => `Identify documentation gaps in this clinical note.

Visit Type: ${visitType}
Note Content: ${noteContent}
Required Elements: ${JSON.stringify(requiredElements)}

Check for missing or incomplete documentation of required elements.`,
    schema: {
      type: "object",
      properties: {
        gaps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              element: { type: "string" },
              severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
              issue: { type: "string" },
              suggestion: { type: "string" }
            }
          }
        }
      }
    }
  },

  // Telehealth Visit Summary
  TELEHEALTH_SUMMARY: {
    version: "1.0",
    prompt: (callTranscript, duration, participantNotes) => `Generate a clinical summary from this telehealth visit.

Call Duration: ${duration} minutes
Transcript: ${callTranscript}
Provider Notes: ${participantNotes}

Create a structured visit summary with:
- Chief complaint
- Assessment findings
- Clinical decisions made
- Follow-up plan
- Patient education provided`,
    schema: {
      type: "object",
      properties: {
        chief_complaint: { type: "string" },
        assessment: { type: "string" },
        clinical_decisions: { type: "array", items: { type: "string" } },
        follow_up_plan: { type: "string" },
        education_provided: { type: "array", items: { type: "string" } }
      }
    }
  },

  // Risk Stratification
  RISK_STRATIFICATION: {
    version: "1.0",
    prompt: (patientData, recentVisits, alerts) => `Perform comprehensive risk stratification for this patient.

Patient Data: ${JSON.stringify(patientData)}
Recent Visits: ${JSON.stringify(recentVisits)}
Active Alerts: ${JSON.stringify(alerts)}

Assess risks for:
- Hospital readmission
- Falls
- Medication non-adherence
- Clinical deterioration
- Social factors`,
    schema: {
      type: "object",
      properties: {
        overall_risk_score: { type: "number" },
        risk_level: { type: "string", enum: ["low", "moderate", "high", "critical"] },
        risk_categories: {
          type: "object",
          properties: {
            readmission: { type: "object" },
            falls: { type: "object" },
            medication: { type: "object" },
            clinical: { type: "object" },
            social: { type: "object" }
          }
        },
        interventions: { type: "array", items: { type: "string" } }
      }
    }
  },

  // Billing Code Suggestions
  BILLING_CODE_SUGGESTIONS: {
    version: "1.0",
    prompt: (noteContent, visitType, providerType, duration) => `Suggest appropriate billing codes for this visit.

Provider Type: ${providerType}
Visit Type: ${visitType}
Duration: ${duration} minutes
Clinical Note: ${noteContent}

Provide CPT codes, ICD-10 codes, and modifiers with medical necessity justification.`,
    schema: {
      type: "object",
      properties: {
        cpt_codes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              code: { type: "string" },
              description: { type: "string" },
              units: { type: "number" },
              justification: { type: "string" }
            }
          }
        },
        icd10_codes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              code: { type: "string" },
              description: { type: "string" },
              supported_by: { type: "string" }
            }
          }
        },
        modifiers: { type: "array", items: { type: "string" } },
        medical_necessity: { type: "string" }
      }
    }
  },

  // Prior Authorization Generation
  PRIOR_AUTHORIZATION: {
    version: "1.0",
    prompt: (diagnosis, treatment, clinicalJustification, patientHistory) => `Generate a prior authorization request.

Diagnosis: ${diagnosis}
Requested Treatment: ${treatment}
Clinical Justification: ${clinicalJustification}
Patient History: ${patientHistory}

Create a compelling prior authorization letter with medical necessity documentation.`,
    schema: {
      type: "object",
      properties: {
        authorization_letter: { type: "string" },
        key_justifications: { type: "array", items: { type: "string" } },
        supporting_evidence: { type: "array", items: { type: "string" } },
        expected_outcomes: { type: "string" }
      }
    }
  }
};

/**
 * Helper Functions
 */

/**
 * Get a prompt by name with arguments
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
 * Get provider-specific prompt additions
 */
export const getProviderPromptAdditions = (providerType) => {
  const context = AI_PROMPTS.PROVIDER_CONTEXT[providerType] || AI_PROMPTS.PROVIDER_CONTEXT.RN;
  
  return `
PROVIDER-SPECIFIC CONTEXT:
Provider Type: ${providerType}
Focus Areas: ${context.focusAreas.join(', ')}
Documentation Style: ${context.documentationStyle}
Expected Note Structure: ${context.noteStructure}
Compliance Standard: ${context.complianceEmphasis}

When generating suggestions, prioritize these care plan elements for ${providerType}:
${context.suggestedCareElements.map(elem => `- ${elem}`).join('\n')}

Apply this provider's scope of practice and standards throughout the documentation.`;
};

/**
 * Get care location specific prompt additions
 */
export const getCareSettingPromptAdditions = (serviceType) => {
  const context = AI_PROMPTS.CARE_SETTING_CONTEXT[serviceType];
  
  if (!context) return '';
  
  return `
CARE LOCATION CONTEXT:
Service Type: ${serviceType}
Compliance Focus: ${context.complianceEmphasis}

Ensure documentation includes these location-specific elements:
${context.suggestedElements.map(elem => `- ${elem}`).join('\n')}`;
};

/**
 * Track prompt usage for analytics and optimization
 */
export const trackPromptUsage = async (promptName, version, success, responseTime) => {
  // This can be extended to log prompt performance metrics
  console.log(`Prompt ${promptName} v${version}: ${success ? 'Success' : 'Failed'} in ${responseTime}ms`);
  
  // Future: Log to analytics entity for tracking prompt performance over time
  /*
  try {
    await base44.entities.AIPromptMetrics.create({
      prompt_name: promptName,
      version: version,
      success: success,
      response_time_ms: responseTime,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Failed to track prompt usage:', err);
  }
  */
};

/**
 * Get all available prompt names for reference
 */
export const getAvailablePrompts = () => {
  return Object.keys(AI_PROMPTS).filter(key => 
    !['PROVIDER_CONTEXT', 'CARE_SETTING_CONTEXT'].includes(key)
  );
};