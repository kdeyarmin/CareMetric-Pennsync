import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

// Utility function to normalize API responses.
// NOTE: do not log `response` here — it carries PHI (patient records/notes) and
// this runs on every fetch.
const normalizeApiResponse = (response) => {
  if (Array.isArray(response)) {
    return response;
  }
  if (response?.data && Array.isArray(response.data)) {
    return response.data;
  }
  if (response?.results && Array.isArray(response.results)) {
    return response.results;
  }
  return [];
};

export const useSmartNoteData = (selectedPatientId) => {
  // Fetch current user
  const { data: currentUser, isLoading: isLoadingUser, error: errorUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Fetch all patients with robust error handling
  const { data: patients = [], isLoading: isLoadingPatients, error: errorPatients } = useQuery({
    queryKey: ['patients'],
    queryFn: async () => {
      try {
        const listResult = await base44.entities.Patient.list('-updated_date', 1000);
        let patientArray = normalizeApiResponse(listResult);
        
        // Fallback: If list returns empty, try filter
        if (!patientArray || patientArray.length === 0) {
          const filterResult = await base44.entities.Patient.filter({}, '-updated_date', 1000);
          patientArray = normalizeApiResponse(filterResult);
        }

        return Array.isArray(patientArray) ? patientArray : [];
      } catch (err) {
        console.error('Patient fetch error:', err);
        throw new Error(`Failed to load patients: ${err.message || 'Unknown error'}`);
      }
    },
    initialData: [],
    staleTime: 0,
    gcTime: 0,
    retry: 2,
    retryDelay: 500
  });

  // Fetch selected patient's care plans
  const { data: carePlans = [], isLoading: isLoadingCarePlans, error: errorCarePlans } = useQuery({
    queryKey: ['patientCarePlans', selectedPatientId],
    queryFn: () => base44.entities.CarePlan.filter({ patient_id: selectedPatientId }),
    enabled: !!selectedPatientId,
    initialData: [],
  });

  // Fetch selected patient's recent visits
  const { data: recentVisits = [], isLoading: isLoadingRecentVisits, error: errorRecentVisits } = useQuery({
    queryKey: ['patientRecentVisits', selectedPatientId],
    queryFn: () => base44.entities.Visit.filter({ patient_id: selectedPatientId, status: 'completed' }, '-visit_date', 3),
    enabled: !!selectedPatientId,
    initialData: [],
  });

  // Fetch selected patient's OASIS data
  const { data: patientOASIS = [], isLoading: isLoadingOASIS, error: errorOASIS } = useQuery({
    queryKey: ['patientOASISForNotes', selectedPatientId],
    queryFn: () => base44.entities.OASISUpload.filter({ patient_id: selectedPatientId }, '-created_date', 1),
    enabled: !!selectedPatientId,
    initialData: [],
  });

  // Find selected patient from the list
  const selectedPatient = patients.find(p => p.id === selectedPatientId);

  // Build OASIS context from latest OASIS upload
  const oasisContext = (() => {
    if (!patientOASIS || patientOASIS.length === 0) return null;

    const latest = patientOASIS[0];
    const pdgm = latest.pdgm_data || {};
    const extracted = latest.extracted_data || {};

    return {
      assessmentDate: latest.created_date,
      admissionSource: pdgm.admission_source || extracted.admission_source,
      clinicalGroup: pdgm.clinical_grouping || extracted.clinical_group,
      functionalLevel: pdgm.functional_impairment_level || extracted.functional_level,
      comorbidities: Array.isArray(pdgm.comorbidity_level) ? pdgm.comorbidity_level : 
                    Array.isArray(extracted.comorbidities) ? extracted.comorbidities : [],
      primaryDiagnosis: extracted.primary_diagnosis || pdgm.primary_diagnosis,
      secondaryDiagnoses: extracted.secondary_diagnoses || [],
      medications: extracted.medications || [],
      admissionReason: extracted.admission_reason,
      priorHospitalization: extracted.prior_hospitalization,
      livingArrangement: extracted.living_arrangement,
      visionStatus: extracted.vision,
      hearingStatus: extracted.hearing,
      painLevel: extracted.pain_frequency,
      fallRisk: extracted.fall_risk,
      cognitiveStatus: extracted.cognitive_functioning,
      adlStatus: extracted.adl_limitations || {},
      iadlStatus: extracted.iadl_limitations || {}
    };
  })();

  // Build patient context for compliance checking
  const patientContext = selectedPatient ? {
    name: `${selectedPatient.first_name} ${selectedPatient.last_name}`,
    primaryDiagnosis: selectedPatient.primary_diagnosis,
    secondaryDiagnoses: selectedPatient.secondary_diagnoses || [],
    allergies: selectedPatient.allergies,
    recentConditions: recentVisits[0]?.nurse_notes ? 
      recentVisits[0].nurse_notes.substring(0, 200) + '...' : null,
    previousVisitSummary: recentVisits[0] ? 
      `Last visit ${recentVisits[0].visit_date}: ${recentVisits[0].visit_type}` : null,
    carePlanGoals: carePlans.filter(cp => cp.status === 'active').map(cp => cp.goal)
  } : null;

  // Consolidated loading and error states
  const isLoading = isLoadingUser || isLoadingPatients || isLoadingCarePlans || isLoadingRecentVisits || isLoadingOASIS;
  const hasError = errorUser || errorPatients || errorCarePlans || errorRecentVisits || errorOASIS;
  const error = hasError ? (errorUser || errorPatients || errorCarePlans || errorRecentVisits || errorOASIS) : null;

  return {
    currentUser,
    patients,
    selectedPatient,
    carePlans,
    recentVisits,
    patientOASIS,
    oasisContext,
    patientContext,
    isLoading,
    error,
    hasError,
  };
};