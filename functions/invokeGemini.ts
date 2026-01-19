import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json();
    const { prompt, response_json_schema, add_context_from_internet, file_urls } = payload;

    if (!prompt) {
      return Response.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const apiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY');
    if (!apiKey) {
      return Response.json({ error: 'GOOGLE_GEMINI_API_KEY not configured' }, { status: 500 });
    }

    // Choose model based on requirements
    let model = 'gemini-1.5-flash';
    if (add_context_from_internet || file_urls) {
      model = 'gemini-1.5-pro'; // Pro supports multimodal and grounding
    }

    // Build request body
    const contents = [{
      parts: [{ text: prompt }]
    }];

    // Add files if provided (images, PDFs, etc.)
    if (file_urls) {
      const urls = Array.isArray(file_urls) ? file_urls : [file_urls];
      for (const url of urls) {
        if (url.startsWith('data:')) {
          // Handle base64 data URLs
          const mimeMatch = url.match(/data:([^;]+);base64,(.+)/);
          if (mimeMatch) {
            contents[0].parts.push({
              inline_data: {
                mime_type: mimeMatch[1],
                data: mimeMatch[2]
              }
            });
          }
        } else {
          // Handle regular URLs - fetch and convert to base64
          try {
            const response = await fetch(url);
            const blob = await response.blob();
            const buffer = await blob.arrayBuffer();
            const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
            contents[0].parts.push({
              inline_data: {
                mime_type: blob.type,
                data: base64
              }
            });
          } catch (err) {
            console.error('Failed to fetch file:', url, err);
          }
        }
      }
    }

    const requestBody = {
      contents,
      generationConfig: {}
    };

    // Configure JSON output if schema provided
    if (response_json_schema) {
      requestBody.generationConfig.response_mime_type = 'application/json';
      requestBody.generationConfig.response_schema = response_json_schema;
    }

    // Add grounding for web search
    if (add_context_from_internet) {
      requestBody.tools = [{
        google_search_retrieval: {
          dynamic_retrieval_config: {
            mode: 'MODE_DYNAMIC',
            dynamic_threshold: 0.7
          }
        }
      }];
    }

    // Call Gemini API
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    
    const geminiResponse = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error('Gemini API error:', errorText);
      return Response.json({ 
        error: 'Gemini API request failed', 
        details: errorText 
      }, { status: geminiResponse.status });
    }

    const data = await geminiResponse.json();
    
    if (!data.candidates || data.candidates.length === 0) {
      return Response.json({ 
        error: 'No response from Gemini',
        details: JSON.stringify(data)
      }, { status: 500 });
    }

    const text = data.candidates[0].content.parts[0].text;

    // Parse JSON if schema was provided
    if (response_json_schema) {
      try {
        const parsed = JSON.parse(text);
        return Response.json(parsed);
      } catch (e) {
        console.error('Failed to parse JSON response:', text);
        return Response.json({ error: 'Invalid JSON response from AI', raw: text }, { status: 500 });
      }
    }

    // Return plain text
    return Response.json({ text });

  } catch (error) {
    console.error('Error in invokeGemini:', error);
    return Response.json({
      error: 'Failed to invoke Gemini',
      details: error.message
    }, { status: 500 });
  }
});