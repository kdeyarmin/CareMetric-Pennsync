/**
 * Build ClinicalPathway write payloads.
 *
 * The entity requires `pathway_name` AND `condition`, and none of the four
 * writers (the manager's form, its sample loader and duplicate action, the AI
 * generator and the AI updater) ever set `condition`, so every create was
 * refused by the schema. The payload is also an allowlist: a row read back
 * carries `id`, timestamps and usage counters, and the AI updater merges
 * whatever keys the model names, so only the pathway's own content fields are
 * written.
 */

export const PATHWAY_SYSTEM_FIELDS = Object.freeze([
  'id',
  'created_date',
  'updated_date',
  'created_by',
  'created_by_id',
  'usage_count',
  'success_rate',
]);

const SYSTEM = new Set(PATHWAY_SYSTEM_FIELDS);
const ARRAY_FIELDS = new Set([
  'icd10_codes',
  'phases',
  'references',
  'trigger_conditions',
  'documentation_prompts',
  'rescore_opportunities',
  'recommended_tasks',
  'comorbidity_checklist',
  'functional_focus_areas',
]);
const TEXT_FIELDS = new Set([
  'pathway_name',
  'condition',
  'description',
  'typical_los',
  'evidence_level',
  'pdgm_clinical_group',
  'priority_level',
]);

const cleanText = (value) => (typeof value === 'string' ? value.trim() : '');

function contentFields(source) {
  const out = {};
  for (const [key, value] of Object.entries(source || {})) {
    if (SYSTEM.has(key)) continue;
    if (ARRAY_FIELDS.has(key)) {
      if (Array.isArray(value)) out[key] = value;
    } else if (TEXT_FIELDS.has(key)) {
      if (typeof value === 'string') out[key] = value;
    } else if (key === 'is_active') {
      if (typeof value === 'boolean') out[key] = value;
    }
  }
  return out;
}

/** The condition a pathway addresses, falling back to the given text, then its name. */
export function pathwayCondition(pathway, fallback) {
  return cleanText(pathway?.condition) || cleanText(fallback) || cleanText(pathway?.pathway_name);
}

export function pathwayCreatePayload(pathway, { fallbackCondition } = {}) {
  const payload = contentFields(pathway);
  payload.pathway_name = cleanText(payload.pathway_name);
  if (!payload.pathway_name) throw new Error('A pathway name is required');
  payload.condition = pathwayCondition(payload, fallbackCondition);
  return payload;
}

/**
 * Apply an AI recommendation's `suggested_change` to a stored pathway. Array
 * fields are appended to, text fields replaced, and any key that is not one of
 * the pathway's own content fields is ignored rather than written.
 */
export function pathwayUpdatePayload(current, suggestedChange) {
  const base = contentFields(current);
  const change = contentFields(suggestedChange);
  for (const [key, value] of Object.entries(change)) {
    base[key] = ARRAY_FIELDS.has(key) ? [...(base[key] || []), ...value] : value;
  }
  base.pathway_name = cleanText(base.pathway_name) || cleanText(current?.pathway_name);
  if (!base.pathway_name) throw new Error('A pathway name is required');
  base.condition = pathwayCondition(base, current?.condition);
  return base;
}
