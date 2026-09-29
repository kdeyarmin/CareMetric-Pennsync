// Ported from base44/functions/syncCMSRegulations.
//
// The second capability to sequence a brokered model call and a write, and the
// first where the write is a RECORD contract rather than a trail append. The
// order is D53's: ask the model, shape the answer, store what may be stored,
// record the sync.
//
// The prompt asks the model to search the internet, so `add_context_from_internet`
// and the response schema are the original's and are passed through the broker
// unchanged.
//
// **"The runtime takes the operation's params as given" stood here and is
// FALSE**, measured 2026-09-29 by driving these constants through
// `validateParams`: the owned runtime refuses this model
// (`MODEL_MAPPING_REQUIRED`) and refuses a web search by name
// (`WEB_SEARCH_NOT_MIGRATED`).
//
// **So the search leg is PAUSED BY NAME (`WEB_SEARCH_RELEASE_PAUSED`), which
// is D42 and D81's shape.** The alternative — dropping the search and asking
// the model anyway — is not a degraded capability, it is one that stores
// regulations recalled from training as CURRENT CMS regulations in a
// healthcare compliance product. A capability that answers a refusal is
// strictly better than one that answers confidently and wrongly, so this is
// settled on correctness rather than weighed.
//
// The refusal is UNCONDITIONAL rather than gated on an operator setting, which
// is the difference from `requireDeliveryReleased`: what this waits on is a
// web search provider that does not exist, not a decision somebody can take. A
// switch an operator could turn on would only reach the runtime's own refusal.
// Everything below is the finished port and is kept whole, so restoring the
// capability when a provider exists is deleting one guard.
//
// **What the model returns is data, not instruction.** Every enumerated field
// it supplies is checked against the column's own constraint by the contract
// before anything is stored, and the answer reports how many were adjusted. The
// original writes them straight through, so a plausible-but-unlisted category
// raises a check violation and the row is lost inside a catch that only logs.
import { fail } from './contracts.mjs';
import { parseLLMJson } from './llm-json.mjs';

export const REGULATION_MODEL = 'gemini_3_1_pro';

/** The original's prompt, verbatim. */
export const CMS_REGULATION_PROMPT = `You are a Medicare home health compliance expert. Search the internet for the LATEST CMS regulations and updates for home health agencies as of December 2025.

Focus on:
1. Recent CMS policy changes (2024-2025)
2. OASIS-E documentation requirements
3. Medicare Conditions of Participation updates
4. PDGM clinical grouping changes
5. Documentation and billing requirements
6. Telehealth and remote patient monitoring guidelines
7. Quality reporting requirements (HH CAHPS, HHCAHPS, OASIS)

For EACH regulation found, provide:
- Regulation title and CMS reference number
- Effective date
- Summary of key changes
- Impact on home health agencies (critical/high/medium/low)
- Required actions for compliance
- Documentation requirements
- Link to official CMS source (if available)

Search multiple sources including CMS.gov, Medicare Learning Network, and recent Federal Register updates.

Return comprehensive, actionable compliance information.`;

/** And its response schema, field for field. */
export const CMS_REGULATION_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    sync_date: { type: 'string' },
    regulations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          cms_reference: { type: 'string' },
          effective_date: { type: 'string' },
          category: { type: 'string' },
          summary: { type: 'string' },
          impact_level: { type: 'string' },
          required_actions: { type: 'array', items: { type: 'string' } },
          documentation_requirements: { type: 'array', items: { type: 'string' } },
          source_url: { type: 'string' },
          compliance_deadline: { type: 'string' },
        },
      },
    },
    recent_updates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          urgency: { type: 'string' },
        },
      },
    },
    key_changes_summary: { type: 'string' },
  },
});

/**
 * The paused leg's refusal, raised before the model is reached.
 *
 * Refused HERE rather than left to the runtime so the answer names the reason
 * rather than reporting an unmapped model, and so that no round trip is spent
 * on a call that cannot succeed.
 */
export function requireWebSearchReleased() {
  fail(503, 'WEB_SEARCH_RELEASE_PAUSED');
}

export async function syncCmsRegulations({ integration, contract, audit }) {
  requireWebSearchReleased();
  const raw = await integration('InvokeLLM', {
    model: REGULATION_MODEL,
    prompt: CMS_REGULATION_PROMPT,
    add_context_from_internet: true,
    response_json_schema: structuredClone(CMS_REGULATION_SCHEMA),
  });
  const answer = parseLLMJson(raw) || {};
  const regulations = Array.isArray(answer.regulations) ? answer.regulations : [];
  const stored = await contract('syncCMSRegulations', { regulations });

  // The sync itself, in D25's trail. Counts only: the regulations are already
  // rows of their own, and the trail is not a second copy of them.
  let auditRecorded = true;
  try {
    await audit('cms_regulations_sync', {
      detail: {
        regulations_found: stored.regulations_found,
        regulations_stored: stored.regulations_stored,
        regulations_adjusted: stored.regulations_adjusted,
        recent_updates: Array.isArray(answer.recent_updates) ? answer.recent_updates.length : 0,
      },
    });
  } catch {
    // D53: the flag belongs wherever a transaction does not, and the store
    // write and this append are two round trips.
    auditRecorded = false;
  }

  return {
    success: true,
    sync_date: typeof answer.sync_date === 'string' && answer.sync_date
      ? answer.sync_date : new Date().toISOString(),
    regulations_count: stored.regulations_stored,
    regulations_adjusted: stored.regulations_adjusted,
    recent_updates: Array.isArray(answer.recent_updates) ? answer.recent_updates : [],
    key_changes_summary: typeof answer.key_changes_summary === 'string'
      && answer.key_changes_summary ? answer.key_changes_summary
      : 'No major changes detected',
    regulations: stored.regulations,
    audit_recorded: auditRecorded,
  };
}
