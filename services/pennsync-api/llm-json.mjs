// The tolerant JSON extractor the referral handlers share.
//
// Carried across from the Base44 originals unchanged, including the reason it
// exists. Their comment reads: "we ask for strict JSON in-prompt instead of
// passing response_json_schema, because the provider rejects deeply-nested
// object schemas that lack an explicit `required` array at every level."
//
// So the answer arrives as prose that may be fenced, prefixed or truncated, and
// this salvages it. A stricter parser would turn answers the originals accepted
// into failures, which is why the fallbacks are reproduced rather than tidied:
// strip a leading fence, try the whole string, then take the outermost braces.
//
// Note that `generateReferralTasks` does pass `response_json_schema` and does
// not use this — its schema carries `required` at every level, so the provider
// takes it. The two approaches sit side by side in the originals on purpose.
export function parseLLMJson(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  const text = String(raw).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  }
}
