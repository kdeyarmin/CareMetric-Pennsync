import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { file_url } = await req.json();

    if (!file_url) {
      return Response.json({ error: 'file_url is required' }, { status: 400 });
    }

    // Step 1: Extract COMPLETE text from PDF using OCR
    const extractedText = await base44.integrations.Core.ExtractDataFromUploadedFile({
      file_url: file_url,
      json_schema: {
        type: "object",
        properties: {
          full_document_text: {
            type: "string",
            description: "Extract EVERY SINGLE WORD, number, checkbox, narrative note, and M-item from the entire OASIS document. Include: patient demographics, ALL M-items (M0000-M2400) with their answers, ALL narrative sections (clinical notes, justifications, explanations), assessment dates, signatures, and any written text anywhere on the form. Preserve formatting and structure as much as possible."
          },
          all_m_items: {
            type: "array",
            description: "List every M-item code found (M0080, M1021, M1860, etc) with its response value",
            items: {
              type: "object",
              properties: {
                code: { type: "string", description: "M-item code like M1021" },
                question: { type: "string", description: "The question text" },
                response: { type: "string", description: "The response/answer given" }
              }
            }
          },
          all_narratives: {
            type: "array",
            description: "Extract ALL narrative text boxes, clinical notes, justification sections, and written explanations from the document",
            items: {
              type: "object",
              properties: {
                section: { type: "string", description: "Which section this narrative is from" },
                text: { type: "string", description: "The full narrative text" }
              }
            }
          }
        }
      }
    });

    if (extractedText.status === "error") {
      return Response.json({ 
        error: 'Failed to extract text from PDF',
        details: extractedText.details 
      }, { status: 400 });
    }

    const documentData = extractedText.output;

    // Step 2: AI Analysis to match narratives with questions
    const matchAnalysis = await base44.integrations.Core.InvokeLLM({
      model: "claude_opus_4_8",
      prompt: `You are an expert OASIS auditor. Analyze this OASIS document for consistency between coded responses and narrative documentation.

FULL DOCUMENT CONTENT:
${documentData.full_document_text?.substring(0, 20000) || ''}

EXTRACTED M-ITEMS:
${JSON.stringify(documentData.all_m_items || [], null, 2)}

EXTRACTED NARRATIVES:
${JSON.stringify(documentData.all_narratives || [], null, 2)}

CRITICAL TASK: Identify EVERY instance where:
1. A coded M-item response conflicts with or is not supported by the narrative documentation
2. A narrative describes a condition/situation that should have triggered a higher M-item score
3. Required narrative justification is missing for certain M-item responses
4. Narrative contradicts itself or contains inconsistent information
5. Clinical observations in the narrative don't align with functional scores

For EACH mismatch found:
- Specify the EXACT M-item code
- Quote the EXACT response given
- Quote the EXACT narrative text that conflicts
- Explain WHY it's a mismatch
- Provide the CORRECT response based on the narrative
- Estimate the compliance/revenue impact

Return JSON with detailed findings:`,
      response_json_schema: {
        type: "object",
        properties: {
          overall_consistency_score: {
            type: "number",
            description: "0-100 score for how well narratives match coded responses"
          },
          total_mismatches_found: { type: "number" },
          critical_mismatches: { type: "number" },
          mismatches: {
            type: "array",
            items: {
              type: "object",
              properties: {
                m_item_code: { type: "string" },
                m_item_question: { type: "string" },
                coded_response: { type: "string" },
                narrative_quote: { type: "string" },
                issue_type: {
                  type: "string",
                  enum: ["underscore", "overscore", "missing_justification", "contradiction", "incomplete_documentation"]
                },
                severity: {
                  type: "string",
                  enum: ["critical", "high", "medium", "low"]
                },
                explanation: { type: "string" },
                correct_response_should_be: { type: "string" },
                revenue_impact: { type: "string" },
                compliance_risk: { type: "string" },
                recommended_fix: { type: "string" },
                exact_narrative_needed: { type: "string" }
              }
            }
          },
          missing_narratives: {
            type: "array",
            description: "M-items that require narrative justification but don't have it",
            items: {
              type: "object",
              properties: {
                m_item_code: { type: "string" },
                response_given: { type: "string" },
                why_narrative_required: { type: "string" },
                example_narrative: { type: "string" }
              }
            }
          },
          strengths: {
            type: "array",
            items: { type: "string" },
            description: "Areas where narratives excellently support the coded responses"
          },
          recommendations: {
            type: "array",
            items: { type: "string" }
          }
        }
      }
    });

    // Step 3: Generate comprehensive analysis report
    const report = {
      extraction_summary: {
        total_m_items_found: documentData.all_m_items?.length || 0,
        total_narratives_found: documentData.all_narratives?.length || 0,
        full_text_length: documentData.full_document_text?.length || 0
      },
      consistency_analysis: matchAnalysis,
      raw_data: {
        m_items: documentData.all_m_items || [],
        narratives: documentData.all_narratives || []
      },
      audit_flags: matchAnalysis.mismatches?.filter(m => 
        m.severity === 'critical' || m.severity === 'high'
      ).map(m => ({
        flag_type: 'narrative_mismatch',
        m_item: m.m_item_code,
        description: m.explanation,
        action_required: m.recommended_fix
      })) || []
    };

    return Response.json({
      success: true,
      report
    });

  } catch (error) {
    console.error('OASIS narrative analysis error:', error);
    return Response.json({ 
      error: error.message,
    }, { status: 500 });
  }
});