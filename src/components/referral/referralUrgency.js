/**
 * Referral urgency vocabularies → Referral.priority (urgent|high|normal|low).
 *
 * Three stacks historically spoke different dialects:
 *   - triageReferralWithAI: CRITICAL|HIGH|MEDIUM|LOW
 *   - ReferralAnalyzer:     STAT|High|Medium|Low
 *   - extraction / analyzeReferralPriority: urgent|high|normal|low
 *   - DocumentToTriageMapper heuristics: urgent|high|routine
 *
 * Map at the write boundary so a mixed-case or alternate label cannot land
 * as an unmapped priority (and silently become "normal").
 */

export const REFERRAL_PRIORITIES = Object.freeze(['urgent', 'high', 'normal', 'low']);
export const REFERRAL_PRIORITY_RANK = Object.freeze({ low: 0, normal: 1, high: 2, urgent: 3 });
export const TRIAGE_URGENCY_LEVELS = Object.freeze(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);

/** Triage AI category, or UNKNOWN when the model answered outside the set. */
export function normalizeTriageUrgency(value) {
  const normalized = String(value ?? '').trim().toUpperCase();
  return TRIAGE_URGENCY_LEVELS.includes(normalized) ? normalized : 'UNKNOWN';
}

export function triageUrgencyToReferralPriority(value) {
  switch (normalizeTriageUrgency(value)) {
    case 'CRITICAL': return 'urgent';
    case 'HIGH': return 'high';
    case 'MEDIUM': return 'normal';
    case 'LOW': return 'low';
    default: return 'normal';
  }
}

/** Task.priority for a triage urgency (schema: low|medium|high). */
export function triageUrgencyToTaskPriority(value) {
  switch (normalizeTriageUrgency(value)) {
    case 'CRITICAL':
    case 'HIGH':
      return 'high';
    default:
      return 'medium';
  }
}

/**
 * Map any known urgency label onto Referral.priority.
 * @param {*} value
 * @param {{ fallback?: string|null }} [options] — default `'normal'`; pass
 *   `fallback: null` when the caller wants to detect "absent / unknown".
 */
export function toReferralPriority(value, { fallback = 'normal' } = {}) {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;

  const key = raw.toLowerCase();
  if (key === 'urgent' || key === 'stat' || key === 'critical') return 'urgent';
  if (key === 'high') return 'high';
  if (key === 'normal' || key === 'medium' || key === 'routine') return 'normal';
  if (key === 'low') return 'low';

  const triage = normalizeTriageUrgency(raw);
  if (triage !== 'UNKNOWN') return triageUrgencyToReferralPriority(triage);
  return fallback;
}

/** Keep the higher of two priorities (never downgrade staff/AI urgency). */
export function maxReferralPriority(a, b) {
  const left = toReferralPriority(a, { fallback: null });
  const right = toReferralPriority(b, { fallback: null });
  const leftRank = left == null ? -1 : REFERRAL_PRIORITY_RANK[left];
  const rightRank = right == null ? -1 : REFERRAL_PRIORITY_RANK[right];
  if (leftRank >= rightRank) return left || right || 'normal';
  return right || left || 'normal';
}
