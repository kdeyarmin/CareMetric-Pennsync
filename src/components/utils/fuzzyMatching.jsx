// Fuzzy matching utilities for duplicate detection.
//
// This module is a thin compatibility wrapper around the single source of
// truth for patient matching, src/components/patient/patientDuplicateUtils.js.
// Keeping the scoring centralized there means every duplicate-detection
// surface behaves identically.

import { scorePatientPair } from "@/components/patient/patientDuplicateUtils";

// Calculate match score between two patients.
export const calculateMatchScore = (uploadedPatient, existingPatient) => {
  const { score, matches } = scorePatientPair(uploadedPatient, existingPatient);
  return { score, reasons: matches };
};

// Find potential matches for a patient among a list of existing patients.
export const findPotentialMatches = (uploadedPatient, existingPatients, threshold = 40) => {
  return existingPatients
    .map((existingPatient) => ({
      patient: existingPatient,
      ...calculateMatchScore(uploadedPatient, existingPatient),
    }))
    .filter((match) => match.score >= threshold)
    .sort((a, b) => b.score - a.score);
};

// Classify match confidence from a raw score.
export const getMatchConfidence = (score) => {
  if (score >= 80) return { level: 'DEFINITE', label: 'Definite match' };
  if (score >= 60) return { level: 'LIKELY', label: 'Likely match - review recommended' };
  if (score >= 40) return { level: 'POSSIBLE', label: 'Possible match - manual review needed' };
  return { level: 'UNLIKELY', label: 'No significant match' };
};
