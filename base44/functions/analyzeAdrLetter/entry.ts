import { smartNoteRequest, exactKeys, noteFailure } from '../../shared/smartNoteIntegration.ts';
import { clinicalUploadUrl } from '../../shared/clinicalAiFiles.ts';
import { ADR_LETTER_PROMPT, ADR_LETTER_SCHEMA } from '../../shared/adrIntegrationAnalysis.ts';

export default async function(req) {
  try {
    const { base44, input, context } = await smartNoteRequest(req);
    if (!['agency_admin', 'manager', 'platform_owner'].includes(context.tenant_role)) throw Object.assign(new Error('Administrator access required'), { status: 403 });
    exactKeys(input, ['fileUrl']);
    const fileUrl = clinicalUploadUrl(input.fileUrl);
    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({ model: 'automatic', prompt: ADR_LETTER_PROMPT, file_urls: [fileUrl], response_json_schema: ADR_LETTER_SCHEMA });
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return noteFailure(error); }
}