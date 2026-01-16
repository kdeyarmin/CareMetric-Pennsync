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

    const enhancementPrompt = `You are a healthcare documentation AI assistant. Your task is to enhance clinical notes while ensuring Medicare compliance and assessing documentation quality.

VISIT TYPE: ${visit_type}
PRIMARY DIAGNOSIS: ${diagnosis}
PROVIDER TYPE: ${provider_type}

${compliance_prompt}${customRulesText}

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
2. ENHANCED NOTE: Rewrite the notes to be Medicare-compliant, professional, and detailed
3. COMPLIANCE CHECK: Assess Medicare compliance with specific issues and violations
4. QUALITY ANALYSIS: Evaluate documentation quality including:
   - Overall quality score (0-100)
   - Clarity score (0-100)
   - Completeness score (0-100)
   - Specific strengths in the documentation
   - Detailed suggestions for improvement with severity levels
   - Each suggestion should include: issue, category, severity, recommendation, excerpt (if applicable), and improved_text (if applicable)

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
                priority: { type: "string" },
                type: { type: "string" },
                suggested_due_timeframe: { type: "string" },
                ai_reason: { type: "string" }
              }
            }
          }
        }
      }
    });

    console.log('Enhancement and quality analysis completed successfully');

    return Response.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('Error in enhanceNoteWithQuality:', error);
    return Response.json({ 
      error: error.message || 'Failed to enhance note',
      details: error.stack 
    }, { status: 500 });
  }
});