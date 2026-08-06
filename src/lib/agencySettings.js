import { base44 } from '@/api/base44Client';

/**
 * Resolve the caller's AgencySettings row for UI policy (templates, hours, etc.).
 * Prefer agency_code / office_name match; never take global newest when multiple
 * tenant rows exist (would apply another agency's quiet hours / wage index).
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
  }
  const newest = await base44.entities.AgencySettings.list('-created_date', 5).catch(() => []);
  if ((newest || []).length > 1) return null;
  return newest?.[0] || null;
}
