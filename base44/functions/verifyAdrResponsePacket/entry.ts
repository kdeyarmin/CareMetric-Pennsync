import { smartNoteRequest, exactKeys, noteText, noteFailure } from '../../shared/smartNoteIntegration.ts';
import { clinicalUploadUrl } from '../../shared/clinicalAiFiles.ts';
import { isPlatformOwner } from '../../shared/securityAccess.ts';
import { packetVerificationPrompt, PACKET_VERIFICATION_SCHEMA } from '../../shared/adrIntegrationAnalysis.ts';

export default async function(req) {
  try {
    const { base44, input, user, context } = await smartNoteRequest(req);
    if (!['agency_admin', 'manager', 'platform_owner'].includes(context.tenant_role)) throw Object.assign(new Error('Administrator access required'), { status: 403 });
    exactKeys(input, ['caseId']);
    const caseId = noteText(input.caseId, 200);
    const loadCase = async () => {
      const page = await base44.entities.AdrAuditCase.filter({ id: caseId }, { limit: 2 });
      const row = page.items?.length === 1 ? page.items[0] : null;
      if (!row || (row.created_by_id !== user.id && !isPlatformOwner(user))) throw Object.assign(new Error('ADR case unavailable'), { status: 403 });
      return row;
    };
    const row = await loadCase();
    const fileUrl = clinicalUploadUrl(row.packet_file_url);
    if (!Array.isArray(row.checklist) || !row.checklist.length || row.checklist.length > 150) throw Object.assign(new Error('A supported ADR checklist is required'), { status: 400 });
    const prompt = packetVerificationPrompt(row.checklist);
    if (prompt.length > 80000) throw Object.assign(new Error('ADR checklist is too large'), { status: 413 });
    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({ model: 'automatic', prompt, file_urls: [fileUrl], response_json_schema: PACKET_VERIFICATION_SCHEMA });
    const current = await loadCase();
    if (current.packet_file_url !== row.packet_file_url || JSON.stringify(current.checklist) !== JSON.stringify(row.checklist)) throw Object.assign(new Error('ADR packet changed during review; reopen the current packet'), { status: 409 });
    const allowed = new Set(row.checklist.map(item => item.id));
    return Response.json({ ...result, items: (result.items || []).filter(item => allowed.has(item.id)) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return noteFailure(error); }
}