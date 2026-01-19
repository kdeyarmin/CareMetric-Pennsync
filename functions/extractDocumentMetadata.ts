import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const payload = await req.json();
    const { document_content, max_summary_length = 300 } = payload;

    if (!document_content) {
      return Response.json(
        { error: 'document_content is required' },
        { status: 400 }
      );
    }

    // Use AI to summarize and extract keywords
    const aiResponse = await base44.integrations.Core.InvokeLLM({
      prompt: `You are an expert document analyzer. Extract metadata from the following document content.
      
      Document Content:
      ${document_content}
      
      Please provide your response as JSON with the following structure:
      {
        "summary": "A concise summary of the document (max ${max_summary_length} characters)",
        "keywords": ["keyword1", "keyword2", "keyword3", ...],
        "document_type": "Type of document (e.g., consent form, agreement, medical record)",
        "key_entities": {
          "parties": ["party1", "party2"],
          "dates": ["date1", "date2"],
          "locations": ["location1"]
        },
        "compliance_flags": ["flag1", "flag2"] or [],
        "sentiment": "positive|neutral|negative"
      }`,
      response_json_schema: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          keywords: { type: 'array', items: { type: 'string' } },
          document_type: { type: 'string' },
          key_entities: {
            type: 'object',
            properties: {
              parties: { type: 'array', items: { type: 'string' } },
              dates: { type: 'array', items: { type: 'string' } },
              locations: { type: 'array', items: { type: 'string' } }
            }
          },
          compliance_flags: { type: 'array', items: { type: 'string' } },
          sentiment: { type: 'string' }
        }
      }
    });

    return Response.json({
      success: true,
      metadata: aiResponse
    });
  } catch (error) {
    console.error('Error extracting metadata:', error);
    return Response.json(
      {
        success: false,
        error: error.message || 'Failed to extract metadata'
      },
      { status: 500 }
    );
  }
});