import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { 
      file_urls = [],
      file_names = [],
      provider_type = 'RN',
      care_setting = 'home_health'
    } = await req.json();

    if (!file_urls || file_urls.length < 2) {
      return Response.json({ 
        error: 'At least 2 documents required for cross-reference analysis' 
      }, { status: 400 });
    }

    const prompt = buildMultiDocAnalysisPrompt(file_names, provider_type, care_setting);

    const analysis = await base44.integrations.Core.InvokeLLM({
      prompt,
      file_urls,
      response_json_schema: {
        type: "object",
        properties: {
          consolidated_summary: {
            type: "string",
            description: "Executive summary integrating findings from all documents"
          },
          key_findings_by_document: {
            type: "array",
            items: {
              type: "object",
              properties: {
                document_name: { type: "string" },
                findings: {
                  type: "array",
                  items: { type: "string" }
                }
              }
            }
          },
          cross_document_analysis: {
            type: "object",
            properties: {
              consistencies: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    finding: { type: "string" },
                    documents_supporting: {
                      type: "array",
                      items: { type: "string" }
                    },
                    confidence: { type: "string", enum: ["high", "medium", "low"] }
                  }
                },
                description: "Information consistent across documents"
              },
              discrepancies: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    finding: { type: "string" },
                    document_1: { type: "string" },
                    value_or_statement_1: { type: "string" },
                    document_2: { type: "string" },
                    value_or_statement_2: { type: "string" },
                    clinical_significance: { type: "string" },
                    recommended_action: { type: "string" }
                  }
                },
                description: "Conflicting or contradictory information"
              },
              correlations: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    correlation: { type: "string" },
                    documents_involved: {
                      type: "array",
                      items: { type: "string" }
                    },
                    clinical_implication: { type: "string" }
                  }
                },
                description: "Relationships and patterns across documents"
              }
            }
          },
          investigation_areas: {
            type: "array",
            items: {
              type: "object",
              properties: {
                question: { type: "string" },
                priority: { type: "string", enum: ["critical", "high", "medium", "low"] },
                documents_referenced: {
                  type: "array",
                  items: { type: "string" }
                },
                suggested_investigation_method: { type: "string" },
                clinical_rationale: { type: "string" }
              }
            },
            description: "Follow-up questions and areas requiring further investigation"
          },
          timeline_reconstruction: {
            type: "array",
            items: {
              type: "object",
              properties: {
                date: { type: "string" },
                event: { type: "string" },
                source_documents: {
                  type: "array",
                  items: { type: "string" }
                }
              }
            },
            description: "Chronological reconstruction of events from all documents"
          },
          gaps_in_documentation: {
            type: "array",
            items: { type: "string" },
            description: "Missing information or unexplained gaps"
          }
        }
      }
    });

    return Response.json({
      success: true,
      multi_document_analysis: analysis,
      document_count: file_urls.length,
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Multi-document analysis error:', error);
    return Response.json({ 
      error: error.message,
      success: false
    }, { status: 500 });
  }
});

function buildMultiDocAnalysisPrompt(fileNames, providerType, careSetting) {
  return `You are an expert clinical document analyzer for a ${providerType} in a ${careSetting.replace(/_/g, ' ')} setting.

You have been provided with ${fileNames.length} clinical documents:
${fileNames.map((name, i) => `${i + 1}. ${name}`).join('\n')}

Your task is to perform a comprehensive cross-document analysis:

1. CONSOLIDATED SUMMARY
   - Create an integrated summary that brings together information from all documents
   - Highlight the overall clinical picture and trajectory

2. KEY FINDINGS BY DOCUMENT
   - List the most important findings from each individual document
   - Note the source document clearly

3. CROSS-DOCUMENT ANALYSIS
   - CONSISTENCIES: Information that is confirmed across multiple documents
   - DISCREPANCIES: Conflicting or contradictory information requiring clarification
   - CORRELATIONS: Patterns and relationships between findings in different documents

4. INVESTIGATION AREAS
   - Identify gaps in the clinical picture
   - Generate specific follow-up questions based on the documents
   - Suggest what additional information would be valuable
   - Prioritize based on clinical importance

5. TIMELINE RECONSTRUCTION
   - Build a chronological narrative of clinical events
   - Cross-reference dates and events across documents
   - Identify any temporal gaps

6. DOCUMENTATION GAPS
   - Note missing critical information
   - Identify unexplained findings or inconsistencies
   - Flag areas where additional documentation is needed

Be thorough, clinically sound, and specific in your analysis. For any discrepancies or concerns, provide clinical context and recommended next steps.`;
}