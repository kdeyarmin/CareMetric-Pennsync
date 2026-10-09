import { smartNoteRequest, exactKeys, noteFailure } from '../../shared/smartNoteIntegration.ts';
import { clinicalUploadUrl } from '../../shared/clinicalAiFiles.ts';

export default async function(req) {
  try {
    const { base44, input } = await smartNoteRequest(req);
    exactKeys(input, ['fileUrl']);
    const fileUrl = clinicalUploadUrl(input.fileUrl);
    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      model: 'automatic',
      prompt: `Analyze this document and extract any recipient fax/contact information.
Return ONLY a JSON object with these keys (use empty string if not found):
- name: the recipient person's full name
- organization: the organization, facility, or company name
- fax_number: the fax number in E.164 format (e.g. +12125551234), empty string if none found
- subject: a brief 1-line subject for a cover sheet based on the document content
- notes: any other useful notes about the recipient or document context

Document URL: ${fileUrl}`,
      file_urls: [fileUrl],
      response_json_schema: { type: 'object', properties: { name: { type: 'string' }, organization: { type: 'string' }, fax_number: { type: 'string' }, subject: { type: 'string' }, notes: { type: 'string' } } },
    });
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return noteFailure(error); }
}