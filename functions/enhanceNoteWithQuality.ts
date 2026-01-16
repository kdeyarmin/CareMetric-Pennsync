import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { 
      rough_notes, 
      visit_type, 
      diagnosis, 
      provider_type,
      compliance_prompt,
      custom_rules,
      patient_id,
      vital_signs,
      patient_context,
      ai_preferences
    } = await req.json();

    console.log('Starting consolidated note enhancement and quality analysis...');

    // Build the comprehensive prompt
    const customRulesText = custom_rules?.length > 0 
      ? `\n\nORGANIZATIONAL COMPLIANCE RULES:\n${custom_rules.map(rule => 
          `- ${rule.rule_name}: ${rule.description}\n  Requirement: ${rule.requirement_text}`
        ).join('\n')}`
      : '';

    // Add user-defined custom compliance rules from AI preferences
    const userCustomRules = ai_preferences?.custom_compliance_rules?.filter(r => r.is_active !== false) || [];
    const userRulesText = userCustomRules.length > 0
      ? `\n\nUSER-DEFINED CUSTOM COMPLIANCE RULES:\n${userCustomRules.map(rule =>
          `- ${rule.rule_name}: ${rule.rule_description}${rule.applies_to_visit_types?.length > 0 ? `\n  Applies to: ${rule.applies_to_visit_types.join(', ')}` : ''}`
        ).join('\n')}\n\nIMPORTANT: These are the user's specific compliance requirements. Interpret and apply them intelligently to the clinical note.`
      : '';

    const enhancementPrompt = `You are a healthcare documentation AI assistant. Your task is to enhance clinical notes while ensuring Medicare compliance and assessing documentation quality.

VISIT TYPE: ${visit_type}
PRIMARY DIAGNOSIS: ${diagnosis}
PROVIDER TYPE: ${provider_type}

${compliance_prompt}${customRulesText}${userRulesText}

${vital_signs && Object.values(vital_signs).some(v => v) ? `VITAL SIGNS:
${vital_signs.temperature ? `Temperature: ${vital_signs.temperature}°F\n` : ''}${vital_signs.heart_rate ? `Heart Rate: ${vital_signs.heart_rate} bpm\n` : ''}${vital_signs.respiratory_rate ? `Respiratory Rate: ${vital_signs.respiratory_rate}\n` : ''}${vital_signs.bp_systolic && vital_signs.bp_diastolic ? `Blood Pressure: ${vital_signs.bp_systolic}/${vital_signs.bp_diastolic}\n` : ''}${vital_signs.oxygen_saturation ? `O2 Saturation: ${vital_signs.oxygen_saturation}%\n` : ''}
` : ''}${patient_context ? `
PATIENT CONTEXT:
- Patient: ${patient_context.patient_name}
- Primary Diagnosis: ${patient_context.primary_diagnosis || 'Not specified'}
${patient_context.secondary_diagnoses?.length > 0 ? `- Secondary Diagnoses: ${patient_context.secondary_diagnoses.join(', ')}\n` : ''}${patient_context.allergies ? `- Allergies: ${patient_context.allergies}\n` : ''}${patient_context.current_medications?.length > 0 ? `- Current Medications: ${patient_context.current_medications.map(m => m.name).join(', ')}\n` : ''}
${patient_context.recent_notes?.length > 0 ? `RECENT VISIT NOTES (Last 3):
${patient_context.recent_notes.map((note, i) => `${i + 1}. ${note.date} - ${note.visit_type}: ${note.note_excerpt}...`).join('\n')}
` : ''}${patient_context.active_care_plans?.length > 0 ? `ACTIVE CARE PLANS:
${patient_context.active_care_plans.map((cp, i) => `${i + 1}. Problem: ${cp.problem}, Goal: ${cp.goal}`).join('\n')}
` : ''}` : ''}
${ai_preferences ? `AI DOCUMENTATION PREFERENCES:
- Verbosity: ${ai_preferences.verbosity_level || 'balanced'} (concise/balanced/detailed)
- Compliance Focus: ${ai_preferences.compliance_priority || 'medicare'}
- Note Structure: ${ai_preferences.preferred_note_structure || 'narrative'} format
- Quality Suggestions: ${ai_preferences.suggestion_aggressiveness || 'moderate'} level
${ai_preferences.include_education_tips ? '- Include patient education tips in the note\n' : ''}
` : ''}
ROUGH CLINICAL NOTES:
${rough_notes}

Please provide a comprehensive response that includes:

1. EXTRACTED DATA: Parse and extract structured data from the notes
2. ENHANCED NOTE: Rewrite the notes to be Medicare-compliant, professional, and detailed. 
   CRITICAL: DO NOT include meta-commentary, recommendations, or statements about what should be done. Only include actual clinical documentation. Remove any sentences starting with "Further assessment", "Additional documentation", "It is recommended", etc.
   NOTE: Do NOT flag or include missing vital signs in the narrative - vitals are optional.
3. COMPLIANCE CHECK: Assess Medicare compliance with specific issues and violations
   For each issue found, provide SPECIFIC, ACTIONABLE guidance on exactly what should be documented or improved, not just generic recommendations
4. QUALITY ANALYSIS: Evaluate documentation quality including:
   - Overall quality score (0-100)
   - Clarity score (0-100)
   - Completeness score (0-100)
   - Specific strengths in the documentation
   - Detailed suggestions for improvement with severity levels
   - IMPORTANT: Do NOT suggest or flag missing vital signs as an issue for improvement
   - Each suggestion should include: issue, category, severity, recommendation, excerpt (if applicable), and improved_text (the actual wording that should replace the excerpt, not instructions about what to do)
5. SUGGESTED EDUCATION MATERIALS: Based on the diagnosis and note content, suggest relevant patient education topics with:
   - title: Education topic title
   - reason: Why this education is important for this patient
   - category: Education category (e.g., disease management, medication, lifestyle)

6. INTELLIGENT TASK PRIORITIZATION: For suggested follow-up tasks, analyze the following factors to determine priority and timing:
   - Patient condition severity and stability
   - Clinical risk indicators (vital signs abnormalities, deteriorating symptoms, safety concerns)
   - Medicare/regulatory compliance requirements and deadlines
   - Care coordination needs (physician notification, equipment orders, referrals)
   - Recent patient interactions and visit frequency
   - Medication management urgency
   - Wound healing status or infection risks
   
   Priority Levels:
   - urgent: Immediate action needed (same day) - safety concerns, critical symptoms, emergency situations
   - high: Action needed within 24-48 hours - significant clinical changes, medication issues, physician notification
   - medium: Action needed within 1 week - routine follow-ups, coordination tasks, non-urgent education
   - low: Can be scheduled flexibly - documentation review, routine supplies, general wellness checks
   
   Due Date Logic:
   - urgent: Set to today or within 4 hours
   - high: Set to tomorrow (24_hours) or within 2 days (48_hours)
   - medium: Set to this_week or within 7 days
   - low: Set to next_visit or no specific deadline
   
   Include clear ai_reason explaining WHY the priority and timing were assigned based on clinical judgment.

Return comprehensive results in the specified JSON format.`;

    // Single LLM call for everything
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: enhancementPrompt,
      response_json_schema: {
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
              issues: { 
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    element: { type: "string" },
                    problem: { type: "string" },
                    suggestion: { type: "string" },
                    severity: { type: "string" }
                  }
                }
              },
              compliant_elements: { type: "array", items: { type: "string" } },
              medicare_violations: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    violation: { type: "string" },
                    severity: { type: "string" },
                    cop_reference: { type: "string" },
                    remediation: { type: "string" }
                  }
                }
              },
              regulatory_warnings: { type: "array", items: { type: "string" } }
            }
          },
          quality_analysis: {
            type: "object",
            properties: {
              overall_quality_score: { type: "number" },
              clarity_score: { type: "number" },
              completeness_score: { type: "number" },
              strengths: { type: "array", items: { type: "string" } },
              suggestions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    issue: { type: "string" },
                    category: { type: "string" },
                    severity: { type: "string" },
                    recommendation: { type: "string" },
                    excerpt: { type: "string" },
                    improved_text: { type: "string" }
                  }
                }
              }
            }
          },
          suggested_tasks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                description: { type: "string" },
                priority: { 
                  type: "string",
                  enum: ["urgent", "high", "medium", "low"],
                  description: "AI-determined priority based on clinical severity and workflow needs"
                },
                type: { type: "string" },
                suggested_due_timeframe: { 
                  type: "string",
                  enum: ["today", "24_hours", "48_hours", "this_week", "next_visit"],
                  description: "AI-recommended timeframe for completion"
                },
                ai_reason: { 
                  type: "string",
                  description: "Detailed explanation of why this priority and timing were assigned"
                },
                clinical_indicators: {
                  type: "array",
                  items: { type: "string" },
                  description: "Specific clinical factors that influenced prioritization"
                }
              }
            }
          },
          suggested_education_materials: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                reason: { type: "string" },
                category: { type: "string" }
              }
            }
          }
        }
      }
    });

    console.log('Enhancement and quality analysis completed successfully');

    // Apply quality improvements to the enhanced note
    let improvedNote = result.enhanced_note;
    if (result.quality_analysis?.suggestions && Array.isArray(result.quality_analysis.suggestions)) {
      for (const suggestion of result.quality_analysis.suggestions) {
        if (suggestion.excerpt && suggestion.improved_text) {
          improvedNote = improvedNote.replace(suggestion.excerpt, suggestion.improved_text);
        }
      }
    }

    return Response.json({
      success: true,
      data: {
        ...result,
        enhanced_note: improvedNote
      }
    });

  } catch (error) {
    console.error('Error in enhanceNoteWithQuality:', error);
    return Response.json({ 
      error: error.message || 'Failed to enhance note',
      details: error.stack 
    }, { status: 500 });
  }
});