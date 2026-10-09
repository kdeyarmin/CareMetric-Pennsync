import { smartNoteRequest, exactKeys, noteText, noteList, noteFailure } from '../../shared/smartNoteIntegration.ts';

export default async function(req) {
  try {
    const { base44, input } = await smartNoteRequest(req);
    exactKeys(input, ['sentences', 'sourceText']);
    const sentences = noteList(input.sentences, 300, value => noteText(value, 10000));
    if (!sentences.length) throw Object.assign(new Error('Note sentences required'), { status: 400 });
    const sourceText = noteText(input.sourceText, 60000);
    const prompt = `Classify each sentence of the OUTPUT note as "supported" or "unsupported" by the SOURCE.

- "supported": every clinical fact/value/finding in the sentence is present in the
  SOURCE (a nurse-written observation, a nurse answer, or a confirmed negative).
- "unsupported": the sentence introduces any fact/value/finding NOT in the SOURCE.
- Reorganization, past-tense conversion, and grammar fixes do NOT make a sentence
  unsupported. Generic connective phrasing with no new clinical content is "supported".

SOURCE:
${sourceText}

OUTPUT (one sentence per line):
${sentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Return JSON: { "sentences": [ { "text": "...", "status": "supported"|"unsupported", "source": "draft"|"answer"|"negative"|"none" } ] }`;
    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      model: 'claude_opus_4_8', prompt,
      response_json_schema: { type: 'object', properties: { sentences: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, status: { type: 'string' }, source: { type: 'string' } } } } } },
    });
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return noteFailure(error); }
}