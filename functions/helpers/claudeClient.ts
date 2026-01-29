/**
 * Helper module for Claude API interactions
 * Usage: import { invokeClaude } from './helpers/claudeClient.js';
 */

export async function invokeClaude({ prompt, response_json_schema = null, max_tokens = 4096 }) {
  const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
  
  if (!anthropicApiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  const messages = [
    {
      role: 'user',
      content: prompt
    }
  ];

  const requestBody = {
    model: 'claude-3-5-sonnet-20241022',
    max_tokens,
    messages
  };

  // Add JSON schema if provided
  if (response_json_schema) {
    requestBody.tools = [{
      name: 'generate_structured_response',
      description: 'Generate a structured JSON response',
      input_schema: response_json_schema
    }];
    requestBody.tool_choice = {
      type: 'tool',
      name: 'generate_structured_response'
    };
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicApiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Claude API error:', errorText);
    throw new Error(`Claude API failed: ${response.status}`);
  }

  const result = await response.json();

  // Handle tool use (structured JSON response)
  if (response_json_schema && result.content?.[0]?.type === 'tool_use') {
    return result.content[0].input;
  }

  // Handle text response
  const textContent = result.content?.find(c => c.type === 'text');
  return textContent?.text || '';
}