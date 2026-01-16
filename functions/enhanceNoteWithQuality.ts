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

    const enhancementPrompt = `You are an elite healthcare documentation specialist. Your task is to craft the highest quality Medicare-compliant clinical narrative that demonstrates clinical excellence and regulatory mastery.

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

EXCELLENCE CRITERIA FOR ENHANCED NARRATIVE:
- Create a cohesive, flowing narrative that demonstrates comprehensive patient assessment
- Establish clear clinical reasoning and evidence-based decision-making
- Use precise medical terminology while maintaining clarity
- Show patient trajectory and clinical decision points
- Document skilled nursing or clinical judgement clearly
- Ensure all assessments directly support the primary and secondary diagnoses
- Link interventions to identified clinical needs
- Create chronological and logical flow between assessment, findings, and plan

Please provide a comprehensive response that includes:

1. EXTRACTED DATA: Parse and extract structured data from the notes
2. ENHANCED NARRATIVE NOTE: Craft an exceptional Medicare-compliant clinical narrative by:
   a) Establishing opening context (patient presentation, reason for visit)
   b) Presenting focused assessment findings organized by system or problem
   c) Demonstrating clinical reasoning connecting findings to diagnoses
   d) Documenting all interventions performed with clinical rationale
   e) Concluding with clear care plan aligned to identified needs
   
   CRITICAL REQUIREMENTS:
   - Eliminate rough phrasing and replace with professional clinical language
   - DO NOT include meta-commentary, recommendations, or procedural statements
   - Remove phrases like "Further assessment", "Additional documentation", "It is recommended"
   - Apply ALL quality improvements directly - the note must be pristine upon delivery
   - Do NOT flag or include missing vital signs in narrative
   - Create a narrative that reads as high-quality professional documentation
   - Ensure Medicare readiness with specific, documentable clinical details
   
3. COMPLIANCE CHECK: Identify any remaining compliance gaps with specific, actionable fixes
   - Only include actual regulatory/Medicare violations
   - Provide SPECIFIC remediation text for each issue
   - Map to relevant Medicare Conditions of Participation or billing guidance
   
4. QUALITY ANALYSIS: Rate the enhanced narrative across three dimensions
   - Overall quality score: Reflects professional presentation and clinical completeness
   - Clarity score: Readability and logical flow of the narrative
   - Completeness score: Comprehensiveness of assessment, findings, and plan
   - Strengths: Specific excellent elements of the documentation
   - Suggestions: Only include critical improvements not already applied to the narrative
   
5. SUGGESTED EDUCATION MATERIALS: Based on diagnosis and clinical findings
   - title: Patient-appropriate education topic
   - reason: Specific clinical justification from the note
   - category: Education domain

6. INTELLIGENT TASK PRIORITIZATION: Analyze clinical context to assign evidence-based priorities
   - urgent: Immediate safety/clinical concerns requiring same-day action
   - high: Significant clinical changes needing 24-48 hour response
   - medium: Routine coordination and follow-up within one week
   - low: Documentation or supply matters without time urgency
   
   Include clear clinical_indicators explaining the priority decision.

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
                    suggestion: { type: "string", description: "Specific, actionable guidance on what to add or change to fix this issue" },
                    specific_fix: { type: "string", description: "Specific wording or example of what should be documented" },
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

    // The enhanced narrative should be pristine - apply any remaining improvements
    let finalNarrative = result.enhanced_note;
    const appliedImprovements = [];

    if (result.quality_analysis?.suggestions && Array.isArray(result.quality_analysis.suggestions)) {
      for (const suggestion of result.quality_analysis.suggestions) {
        if (suggestion.excerpt && suggestion.improved_text && finalNarrative.includes(suggestion.excerpt)) {
          finalNarrative = finalNarrative.replace(suggestion.excerpt, suggestion.improved_text);
          appliedImprovements.push(suggestion.category);
        }
      }
    }

    // Polish for compliance - ensure no ambiguities
    finalNarrative = polishForCompliance(finalNarrative, provider_type);

    console.log(`✅ Applied ${appliedImprovements.length} improvements to create compliant narrative`);

    return Response.json({
      success: true,
      data: {
        ...result,
        enhanced_note: finalNarrative,
        quality_analysis: {
          ...result.quality_analysis,
          suggestions: appliedImprovements.length > 0 
            ? [{ note: `Applied ${appliedImprovements.length} quality refinements to create pristine narrative` }]
            : []
        }
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