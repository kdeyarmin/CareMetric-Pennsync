import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { analysis_ids, operation_type, query } = body;

    if (!analysis_ids || !Array.isArray(analysis_ids) || analysis_ids.length === 0) {
      return Response.json({ error: 'No analyses provided' }, { status: 400 });
    }

    console.log(`[advancedDocumentAnalysis] ${operation_type} for ${analysis_ids.length} documents`);

    // Fetch all analyses
    const analyses = await Promise.all(
      analysis_ids.map(id => base44.asServiceRole.entities.DocumentAnalysisHistory.filter({ id }))
    );
    const flattenedAnalyses = analyses.flat();

    if (flattenedAnalyses.length === 0) {
      return Response.json({ error: 'No valid analyses found' }, { status: 404 });
    }

    let result;

    switch (operation_type) {
      case 'multi_document_summary':
        result = await generateMultiDocumentSummary(base44, flattenedAnalyses);
        break;
      
      case 'detect_contradictions':
        result = await detectContradictions(base44, flattenedAnalyses);
        break;
      
      case 'extract_by_query':
        if (!query) {
          return Response.json({ error: 'Query is required for extract_by_query' }, { status: 400 });
        }
        result = await extractDataByQuery(base44, flattenedAnalyses, query);
        break;
      
      default:
        return Response.json({ error: 'Invalid operation_type' }, { status: 400 });
    }

    // Save the advanced analysis
    await base44.asServiceRole.entities.DocumentAnalysisHistory.create({
      provider_email: user.email,
      document_type: 'advanced_analysis',
      file_count: flattenedAnalyses.length,
      file_names: flattenedAnalyses.flatMap(a => a.file_names || []),
      analysis_summary: `Advanced ${operation_type} across ${flattenedAnalyses.length} documents`,
      full_analysis: result,
      extracted_at: new Date().toISOString()
    });

    return Response.json({
      success: true,
      operation_type,
      documents_analyzed: flattenedAnalyses.length,
      result
    });
  } catch (error) {
    console.error('[advancedDocumentAnalysis] Error:', error.message);
    return Response.json({
      error: 'Advanced analysis failed',
      details: error.message
    }, { status: 500 });
  }
});

async function generateMultiDocumentSummary(base44, analyses) {
  const combinedData = analyses.map(a => ({
    date: a.created_date,
    type: a.document_type,
    files: a.file_names,
    analysis: a.full_analysis
  }));

  const prompt = `You are analyzing multiple clinical documents together to create a comprehensive summary.

DOCUMENTS PROVIDED: ${analyses.length}
${JSON.stringify(combinedData, null, 2)}

Create a comprehensive multi-document summary that:
1. Identifies key findings across ALL documents
2. Highlights trends and patterns over time
3. Synthesizes information from different sources
4. Provides an integrated patient picture
5. Notes any significant changes between documents
6. Identifies gaps in documentation

Focus on synthesizing information, not just listing findings from each document.`;

  const result = await base44.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: {
      type: 'object',
      properties: {
        comprehensive_summary: {
          type: 'string',
          description: 'Synthesized summary of all documents'
        },
        key_findings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              finding: { type: 'string' },
              source_documents: { 
                type: 'array',
                items: { type: 'string' }
              },
              significance: {
                type: 'string',
                enum: ['critical', 'important', 'routine']
              },
              category: { type: 'string' }
            }
          }
        },
        trends: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              trend: { type: 'string' },
              direction: {
                type: 'string',
                enum: ['improving', 'worsening', 'stable', 'fluctuating']
              },
              evidence: { type: 'string' }
            }
          }
        },
        timeline: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              date: { type: 'string' },
              event: { type: 'string' },
              significance: { type: 'string' }
            }
          }
        },
        documentation_gaps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              gap: { type: 'string' },
              impact: { type: 'string' },
              recommendation: { type: 'string' }
            }
          }
        },
        integrated_diagnosis_list: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              diagnosis: { type: 'string' },
              icd10_code: { type: 'string' },
              first_mentioned: { type: 'string' },
              status: {
                type: 'string',
                enum: ['active', 'resolved', 'chronic', 'historical']
              }
            }
          }
        },
        integrated_medication_list: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              medication: { type: 'string' },
              dosage: { type: 'string' },
              frequency: { type: 'string' },
              status: {
                type: 'string',
                enum: ['current', 'discontinued', 'changed']
              },
              changes: { type: 'string' }
            }
          }
        }
      }
    }
  });

  return result;
}

