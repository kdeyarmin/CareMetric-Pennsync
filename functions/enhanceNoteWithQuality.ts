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

    // Build the comprehensive prompt with enhanced patient context
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

    // Enhanced patient context section
    const patientContextSection = patient_context ? `

    ═══════════════════════════════════════
    PATIENT CONTEXT & HISTORICAL DATA
    ═══════════════════════════════════════

    Patient: ${patient_context.patient_name}
    Primary Diagnosis: ${patient_context.primary_diagnosis || 'Not specified'}
    ${patient_context.secondary_diagnoses?.length > 0 ? `Secondary Diagnoses: ${patient_context.secondary_diagnoses.join(', ')}\n` : ''}${patient_context.allergies ? `Allergies: ${patient_context.allergies}\n` : ''}${patient_context.current_medications?.length > 0 ? `
    Current Medications:
    ${patient_context.current_medications.map(m => `  • ${m.name} ${m.dosage || ''}`).join('\n')}
    ` : ''}
    ${patient_context.recent_notes?.length > 0 ? `RECENT VISIT HISTORY (Use to understand patient trajectory and ensure continuity):
    ${patient_context.recent_notes.map((note, i) => `
    Visit ${i + 1}: ${new Date(note.date).toLocaleDateString()}
    Type: ${note.visit_type}
    Diagnosis: ${note.diagnosis}
    Excerpt: ${note.note_excerpt}...
    `).join('\n')}
    IMPORTANT: Reference relevant trends, changes from previous visits, and progression in your note.
    ` : ''}
    ${patient_context.active_care_plans?.length > 0 ? `ACTIVE CARE PLAN GOALS (Ensure note addresses progress toward these goals):
    ${patient_context.active_care_plans.map((cp, i) => `
    ${i + 1}. Problem: ${cp.problem}
    Goal: ${cp.goal}
    Status: ${cp.status}
    `).join('\n')}
    CRITICAL: Document patient's progress toward these specific goals.
    ` : ''}
    ═══════════════════════════════════════
    ` : '';

    // Import provider-specific context
     let providerContext = '';
     let locationContext = '';
     try {
       const { getProviderSpecificPromptAdditions, getCareLocationPromptAdditions } = await import('../components/utils/providerSpecificPrompts.js');
       providerContext = getProviderSpecificPromptAdditions(provider_type) || '';
       locationContext = getCareLocationPromptAdditions(user?.service_type || 'home_health') || '';
     } catch (importError) {
       console.warn('Could not import provider-specific context:', importError.message);
     }

    // Determine care scope (home health vs hospice) for specialized compliance
    const careScope = user?.service_type || 'home_health';
    const isHospice = careScope === 'hospice';
    const isHomeHealth = careScope === 'home_health';

    // Build scope-specific regulatory requirements
    const scopeRequirements = isHospice ? `
╔═══════════════════════════════════════════════════════════════
║ HOSPICE-SPECIFIC REGULATORY REQUIREMENTS (Medicare CoPs)
╚═══════════════════════════════════════════════════════════════

MANDATORY HOSPICE DOCUMENTATION ELEMENTS:
1. ✓ Terminal Prognosis Documentation (≤6 months life expectancy)
   - Objective clinical findings supporting terminal diagnosis
   - Disease progression indicators
   - Functional decline evidence

2. ✓ Comfort-Focused Care Documentation
   - Pain/symptom assessment using standardized scales
   - Comfort measures provided and patient response
   - Quality of life considerations

3. ✓ Spiritual/Psychosocial Needs Assessment
   - Emotional/spiritual distress screening
   - Family/caregiver coping assessment
   - Bereavement risk identification

4. ✓ Interdisciplinary Care Coordination
   - Team communication documented
   - IDG plan alignment
   - Chaplain/social work involvement when appropriate

5. ✓ Patient/Family Goals of Care
   - Patient wishes and preferences documented
   - Advance directive status
   - Code status confirmation

HOSPICE COMPLIANCE RED FLAGS TO AVOID:
- Curative treatment language (use palliative/comfort language)
- Aggressive life-prolonging interventions without justification
- Missing pain/symptom scores
- Vague prognosis documentation
- Missing spiritual/psychosocial assessment
` : `
╔═══════════════════════════════════════════════════════════════
║ HOME HEALTH-SPECIFIC REGULATORY REQUIREMENTS (Medicare CoPs)
╚═══════════════════════════════════════════════════════════════

MANDATORY HOME HEALTH DOCUMENTATION ELEMENTS:
1. ✓ Homebound Status (§484.55)
   - Specific mobility limitations (walker, wheelchair, maximum exertion)
   - Why leaving home is taxing effort requiring assistance
   - Medical contraindications to leaving home
   - Frequency and duration of absences (medical appointments only)

2. ✓ Skilled Nursing Need (§484.4)
   - Complex assessment requiring RN/LPN clinical judgment
   - Teaching requiring skilled professional
   - Management/evaluation of patient care plan
   - Unstable condition requiring observation

3. ✓ Patient Response & Teaching Effectiveness (§484.60)
   - Verbal comprehension demonstrated ("Patient verbalized understanding...")
   - Return demonstration completed successfully
   - Barriers to learning addressed
   - Teach-back method results

4. ✓ Safety Assessment (§484.50)
   - Fall risk score and environmental hazards identified
   - Caregiver competency evaluated
   - Emergency procedures reviewed
   - DME safety assessed

5. ✓ Functional Status Documentation (OASIS M1800-M1890)
   - ADL performance levels (grooming, bathing, toileting, etc.)
   - IADL abilities (meal prep, housekeeping, medication management)
   - Assistance level required for each activity

6. ✓ Coordination of Care (§484.50)
   - Physician orders followed/verified
   - Next physician contact planned
   - Community resources coordinated
   - Medication reconciliation completed

HOME HEALTH COMPLIANCE RED FLAGS TO AVOID:
- Vague homebound documentation ("patient doesn't go out much")
- Unskilled custodial care only ("monitored patient")
- Missing teach-back confirmation
- No documented patient response or progress
- Incomplete safety assessment
- Missing functional baseline or changes
`;

    const enhancementPrompt = `You are an elite ${careScope.toUpperCase()} documentation specialist with deep expertise in Medicare regulatory compliance and clinical excellence. Your task is to craft the highest quality Medicare-compliant clinical narrative.

═══════════════════════════════════════════════════════════════
CLINICAL CONTEXT
═══════════════════════════════════════════════════════════════
CARE SCOPE: ${careScope.toUpperCase()} ${isHospice ? '(Palliative/Comfort Care Focus)' : '(Restorative/Skilled Care Focus)'}
VISIT TYPE: ${visit_type}
PRIMARY DIAGNOSIS: ${diagnosis}
PROVIDER TYPE: ${provider_type}

${scopeRequirements}

${providerContext}

${locationContext}

${compliance_prompt}${customRulesText}${userRulesText}

${vital_signs && Object.values(vital_signs).some(v => v) ? `VITAL SIGNS:
${vital_signs.temperature ? `Temperature: ${vital_signs.temperature}°F\n` : ''}${vital_signs.heart_rate ? `Heart Rate: ${vital_signs.heart_rate} bpm\n` : ''}${vital_signs.respiratory_rate ? `Respiratory Rate: ${vital_signs.respiratory_rate}\n` : ''}${vital_signs.bp_systolic && vital_signs.bp_diastolic ? `Blood Pressure: ${vital_signs.bp_systolic}/${vital_signs.bp_diastolic}\n` : ''}${vital_signs.oxygen_saturation ? `O2 Saturation: ${vital_signs.oxygen_saturation}%\n` : ''}
` : ''}${patientContextSection}
${ai_preferences ? `AI DOCUMENTATION PREFERENCES:
- Verbosity: ${ai_preferences.verbosity_level || 'balanced'} (concise/balanced/detailed)
- Compliance Focus: ${ai_preferences.compliance_priority || 'medicare'}
- Note Structure: ${ai_preferences.preferred_note_structure || 'narrative'} format
- Quality Suggestions: ${ai_preferences.suggestion_aggressiveness || 'moderate'} level
${ai_preferences.include_education_tips ? '- Include patient education tips in the note\n' : ''}
` : ''}
ROUGH CLINICAL NOTES:
${rough_notes}

═══════════════════════════════════════════════════════════════
CLINICAL EXCELLENCE CRITERIA FOR ${careScope.toUpperCase()} NARRATIVE
═══════════════════════════════════════════════════════════════

STRUCTURE & FLOW:
✓ Create cohesive, flowing narrative demonstrating comprehensive assessment
✓ Establish clear clinical reasoning with evidence-based decision-making
✓ Chronological and logical flow: Assessment → Findings → Interventions → Plan
✓ Use precise medical terminology while maintaining Medicare audit clarity

CLINICAL CONTENT REQUIREMENTS:
✓ Document skilled ${provider_type} clinical judgment and assessment expertise
✓ Show patient trajectory by referencing previous visit findings when available
✓ Link all interventions to identified clinical needs and care plan goals
✓ Ensure assessments directly support primary and secondary diagnoses
✓ Include objective measurable findings (not just subjective statements)

${isHospice ? `
HOSPICE-SPECIFIC DOCUMENTATION REQUIREMENTS:
✓ Frame all care in comfort/palliative context (avoid curative language)
✓ Document terminal disease progression with objective findings
✓ Include pain/symptom scores and response to interventions
✓ Address spiritual/emotional/psychosocial dimensions
✓ Document patient/family understanding of hospice philosophy
✓ Confirm goals of care alignment and advance directive status
` : `
HOME HEALTH-SPECIFIC DOCUMENTATION REQUIREMENTS:
✓ Explicitly document homebound status with specific mobility limitations
✓ Clearly articulate skilled nursing need (complex assessment, teaching, observation)
✓ Include teach-back confirmation and patient demonstration of learning
✓ Document functional status changes (ADL/IADL performance levels)
✓ Address safety risks and environmental assessment
✓ Show progress toward restorative/rehabilitative goals
`}

COMPLIANCE SAFEGUARDS:
✓ Eliminate all vague language ("seems", "appears to be", "may have")
✓ Replace with specific, documentable clinical observations
✓ Remove meta-commentary, procedural statements, or recommendations
✓ Apply ALL quality improvements directly - pristine on delivery
✓ Ensure every statement is audit-defensible with clinical evidence

═══════════════════════════════════════════════════════════════
YOUR TASK - COMPREHENSIVE ${careScope.toUpperCase()} CLINICAL DOCUMENTATION
═══════════════════════════════════════════════════════════════

Please provide a comprehensive response that includes:

1. EXTRACTED DATA: Parse and extract structured clinical data from the notes
   - All diagnoses mentioned
   - All medications referenced
   - All symptoms and findings
   - Vital signs and objective measurements

2. ENHANCED NARRATIVE NOTE: Craft an exceptional Medicare-compliant ${careScope.toUpperCase()} narrative by:
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
   
3. REGULATORY COMPLIANCE CHECK: Comprehensive ${careScope.toUpperCase()} compliance audit
   
   ${isHospice ? `
   HOSPICE MEDICARE CoPs VERIFICATION:
   ✓ Terminal prognosis documented with clinical evidence (§418.22)
   ✓ Comfort care focus clearly established (§418.54)
   ✓ Pain/symptom assessment with scores (§418.56)
   ✓ Spiritual/psychosocial needs addressed (§418.64)
   ✓ IDG coordination documented (§418.56)
   ✓ Patient/family goals confirmed (§418.22)
   ✓ Bereavement assessment conducted (§418.78)
   ` : `
   HOME HEALTH MEDICARE CoPs VERIFICATION:
   ✓ Homebound status explicitly documented (§409.42)
   ✓ Skilled nursing need clearly justified (§409.32)
   ✓ Patient teaching with comprehension verified (§484.60)
   ✓ Safety assessment completed (§484.50)
   ✓ Functional status baseline established (§484.55)
   ✓ Physician communication/orders documented (§484.60)
   `}
   
   CLINICAL KNOWLEDGE VALIDATION:
   ✓ Diagnosis-appropriate assessments included
   ✓ Evidence-based interventions documented
   ✓ Drug interactions or contraindications flagged
   ✓ Clinical reasoning supports medical necessity
   ✓ Vital signs interpreted in clinical context
   
   STRUCTURAL INTEGRITY:
   ✓ All required sections present for ${visit_type} visit
   ✓ Logical flow maintained throughout narrative
   ✓ Professional medical terminology used correctly
   ✓ No contradictory statements
   ✓ Objective + Subjective data balanced appropriately
   
   For each violation/gap found:
   - Provide SPECIFIC remediation text
   - Reference exact Medicare CoP or billing requirement
   - Rate severity (critical/high/medium/low)
   - Give example of compliant documentation
   
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
             compliance_score: { 
               type: "number",
               description: "Overall Medicare compliance score 0-100"
             },
             status: { 
               type: "string",
               enum: ["compliant", "needs_review", "non_compliant"]
             },
             regulatory_framework_applied: {
               type: "string",
               description: "Which regulatory framework was used (home_health_cops or hospice_cops)"
             },
             issues: { 
               type: "array",
               items: {
                 type: "object",
                 properties: {
                   element: { type: "string" },
                   problem: { type: "string" },
                   suggestion: { type: "string", description: "Specific, actionable guidance" },
                   specific_fix: { type: "string", description: "Exact wording to add" },
                   severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
                   regulatory_reference: { type: "string", description: "Specific Medicare CoP section" }
                 }
               }
             },
             compliant_elements: { 
               type: "array", 
               items: { type: "string" },
               description: "Elements that meet regulatory standards"
             },
             medicare_violations: {
               type: "array",
               description: "Specific Medicare CoP violations found",
               items: {
                 type: "object",
                 properties: {
                   violation: { type: "string" },
                   severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
                   cop_reference: { type: "string", description: "42 CFR section reference" },
                   remediation: { type: "string", description: "Specific fix with example text" },
                   clinical_impact: { type: "string", description: "Why this matters clinically" },
                   audit_risk: { type: "string", enum: ["high", "medium", "low"] }
                 }
               }
             },
             regulatory_warnings: { 
               type: "array", 
               items: { type: "string" },
               description: "Potential audit triggers or concerns"
             },
             clinical_knowledge_validation: {
               type: "object",
               properties: {
                 diagnosis_assessment_alignment: { 
                   type: "boolean",
                   description: "Do documented assessments match the diagnosis requirements?"
                 },
                 evidence_based_interventions: {
                   type: "boolean",
                   description: "Are interventions clinically appropriate?"
                 },
                 contraindications_flagged: {
                   type: "array",
                   items: { type: "string" },
                   description: "Any drug interactions or clinical contraindications found"
                 },
                 clinical_reasoning_quality: {
                   type: "string",
                   enum: ["excellent", "good", "adequate", "poor"]
                 },
                 knowledge_gaps: {
                   type: "array",
                   items: { type: "string" },
                   description: "Areas where clinical knowledge appears incomplete"
                 }
               }
             },
             structural_integrity: {
               type: "object",
               properties: {
                 has_assessment: { type: "boolean" },
                 has_interventions: { type: "boolean" },
                 has_patient_response: { type: "boolean" },
                 has_plan: { type: "boolean" },
                 logical_flow: { type: "boolean" },
                 contradictions_found: {
                   type: "array",
                   items: { type: "string" }
                 },
                 missing_sections: {
                   type: "array",
                   items: { type: "string" }
                 }
               }
             }
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
    console.error('[enhanceNoteWithQuality] Error:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    return Response.json({ 
      success: false,
      error: 'Failed to enhance note',
      details: error.message 
    }, { status: 500 });
  }
});

function polishForCompliance(narrative, providerType) {
  // Final compliance polish to ensure Medicare-ready documentation
  
  // Remove any lingering vague language
  let polished = narrative
    .replace(/\b(seems|appears|may|might|possibly|arguably)\b/gi, 'is') // Replace uncertain language with definitive
    .replace(/patient denies/gi, 'Patient denies') // Standardize capitalization
    .replace(/\s{2,}/g, ' '); // Remove extra spaces
  
  // Ensure assessment statements are specific to patient presentation
  polished = polished.replace(/patient (is|presents|reports) with/gi, 'Patient presents with');
  
  // Strengthen clinical language for skilled assessment
  polished = polished.replace(/slight/gi, 'mild');
  polished = polished.replace(/somewhat/gi, ''); // Remove hedging
  
  // Ensure plan statements are action-oriented
  polished = polished.replace(/plan is to/gi, 'Plan:');
  polished = polished.replace(/will continue/gi, 'Continue');
  
  // Final trim and return
  return polished.trim();
}