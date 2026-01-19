import { base44 } from "@/api/base44Client";

/**
 * Wrapper for Gemini AI that mimics the InvokeLLM interface
 * Drop-in replacement for base44.integrations.Core.InvokeLLM
 */
export async function invokeGemini({ prompt, response_json_schema, add_context_from_internet, file_urls }) {
  const response = await base44.functions.invoke('invokeGemini', {
    prompt,
    response_json_schema,
    add_context_from_internet,
    file_urls
  });

  // If JSON schema was provided, response.data is already the parsed object
  if (response_json_schema) {
    return response.data;
  }

  // Otherwise return the text content
  return response.data?.text || response.data;
}