async function detectContradictions(base44, analyses) {
  const combinedData = analyses.map(a => ({
    date: a.created_date,
    type: a.document_type,
    files: a.file_names,
    analysis: a.full_analysis
  }));

  const prompt = `You are a clinical quality analyst reviewing multiple documents for a single patient.

DOCUMENTS PROVIDED: ${analyses.length}
${JSON.stringify(combinedData, null, 2)}

Identify potential contradictions, inconsistencies, or conflicts across these documents:

1. DIAGNOSIS CONFLICTS: Different diagnoses mentioned, conflicting information
2. MEDICATION DISCREPANCIES: Different med lists, dosage conflicts, duplicates
3. ALLERGY INCONSISTENCIES: Different allergy information across documents
4. VITAL SIGN ANOMALIES: Unusual changes or conflicts in vitals
5. TREATMENT PLAN CONFLICTS: Contradictory recommendations
6. DOCUMENTATION DISCREPANCIES: Conflicting patient data (DOB, name spelling, etc.)

For each contradiction:
- Clearly state what is conflicting
- Identify which documents contain the conflicting information
- Assess the severity and clinical impact
- Provide recommendations for resolution

Be thorough but focus only on genuine contradictions, not just differences in level of detail.`;

  const result = await base44.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'Overall summary of contradictions found'
        },
        contradictions_found: {
          type: 'number',
          description: 'Total number of contradictions identified'
        },
        contradictions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              category: {
                type: 'string',
                enum: [
                  'diagnosis',
                  'medication',
                  'allergy',
                  'vital_signs',
                  'treatment_plan',
                  'demographics',
                  'other'
                ]
              },
              severity: {
                type: 'string',
                enum: ['critical', 'high', 'medium', 'low']
              },
              description: {
                type: 'string',
                description: 'What is contradicting'
              },
              conflicting_values: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    value: { type: 'string' },
                    source_document: { type: 'string' },
                    date: { type: 'string' }
                  }
                }
              },
              clinical_impact: {
                type: 'string',
                description: 'Potential impact on patient care'
              },
              resolution_recommendation: {
                type: 'string',
                description: 'How to resolve this contradiction'
              },
              requires_provider_review: {
                type: 'boolean'
              }
            }
          }
        },
        consistency_score: {
          type: 'number',
          description: 'Overall consistency score 0-100'
        },
        recommendations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              priority: {
                type: 'string',
                enum: ['urgent', 'high', 'medium', 'low']
              }
            }
          }
        }
      }
    }
  });

  return result;
}

async function extractDataByQuery(base44, analyses, query) {
  const combinedData = analyses.map(a => ({
    date: a.created_date,
    type: a.document_type,
    files: a.file_names,
    analysis: a.full_analysis
  }));

  const prompt = `You are a clinical data extraction specialist. Extract specific information from multiple patient documents based on a user query.

USER QUERY: "${query}"

DOCUMENTS PROVIDED: ${analyses.length}
${JSON.stringify(combinedData, null, 2)}

Extract ALL relevant information from the documents that answers the user's query. Include:
- The specific data points requested
- Which document(s) each data point came from
- Dates when available
- Context around the data

Organize the results clearly and comprehensively.`;

  const result = await base44.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The original user query'
        },
        query_interpretation: {
          type: 'string',
          description: 'How the AI understood the query'
        },
        extracted_data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              data_point: { type: 'string' },
              value: { type: 'string' },
              source_document: { type: 'string' },
              document_date: { type: 'string' },
              context: { type: 'string' },
              confidence: {
                type: 'string',
                enum: ['high', 'medium', 'low']
              }
            }
          }
        },
        summary: {
          type: 'string',
          description: 'Summary of findings related to the query'
        },
        total_matches: {
          type: 'number',
          description: 'Number of relevant data points found'
        },
        documents_searched: {
          type: 'number'
        },
        relevant_documents: {
          type: 'array',
          items: { type: 'string' },
          description: 'Which documents contained relevant information'
        },
        suggestions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              suggestion: { type: 'string' },
              reason: { type: 'string' }
            }
          },
          description: 'Additional insights or related information'
        }
      }
    }
  });

  return result;
}