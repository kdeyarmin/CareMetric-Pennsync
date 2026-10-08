import { base44 } from '@/api/base44Client';

// Exact runtime allowlist: never index the SDK entity registry with caller-
// supplied text. In particular, Patient/Visit must remain unreachable through
// this generic configuration helper now that their direct reads are disabled.
// (The payer-rate config entity left this allowlist with the PDGM payment
// features: the payer-rate editor that was its only reader was removed.)
const CONFIG_ENTITIES = Object.freeze({
  FaxRetryConfig: base44.entities.FaxRetryConfig,
});

/**
 * Resolve the caller's AgencySettings row for UI policy (templates, hours, etc.).
 * Prefer agency_code / office_name match. A keyed miss returns null (never adopt
 * another agency's sole legacy row). Single-row legacy fallback only when the
 * caller has no agency key.
 *
 * @param {string | null | undefined} agencyName
 * @returns {Promise<object | null>}
 */
export async function fetchCallerAgencySettings(agencyName) {
  const key = String(agencyName || '').trim();
  if (key) {
    const byCode = await base44.entities.AgencySettings
      .filter({ agency_code: key }, '-created_date', 1)
      .catch(() => []);
    if (byCode?.[0]) return byCode[0];
    const byName = await base44.entities.AgencySettings
      .filter({ office_name: key }, '-created_date', 1)
      .catch(() => []);
    if (byName?.[0]) return byName[0];
    return null;
  }
  const newest = await base44.entities.AgencySettings.list('-created_date', 5).catch(() => []);
  if ((newest || []).length > 1) return null;
  return newest?.[0] || null;
}

/**
 * Resolve a per-agency config entity (FaxRetryConfig) by agency_name. Keyed miss → null. Legacy single unscoped row only when the
 * caller has no agency key (or exactly one unscoped row when keyed miss is
 * handled by returning null — no foreign-row fallback).
 *
 * @param {'FaxRetryConfig'} entityName
 * @param {string | null | undefined} agencyName
 * @returns {Promise<object | null>}
 */
export async function fetchCallerScopedConfig(entityName, agencyName) {
  if (!Object.hasOwn(CONFIG_ENTITIES, entityName)) return null;
  const entity = CONFIG_ENTITIES[entityName];
  if (!entity) return null;
  const key = String(agencyName || '').trim();
  if (key) {
    const rows = await entity.filter({ agency_name: key }, '-created_date', 1).catch(() => []);
    if (rows?.[0]) return rows[0];
    // Prefer a single unscoped legacy row for this agency's first save path,
    // but never a row that belongs to another agency.
    const newest = await entity.list('-created_date', 5).catch(() => []);
    const legacy = (newest || []).filter((r) => !String(r?.agency_name || '').trim());
    if (legacy.length === 1) return legacy[0];
    return null;
  }
  const newest = await entity.list('-created_date', 5).catch(() => []);
  if ((newest || []).length > 1) return null;
  return newest?.[0] || null;
}

const ruleConfigShape = (config) => {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  return {
    disabled_rules: Array.isArray(config.disabled_rules)
      ? config.disabled_rules.filter((rule) => typeof rule === 'string')
      : [],
    severity_overrides: config.severity_overrides && typeof config.severity_overrides === 'object'
      && !Array.isArray(config.severity_overrides)
      ? config.severity_overrides
      : {},
    custom_items: Array.isArray(config.custom_items)
      ? config.custom_items.filter((item) => item && typeof item === 'object')
      : [],
  };
};

/**
 * The caller's agency follow-up rules. The agency is decided server-side from
 * the caller's service-owned membership, so the agency hint a caller passes is
 * ignored rather than trusted, and the entity is never read directly. Any
 * failure falls back to the built-in rules, which are the floor.
 *
 * @param {string | null | undefined} _agencyName ignored; the server decides the agency
 */
export function fetchCallerFollowUpRuleConfig(_agencyName) {
  return Promise.resolve()
    .then(() => base44.functions.invoke('saveFollowUpRuleConfig', { action: 'get' }))
    .then((res) => ruleConfigShape((res?.data ?? res)?.config))
    .catch(() => null);
}

/** @param {string | null | undefined} agencyName */
export function fetchCallerFaxRetryConfig(agencyName) {
  return fetchCallerScopedConfig('FaxRetryConfig', agencyName);
}
