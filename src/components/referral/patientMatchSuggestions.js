export const MAX_PATIENT_MATCH_SUGGESTIONS = 100;

const MAX_IDENTIFIER_LENGTH = 200;
const MAX_EVIDENCE_ITEMS = 20;
const MAX_EVIDENCE_LENGTH = 500;

const exactIdentifier = (value) => (
  typeof value === 'string'
  && value.length > 0
  && value.length <= MAX_IDENTIFIER_LENGTH
  && value.trim() === value
  && !value.startsWith('$')
);

const normalizeConfidence = (value) => (
  Number.isFinite(value) && value >= 0 && value <= 100 ? value : 0
);

function normalizeEvidence(value) {
  if (!Array.isArray(value)) return [];
  const normalized = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const text = item.trim().slice(0, MAX_EVIDENCE_LENGTH);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    normalized.push(text);
    if (normalized.length === MAX_EVIDENCE_ITEMS) break;
  }
  return normalized;
}

function mergeEvidence(current, incoming) {
  return normalizeEvidence([...current, ...incoming]);
}

function normalizeCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  if (!exactIdentifier(candidate.patient_id)) return null;
  return {
    patient_id: candidate.patient_id,
    confidence_score: normalizeConfidence(candidate.confidence_score),
    reasons: normalizeEvidence(candidate.reasons),
    discrepancies: normalizeEvidence(candidate.discrepancies),
  };
}

/**
 * Canonicalize AI-generated or legacy patient-match candidates before storing
 * or rendering them. The preferred candidate is always considered first.
 */
export function normalizePatientMatchSuggestions({
  preferred = null,
  suggestions = [],
} = {}) {
  let invalidCount = 0;
  let duplicateCount = 0;
  let truncatedCount = 0;
  const normalizedSuggestions = [];
  const byPatientId = new Map();

  const sourceSuggestions = Array.isArray(suggestions) ? suggestions : [];
  if (suggestions != null && !Array.isArray(suggestions)) invalidCount += 1;
  const candidates = preferred == null
    ? sourceSuggestions
    : [preferred, ...sourceSuggestions];

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = normalizeCandidate(candidates[index]);
    if (!candidate) {
      invalidCount += 1;
      continue;
    }

    const existing = byPatientId.get(candidate.patient_id);
    if (existing) {
      duplicateCount += 1;
      existing.confidence_score = Math.max(
        existing.confidence_score,
        candidate.confidence_score,
      );
      existing.reasons = mergeEvidence(existing.reasons, candidate.reasons);
      existing.discrepancies = mergeEvidence(
        existing.discrepancies,
        candidate.discrepancies,
      );
      continue;
    }

    if (normalizedSuggestions.length === MAX_PATIENT_MATCH_SUGGESTIONS) {
      truncatedCount = candidates.length - index;
      break;
    }

    normalizedSuggestions.push(candidate);
    byPatientId.set(candidate.patient_id, candidate);
  }

  return {
    suggestions: normalizedSuggestions,
    invalidCount,
    duplicateCount,
    truncatedCount,
  };
}
