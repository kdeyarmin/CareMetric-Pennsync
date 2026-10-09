import { smartNoteRequest, exactKeys, noteText, noteFailure } from '../../shared/smartNoteIntegration.ts';
import { clinicalUploadUrl } from '../../shared/clinicalAiFiles.ts';

export default async function(req) {
  try {
    const { base44, input, context } = await smartNoteRequest(req);
    exactKeys(input, ['fileUrl', 'referralId', 'agencyId', 'isImage']);
    const fileUrl = clinicalUploadUrl(input.fileUrl);
    const referralId = noteText(input.referralId, 200);
    const agencyId = noteText(input.agencyId, 200);
    if (agencyId !== context.agency_id) throw Object.assign(new Error('Referral workspace does not match'), { status: 403 });
    const readReferral = async () => {
      const response = await base44.functions.invoke('manageAuthorizedReferral', { action: 'get', agency_id: agencyId, referral_id: referralId });
      const data = response.data;
      if (data?.success !== true || data.referral?.id !== referralId || data.scope?.agency_id !== agencyId) throw Object.assign(new Error('Referral unavailable'), { status: 403 });
      return data.referral;
    };
    const referral = await readReferral();
    const items = (referral.follow_up_requests?.items || [])
      .filter(it => it && it.id && (!it.item_status || it.item_status === 'open'))
      .map(it => ({ id: noteText(it.id, 200), title: String(it.title || '').slice(0, 500), question: String(it.provider_request?.question || it.needed || '').slice(0, 3000) }));
    if (!items.length || items.length > 100) throw Object.assign(new Error('No supported open follow-up items'), { status: 400 });
    const prompt = `This scanned document is a referring provider's completed "Additional Information Request" form (or their response documents) returned to a home health agency. Read it completely — typed text, handwriting, checkboxes, margin notes, and any attached pages.

For each requested item below, determine whether the provider ANSWERED it in this document, and transcribe their response verbatim. A checked "Document attached" box counts as the response "Document attached" (plus any note beside it). Do NOT invent or infer answers: if an item's response area is blank, illegible, or the document does not address it, mark it unanswered.

REQUESTED ITEMS:
${items.map((it, i) => `${i + 1}. id: ${it.id}\n   ${it.title || it.id}${it.question ? `\n   Question: ${it.question}` : ''}`).join('\n')}${input.isImage === true ? '\n\nThis is a scanned image — read handwriting carefully.' : ''}`;
    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      model: 'automatic', prompt, file_urls: [fileUrl],
      response_json_schema: { type: 'object', properties: { answers: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, answered: { type: 'boolean' }, response_text: { type: 'string' } } } }, document_summary: { type: 'string', description: 'One or two sentences describing what the scanned document contains.' } } },
    });
    // Membership and open-item state can change during the paid read.
    const current = await readReferral();
    const allowedIds = new Set((current.follow_up_requests?.items || []).filter(it => it && (!it.item_status || it.item_status === 'open')).map(it => it.id));
    return Response.json({ ...result, answers: (result.answers || []).filter(answer => allowedIds.has(answer.id) && items.some(it => it.id === answer.id)) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return noteFailure(error); }
}