import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  let user;
  try {
    const base44 = createClientFromRequest(req);
    user = await base44.auth.me();

    if (!user) {
      console.error('[validateMedicalCodes] Unauthorized access attempt');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only physicians and NPs can validate codes
    if (user.credential_type !== 'MD' && user.credential_type !== 'NP') {
      console.warn('[validateMedicalCodes] Access denied for credential type:', user.credential_type);
      return Response.json({ 
        error: 'Only physicians and nurse practitioners can use code validation' 
      }, { status: 403 });
    }

    const body = await req.json();
    const { 
      icd10_codes,
      cpt_codes,
      hcpcs_codes,
      modifiers,
      patient_context,
      clinical_note
    } = body;

    if (!icd10_codes || !cpt_codes) {
      console.error('[validateMedicalCodes] Missing required fields');
      return Response.json({ 
        error: 'ICD-10 and CPT codes are required for validation' 
      }, { status: 400 });
    }

    console.log('[validateMedicalCodes] Starting code validation');

    const validationPrompt = `You are an expert medical coding compliance auditor specializing in NCCI edits, modifier usage, and diagnosis-procedure relationships.

CODES TO VALIDATE:
ICD-10 Diagnosis Codes: ${icd10_codes.map(c => `${c.code} - ${c.description}`).join(', ')}
CPT Procedure Codes: ${cpt_codes.map(c => `${c.code} - ${c.description}`).join(', ')}
${hcpcs_codes ? `HCPCS Codes: ${hcpcs_codes.map(c => `${c.code} - ${c.description}`).join(', ')}` : ''}
${modifiers ? `Applied Modifiers: ${modifiers.join(', ')}` : ''}

${patient_context ? `PATIENT CONTEXT:
- Age: ${patient_context.age || 'Unknown'}
- Gender: ${patient_context.gender || 'Unknown'}
- Insurance: ${patient_context.payor || 'Unknown'}
` : ''}

${clinical_note ? `CLINICAL DOCUMENTATION:
${clinical_note.substring(0, 500)}...` : ''}

Perform comprehensive validation checking for:

1. **NCCI EDITS (National Correct Coding Initiative)**:
   - Identify code pairs that are NCCI edits (Column 1/Column 2 relationships)
   - Flag bundling violations where codes cannot be billed together
   - Identify mutually exclusive procedures
   - Specify if modifier 59 or XU/XE/XP/XS would allow separate billing

2. **MODIFIER VALIDATION**:
   - Check if modifiers are appropriate for the codes
   - Identify missing required modifiers (e.g., 25 for E/M with procedure, RT/LT for bilateral procedures)
   - Flag inappropriate modifier usage
   - Verify modifier combinations that are not allowed
   - Check for modifiers that require specific documentation

3. **DIAGNOSIS-PROCEDURE MISMATCH**:
   - Verify medical necessity - do diagnoses support the procedures?
   - Flag procedures that are not typically associated with the diagnoses
   - Identify missing diagnoses needed to support procedures
   - Check for age/gender appropriateness

4. **CODE SPECIFICITY & ACCURACY**:
   - Identify codes that could be more specific
   - Flag outdated or invalid codes
   - Check for laterality requirements (RT/LT)
   - Verify code sequencing (primary vs secondary)

5. **COMPLIANCE & BILLING RULES**:
   - Medicare LCD/NCD coverage concerns
   - Frequency limitations
   - Time-based code requirements
   - Global period conflicts
   - Medical necessity documentation requirements

For each issue found, provide:
- Issue type and severity (critical/high/medium/low)
- Specific codes involved
- Clear, detailed explanation of WHY this is an issue
- Step-by-step actionable recommendation to fix
- Specific documentation requirements needed with examples
- Real-world example of correct usage
- Reference links to CMS, NCCI, or payer guidelines
- Financial impact estimate (claim denial risk, potential revenue loss)
- Payer-specific considerations

IMPORTANT: Be extremely detailed and educational. Assume the user needs to understand not just WHAT is wrong, but WHY and HOW to fix it with concrete examples.`;

    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
    
    if (!anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4096,
        messages: [{ role: 'user', content: validationPrompt }],
        tools: [{
          name: 'generate_structured_response',
          description: 'Generate a structured JSON response',
          input_schema: {
            type: "object",
            properties: {
              validation_status: {
                type: "string",
                enum: ["passed", "passed_with_warnings", "failed"],
                description: "Overall validation result"
              },
              overall_risk_score: {
                type: "number",
                description: "Risk score 0-100, higher = more issues"
              },
              ncci_violations: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
                    code_pair: { type: "string", description: "e.g., '99213 + 12001'" },
                    violation_type: { type: "string", description: "e.g., 'Column 1/Column 2 edit', 'Mutually exclusive'" },
                    explanation: { type: "string", description: "Detailed explanation of the NCCI issue" },
                    why_this_matters: { type: "string", description: "Financial and compliance impact" },
                    recommendation: { type: "string", description: "Step-by-step fix instructions" },
                    correct_example: { type: "string", description: "Example of proper coding for this scenario" },
                    modifier_override: { type: "string", description: "e.g., 'Use modifier 59'" },
                    documentation_needed: { type: "string", description: "What documentation supports the modifier" },
                    reference_link: { type: "string", description: "CMS NCCI manual chapter or page reference" },
                    payer_impact: { type: "string" },
                    financial_impact: { type: "string", description: "e.g., 'Risk of full claim denial - potential $X loss'" }
                  }
                }
              },
              modifier_issues: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
                    code: { type: "string" },
                    issue_type: { type: "string", enum: ["missing_required", "inappropriate", "invalid_combination", "needs_documentation"] },
                    current_modifier: { type: "string" },
                    explanation: { type: "string", description: "Detailed explanation of modifier issue" },
                    why_this_matters: { type: "string", description: "Impact on claim processing" },
                    recommended_modifier: { type: "string" },
                    correct_usage_example: { type: "string", description: "Example scenario showing proper modifier use" },
                    documentation_requirement: { type: "string", description: "Specific documentation needed" },
                    documentation_example: { type: "string", description: "Example of acceptable documentation" },
                    reference_link: { type: "string", description: "CMS or payer guideline reference" },
                    financial_impact: { type: "string" }
                  }
                }
              },
              diagnosis_procedure_mismatches: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
                    procedure_code: { type: "string" },
                    diagnosis_codes: { type: "array", items: { type: "string" } },
                    mismatch_type: { type: "string", enum: ["not_medically_necessary", "missing_diagnosis", "age_inappropriate", "gender_inappropriate", "weak_support"] },
                    explanation: { type: "string", description: "Why diagnosis doesn't support procedure" },
                    medical_necessity_criteria: { type: "string", description: "What criteria need to be met" },
                    recommendation: { type: "string", description: "How to establish medical necessity" },
                    correct_diagnosis_example: { type: "string", description: "Example of supporting diagnosis" },
                    additional_diagnosis_needed: { type: "array", items: { type: "string" } },
                    lcd_ncd_reference: { type: "string", description: "Relevant LCD/NCD policy number" },
                    payer_policy_link: { type: "string", description: "Link to payer coverage policy" },
                    financial_impact: { type: "string" }
                  }
                }
              },
              code_specificity_issues: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
                    code: { type: "string" },
                    issue: { type: "string" },
                    more_specific_code: { type: "string" },
                    explanation: { type: "string" }
                  }
                }
              },
              compliance_warnings: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
                    category: { type: "string" },
                    warning: { type: "string" },
                    detailed_explanation: { type: "string", description: "Comprehensive explanation of the compliance issue" },
                    codes_affected: { type: "array", items: { type: "string" } },
                    recommendation: { type: "string" },
                    compliance_steps: { type: "array", items: { type: "string" }, description: "Step-by-step compliance actions" },
                    reference_link: { type: "string", description: "CMS or regulatory reference" },
                    payer_specific: { type: "string" },
                    financial_impact: { type: "string" }
                  }
                }
              },
              recommended_fixes: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    priority: { type: "number", description: "1=highest" },
                    action: { type: "string" },
                    reason: { type: "string" },
                    impact: { type: "string" }
                  }
                }
              },
              summary: {
                type: "object",
                properties: {
                  total_issues: { type: "number" },
                  critical_issues: { type: "number" },
                  high_issues: { type: "number" },
                  passes_basic_compliance: { type: "boolean" },
                  estimated_denial_risk: { type: "string", enum: ["very_high", "high", "moderate", "low", "very_low"] },
                  key_actions: { type: "array", items: { type: "string" } }
                }
              }
            }
          }
        }],
        tool_choice: {
          type: 'tool',
          name: 'generate_structured_response'
        }
      })
    });

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text();
      console.error('[validateMedicalCodes] Claude API error:', errorText);
      throw new Error(`Claude API failed: ${claudeResponse.status}`);
    }

    const claudeResult = await claudeResponse.json();
    const validationResult = claudeResult.content?.[0]?.type === 'tool_use' 
      ? claudeResult.content[0].input 
      : {};

    console.log('[validateMedicalCodes] Validation completed successfully');

    return Response.json({
      success: true,
      validation: validationResult,
      validated_at: new Date().toISOString(),
      validated_by: user.email
    });

  } catch (error) {
    console.error('[validateMedicalCodes] Error:', {
      message: error.message,
      stack: error.stack,
      userEmail: user?.email
    });
    return Response.json({ 
      error: 'Failed to validate medical codes',
      details: error.message
    }, { status: 500 });
  }
});