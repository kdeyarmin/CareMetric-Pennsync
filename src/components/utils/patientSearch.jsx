/**
 * Full-text search utility for patients
 * Searches across all patient fields and associated data
 */

export const searchPatients = (patients, searchTerm, associatedData = {}) => {
  if (!searchTerm.trim()) return patients;

  const term = searchTerm.toLowerCase();
  const visits = associatedData.visits || [];
  const carePlans = associatedData.carePlans || [];

  return patients.filter((patient) => {
    // Direct patient field matches
    const directMatches = [
      patient.first_name,
      patient.middle_name,
      patient.last_name,
      patient.medical_record_number,
      patient.phone,
      patient.email,
      patient.address,
      patient.primary_diagnosis,
      patient.specialty,
      patient.payor,
      patient.physician_name,
      patient.caregiver_name,
    ].some((field) => field && field.toLowerCase().includes(term));

    // Secondary diagnoses match
    const secondaryDiagnosisMatch = patient.secondary_diagnoses?.some(
      (diagnosis) => diagnosis && diagnosis.toLowerCase().includes(term)
    );

    // Allergies match
    const allergiesMatch = patient.allergies?.toLowerCase().includes(term);

    // Visit notes match
    const visitMatch = visits.some(
      (visit) =>
        visit.patient_id === patient.id &&
        (visit.nurse_notes?.toLowerCase().includes(term) ||
          visit.raw_transcription?.toLowerCase().includes(term))
    );

    // Care plan match
    const carePlanMatch = carePlans.some(
      (plan) =>
        plan.patient_id === patient.id &&
        (plan.problem?.toLowerCase().includes(term) ||
          plan.goal?.toLowerCase().includes(term))
    );

    return (
      directMatches ||
      secondaryDiagnosisMatch ||
      allergiesMatch ||
      visitMatch ||
      carePlanMatch
    );
  });
};

/**
 * Get search suggestions based on patient data
 */
export const getSearchSuggestions = (patients, currentTerm) => {
  if (!currentTerm.trim()) return [];

  const term = currentTerm.toLowerCase();
  const suggestions = new Set();

  patients.forEach((patient) => {
    // Add matching names
    if (patient.first_name?.toLowerCase().includes(term)) {
      suggestions.add(patient.first_name);
    }
    if (patient.last_name?.toLowerCase().includes(term)) {
      suggestions.add(patient.last_name);
    }

    // Add matching diagnoses
    if (patient.primary_diagnosis?.toLowerCase().includes(term)) {
      suggestions.add(patient.primary_diagnosis);
    }

    patient.secondary_diagnoses?.forEach((diagnosis) => {
      if (diagnosis?.toLowerCase().includes(term)) {
        suggestions.add(diagnosis);
      }
    });

    // Add matching MRNs
    if (patient.medical_record_number?.toLowerCase().includes(term)) {
      suggestions.add(patient.medical_record_number);
    }
  });

  return Array.from(suggestions).slice(0, 8); // Limit to 8 suggestions
};

/**
 * Highlight matching text in search results
 */
export const highlightSearchTerm = (text, searchTerm) => {
  if (!text || !searchTerm) return text;

  const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return text.replace(regex, '<mark>$1</mark>');
};