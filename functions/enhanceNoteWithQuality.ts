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
      patient_id
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