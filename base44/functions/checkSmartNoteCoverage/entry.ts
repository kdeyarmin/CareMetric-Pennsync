import { smartNoteRequest, exactKeys, noteText, noteList, noteFailure } from '../../shared/smartNoteIntegration.ts';

export default async function(req) {
  try {
    const { base44, input } = await smartNoteRequest(req);
    exactKeys(input, ['draftText', 'elements']);
    const draftText = noteText(input.draftText, 60000);
    const elements = noteList(input.elements, 100, value => {
      if (!value || typeof value !== 'object') throw Object.assign(new Error('Invalid required element'), { status: 400 });
      exactKeys(value, ['id', 'label', 'severity', 'hint']);
      const element = { id: noteText(value.id, 100), label: noteText(value.label, 500), severity: noteText(value.severity, 100) };
      if (value.hint) element.hint = noteText(value.hint, 2000);
      return element;
    });
    if (!elements.length) throw Object.assign(new Error('Required elements missing'), { status: 400 });
    const prompt = `You are a Medicare home-health/hospice documentation completeness auditor.

For EACH required element id listed below, decide using ONLY the nurse's draft:
- "documented": true if the draft genuinely addresses this element with real clinical
  content. A NEGATED mention ("no fall assessment done"), a stray keyword, or a generic
  phrase that doesn't actually document the element is NOT documented (false).
- "adequate": true if what is documented is specific enough to survive a Medicare audit;
  false if it is vague/conclusory (e.g. "patient is homebound" with no reason).
- "reason": a brief phrase on what's missing (only when documented or adequate is false).
- "suggestedQuestion": a short question that would elicit the missing detail.

RULES:
- Judge ONLY the element ids listed. Do NOT invent new ids or topics.
- Do NOT write any note text or clinical facts. Output judgments only.
- When unsure, mark documented:false so the nurse is prompted (safer to ask).

REQUIRED ELEMENTS:
${elements.map(e => `- id: ${e.id} | ${e.label} (${e.severity})${e.hint ? ` | adequate answer covers: ${e.hint}` : ''}`).join('\n')}

NURSE DRAFT:
${draftText}

Return JSON: { "elements": [ { "id": "<one of the ids above>", "documented": true|false, "adequate": true|false, "reason": "...", "suggestedQuestion": "..." } ] }`;
    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      model: 'claude_sonnet_4_6', prompt,
      response_json_schema: { type: 'object', properties: { elements: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, documented: { type: 'boolean' }, adequate: { type: 'boolean' }, reason: { type: 'string' }, suggestedQuestion: { type: 'string' } }, required: ['id', 'documented'] } } }, required: ['elements'] },
    });
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return noteFailure(error); }
}