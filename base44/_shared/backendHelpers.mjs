/**
 * Canonical source for helpers that are INLINED into multiple Base44 Deno
 * functions (which can't import from each other or from src/). Each entry is the
 * exact text injected, verbatim, between the
 *   // <<<BEGIN SHARED HELPER: <name> ...>>>  /  // <<<END SHARED HELPER: <name>>>>
 * markers in every consuming function. Edit the helper HERE, then run
 *   npm run sync:shared-helpers        # rewrite all consumers
 *   npm run sync:shared-helpers -- --check   # CI gate: fail if any copy drifted
 *
 * This exists because several real bugs were drift between hand-maintained inline
 * copies (e.g. an area-code→timezone table that was Central in one file and fixed
 * in another). One canonical source + a parity check makes a fix land everywhere.
 */

import { AREA_CODE_TIMEZONE } from '../../src/components/voice/quietHours.js';
import { DEFAULT_URGENT_KEYWORDS } from '../../src/components/voice/urgentKeywords.js';

// The area-code -> timezone table's single source of truth is the FRONTEND
// quietHours.js (a 915-was-Central drift bug across the backend copies is exactly
// why this exists). Generate the inlined backend const from that live object so a
// fix to the frontend table auto-propagates to every backend SMS function.
function areaCodeTimezoneSource() {
  const lines = Object.entries(AREA_CODE_TIMEZONE)
    .map(([code, tz]) => `  ${code}: ${JSON.stringify(tz)},`)
    .join('\n');
  return `const AREA_CODE_TIMEZONE = {\n${lines}\n};`;
}

// Urgent-keyword list — single source of truth is the frontend urgentKeywords.js
// (the curly-apostrophe "can't breathe" miss was drift between the two copies).
function urgentKeywordsSource() {
  const items = DEFAULT_URGENT_KEYWORDS.map((k) => JSON.stringify(k)).join(', ');
  return `const DEFAULT_URGENT_KEYWORDS = [${items}];`;
}

export const SHARED_HELPERS = {
  // Generated from the frontend table (see above) — do not hand-edit consumers.
  areaCodeTimezone: areaCodeTimezoneSource(),
  urgentKeywords: urgentKeywordsSource(),

  // SSRF guard used by every function that fetches or hands a user-supplied URL to
  // a provider integration. Keep in step with src/components/utils/security.
  isSafeFetchUrl: `// SSRF guard: only fetch https URLs on public hosts, never internal IPs /
// metadata. Set FILE_URL_ALLOWED_HOSTS (comma-separated) to restrict to your
// storage host(s).
function isSafeFetchUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (['localhost', '0.0.0.0', '127.0.0.1', '::1', '169.254.169.254'].includes(host)) return false;
  if (host.endsWith('.internal') || host.endsWith('.local')) return false;
  const m = host.match(/^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
  }
  const allow = Deno.env.get('FILE_URL_ALLOWED_HOSTS');
  if (allow) {
    const hosts = allow.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
    if (!hosts.some((h) => host === h || host.endsWith('.' + h))) return false;
  }
  return true;
}`,

  // Admin-tier predicate. Mirrors src/lib/superAdmin.js isAdminLike — every admin
  // surface accepts facility admin (role 'admin'), agency_admin/super_admin, and
  // (OPT-IN) the platform owner email. The owner email is configured via the
  // SUPER_ADMIN_EMAIL env var (mirrors VITE_SUPER_ADMIN_EMAIL on the frontend);
  // when unset there is NO hard-coded owner — admin status is then determined
  // solely by role/account_type. The `SUPER_ADMIN_EMAIL &&` guard ensures an
  // unset (empty) override can never match a user (including one with no email).
  // Keep in step with superAdmin.js.
  isAdminLike: `const SUPER_ADMIN_EMAIL = ((typeof Deno !== 'undefined' && Deno.env.get('SUPER_ADMIN_EMAIL')) || '').trim().toLowerCase();
const sameEmail = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const isAdminLike = (u) => !!u && (
  u.role === 'admin' || u.account_type === 'agency_admin' ||
  u.account_type === 'super_admin' || (SUPER_ADMIN_EMAIL !== '' && sameEmail(u.email, SUPER_ADMIN_EMAIL))
);`,
};
