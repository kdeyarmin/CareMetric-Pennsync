// Pure reconciliation of the LLM completeness-critic's output against the
// deterministic scan. This is the safety layer that keeps the critic ADVISORY
// and bounded:
//   - drops any element id the critic returns that isn't a real required element
//     (the model can only influence ids we already track — never invent topics);
//   - only ADDS gaps (demotes a draft element the keyword scan over-counted as
//     "present" but the critic judged absent), never removes a deterministic gap;
//   - surfaces "documented but too vague" elements as inline nudges.
// It never empties the required set and never touches critical gating.

/**
 * @param {any} critique critic elements (defensively typed — may be non-array): [{ id, documented, adequate, reason, suggestedQuestion }]
 * @param {{ requiredElements: Array, presence: Array }} ctx
 * @returns {{ demotedIds: string[], inadequate: Record<string,{reason:string,suggestedQuestion:string}> }}
 */
export function reconcileCritique(critique, { requiredElements, presence }) {
  const validIds = new Set(requiredElements.map((e) => e.id));
  const presentIds = new Set(presence.filter((p) => p.present).map((p) => p.id));
  const safe = Array.isArray(critique) ? critique.filter((c) => c && validIds.has(c.id)) : [];

  // Elements the deterministic scan counted as present but the critic says are
  // NOT actually documented → demote so the question gets asked.
  const demotedIds = [];
  /** @type {Record<string,{reason:string,suggestedQuestion:string}>} */
  const inadequate = {};
  for (const c of safe) {
    if (c.documented === false && presentIds.has(c.id)) demotedIds.push(c.id);
    if (c.adequate === false) {
      inadequate[c.id] = { reason: c.reason || "", suggestedQuestion: c.suggestedQuestion || "" };
    }
  }
  return { demotedIds: [...new Set(demotedIds)], inadequate };
}

/**
 * Merge the critic's demoted elements into the deterministic gap list (additive,
 * de-duplicated, original order preserved then extras appended).
 * @returns {Array} the effective gaps to ask about
 */
export function mergeGaps(deterministicGaps, requiredElements, demotedIds = []) {
  if (!demotedIds.length) return deterministicGaps;
  const gapIds = new Set(deterministicGaps.map((g) => g.id));
  const extras = requiredElements.filter((e) => demotedIds.includes(e.id) && !gapIds.has(e.id));
  return [...deterministicGaps, ...extras];
}
