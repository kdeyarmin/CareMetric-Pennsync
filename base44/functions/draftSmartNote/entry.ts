import { smartNoteRequest, exactKeys, noteText, noteList, noteFailure } from '../../shared/smartNoteIntegration.ts';

export default async function(req) {
  try {
    const { base44, input } = await smartNoteRequest(req);
    exactKeys(input, ['draftSentences', 'answers', 'confirmedNegatives', 'serviceLine', 'visitType']);
    const draftSentences = noteList(input.draftSentences ?? [], 300, value => noteText(value, 10000));
    const answers = noteList(input.answers ?? [], 100, value => {
      if (!value || typeof value !== 'object') throw Object.assign(new Error('Invalid answer'), { status: 400 });
      exactKeys(value, ['label', 'text']);
      return { label: noteText(value.label, 500), text: noteText(value.text, 10000) };
    });
    const negatives = noteList(input.confirmedNegatives ?? [], 100, value => noteText(value, 1000));
    const serviceLine = input.serviceLine ?? 'home_health';
    const visitType = input.visitType ?? 'routine_visit';
    if (!['home_health', 'hospice'].includes(serviceLine) || !['routine_visit', 'admission', 'recertification', 'discharge', 'prn'].includes(visitType) || !(draftSentences.length || answers.length || negatives.length)) {
      throw Object.assign(new Error('Invalid visit documentation'), { status: 400 });
    }
    const framing = serviceLine === 'hospice'
      ? 'ONE Medicare-compliant hospice nursing visit note, framed under the hospice Conditions of Participation (42 CFR Part 418), focused on comfort and the terminal plan of care'
      : 'ONE Medicare-compliant home health nursing note (42 CFR Part 484)';
    const clauses = { admission: ' documenting the start of care', recertification: ' documenting recertification for continued eligibility', discharge: ' documenting the discharge', prn: ' documenting this as-needed (PRN) visit' };
    const prompt = `You are a clinical scribe producing ${framing}${clauses[visitType] || ''}.

ABSOLUTE RULES (a violation makes the note unusable):
- Use ONLY the material in the three sections below. Add NO clinical fact, value,
  measurement, vital sign, finding, diagnosis, medication, or recommendation that
  is not present in that material.
- You MAY ONLY: reorder into a logical flow (assessment -> interventions ->
  patient response -> education -> plan), convert to professional past tense,
  fix grammar, and connect fragments into complete sentences.
- Do NOT invent vitals. Do NOT infer a homebound rationale. Do NOT add teach-back,
  negatives, or normals that are not stated below.
- If a section is "(none)", simply omit that content; do not fabricate it.

NURSE-WRITTEN OBSERVATIONS:
${draftSentences.length ? draftSentences.map(s => `- ${s}`).join('\n') : '(none)'}

NURSE ANSWERS TO REQUIRED-ELEMENT QUESTIONS:
${answers.length ? answers.map(a => `- Q: ${a.label} -> A: ${a.text}`).join('\n') : '(none)'}

CONFIRMED STANDARD NEGATIVES (include these verbatim in meaning):
${negatives.length ? negatives.map(n => `- ${n}`).join('\n') : '(none)'}

Return JSON: { "note": "<the final note text>" }`;
    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      model: 'claude_sonnet_4_6', prompt,
      response_json_schema: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] },
    });
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return noteFailure(error); }
}