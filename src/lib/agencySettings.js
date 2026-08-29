import { base44 } from '@/api/base44Client';

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
 * Resolve a per-agency config entity (PDGMRateConfig, FollowUpRuleConfig, …)
 * by agency_name. Keyed miss → null. Legacy single unscoped row only when the
 * caller has no agency key (or exactly one unscoped row when keyed miss is
 * handled by returning null — no foreign-row fallback).
 *
 * @param {'PDGMRateConfig' | 'FollowUpRuleConfig' | 'FaxRetryConfig' | 'PayerRateConfig'} entityName
 * @param {string | null | undefined} agencyName
 * @returns {Promise<object | null>}
 */
export async function fetchCallerScopedConfig(entityName, agencyName) {
  const entity = base44.entities[entityName];
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

/** @param {string | null | undefined} agencyName */
export function fetchCallerPdgmRateConfig(agencyName) {
  return fetchCallerScopedConfig('PDGMRateConfig', agencyName);
}

/** @param {string | null | undefined} agencyName */
export function fetchCallerFollowUpRuleConfig(agencyName) {
  return fetchCallerScopedConfig('FollowUpRuleConfig', agencyName);
}

/** @param {string | null | undefined} agencyName */
export function fetchCallerPayerRateConfig(agencyName) {
  return fetchCallerScopedConfig('PayerRateConfig', agencyName);
}

/** @param {string | null | undefined} agencyName */
export function fetchCallerFaxRetryConfig(agencyName) {
  return fetchCallerScopedConfig('FaxRetryConfig', agencyName);
}
