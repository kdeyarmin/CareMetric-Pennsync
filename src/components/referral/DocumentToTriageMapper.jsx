import { useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useScopedPatients } from '@/hooks/useScopedPatients';
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, AlertTriangle, Loader2, ArrowRight } from "lucide-react";
import DocumentIngestionUploader from "../documents/DocumentIngestionUploader";
import SearchablePatientSelect from "../ui/SearchablePatientSelect";
import { todayEastern } from "@/components/utils/timezone";
import { checkExtractedPatientMatch } from "./documentPatientMatch";
import { findDuplicatesForCandidate } from "../patient/patientDuplicateUtils";
import { referralPatientReadiness, splitPatientName } from "./referralPatientReadiness";
import { toast } from "sonner";

export default function DocumentToTriageMapper({ onTriageCreated }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: patients = [] } = useScopedPatients({ sort: '-created_date', limit: 1000 });

  const [extractedData, setExtractedData] = useState(null);
  const [mapping, setMapping] = useState({
    createPatient: false,
    updatePatient: false,
    patientId: null,
    createTriage: false,
    createReferral: false
  });
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  // Identity-mismatch gate: writing extracted clinical data onto a chart whose
  // name/DOB/MRN conflicts with the document requires an explicit confirmation.
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  // Duplicate-chart gate: creating a patient that matches an existing chart
  // requires explicit confirmation (mirrors PatientForm's duplicate check).
  const [duplicateWarning, setDuplicateWarning] = useState(null);

  const selectedPatient = mapping.patientId
    ? patients.find((p) => p.id === mapping.patientId) || null
    : null;
  const identityCheck =
    mapping.updatePatient && selectedPatient && extractedData?.patient
      ? checkExtractedPatientMatch(extractedData.patient, selectedPatient)
      : null;

  const handleDataExtracted = (data) => {
    setExtractedData(data);
    setError(null);
    setResult(null);
    setIdentityConfirmed(false);
    setDuplicateWarning(null);
  };

  const handleProcessMapping = async () => {
    if (!extractedData) return;

    setProcessing(true);
    setError(null);
    setResult(null);

    // Nothing to create without a patient name to key the record on — surface it
    // instead of silently doing nothing (no result, no error, no feedback).
    if (mapping.createPatient && !extractedData.patient?.last_name) {
      setError("No patient last name was extracted — select an existing patient or enter the name manually.");
      setProcessing(false);
      return;
    }

    // Identity gate: the document's extracted patient must match the chart it
    // is about to update. A conflict on name/DOB/MRN blocks the write unless
    // the operator explicitly confirms they verified the identity.
    if (mapping.updatePatient && identityCheck?.verdict === "mismatch" && !identityConfirmed) {
      setError(
        `The document's patient does not match the selected chart — conflicting ${identityCheck.conflicts.join("; ")}. ` +
          "Verify you selected the right patient, then tick the confirmation box to proceed.",
      );
      setProcessing(false);
      return;
    }

    try {
      let patientId = mapping.patientId;

      // Create or update patient — same readiness gate as triage/intake so we
      // never mint "Unknown"/"Doe," placeholder charts into the active census.
      if (mapping.createPatient) {
        const readiness = referralPatientReadiness({
          patient_name: extractedData.patient?.full_name
            || [extractedData.patient?.first_name, extractedData.patient?.last_name].filter(Boolean).join(' '),
          full_name: extractedData.patient?.full_name,
          date_of_birth: extractedData.patient?.date_of_birth,
          medical_record_number: extractedData.patient?.medical_record_number || extractedData.patient?.mrn,
          phone: extractedData.patient?.phone,
          address: extractedData.patient?.address,
        });
        // Prefer structured first/last when present and well-formed; otherwise
        // use the readiness splitter (handles "Last, First").
        const structured = splitPatientName(
          extractedData.patient?.full_name
            || [extractedData.patient?.first_name, extractedData.patient?.last_name].filter(Boolean).join(' ')
        );
        if (!readiness.ready) {
          setError(`Cannot create patient chart. Missing: ${readiness.missing.join(', ')}.`);
          toast.error(`Cannot create patient chart. Missing: ${readiness.missing.join(', ')}.`);
          setProcessing(false);
          return;
        }
        const patientData = {
          first_name: readiness.first_name || structured.first_name,
          last_name: readiness.last_name || structured.last_name,
          date_of_birth: readiness.identifiers.date_of_birth || "",
          medical_record_number: readiness.identifiers.medical_record_number || "",
          phone: readiness.identifiers.phone || "",
          email: extractedData.patient?.email || "",
          address: readiness.identifiers.address || "",
          primary_diagnosis: extractedData.clinical?.primary_diagnosis || "",
          secondary_diagnoses: extractedData.clinical?.secondary_diagnoses || [],
          // Never synthesize a clinical negative: an empty extraction stays
          // blank. Charting "NKDA" for a patient whose allergies simply were
          // not extracted is an affirmative safety falsehood.
          allergies: extractedData.clinical?.allergies || "",
          current_medications: extractedData.clinical?.current_medications || [],
          baseline_vitals: extractedData.vitals || {},
          status: "active"
        };

        // Duplicate gate (mirrors PatientForm): creating a chart that matches
        // an existing patient needs explicit confirmation — repeated document
        // uploads were silently minting duplicate charts.
        if (!duplicateWarning?.confirmed) {
          const matches = findDuplicatesForCandidate(patientData, patients, { limit: 3 });
          if (matches.length > 0) {
            setDuplicateWarning({ matches, confirmed: false });
            setError(
              `A possible existing chart matches this patient (${matches
                .map((m) => `${m.patient?.first_name || ""} ${m.patient?.last_name || ""}`.trim())
                .filter(Boolean)
                .join(", ")}). Use "Update Existing Patient" for that chart, or confirm creating a new one.`,
            );
            setProcessing(false);
            return;
          }
        }

        const newPatient = await base44.entities.Patient.create(patientData);
        patientId = newPatient.id;
        // Persist the created patient immediately so a retry after a later failure
        // (e.g. Referral.create below) reuses this record instead of creating a
        // duplicate patient chart.
        setMapping((prev) => ({
          ...prev,
          createPatient: false,
          updatePatient: true,
          patientId: newPatient.id,
        }));
      } else if (mapping.updatePatient && patientId && extractedData.clinical) {
        await base44.entities.Patient.update(patientId, {
          primary_diagnosis: extractedData.clinical.primary_diagnosis || undefined,
          secondary_diagnoses: extractedData.clinical.secondary_diagnoses || undefined,
          allergies: extractedData.clinical.allergies || undefined,
          current_medications: extractedData.clinical.current_medications || undefined,
          baseline_vitals: extractedData.vitals || undefined
        });
      }

      // Create referral/triage
      if ((mapping.createTriage || mapping.createReferral) && patientId) {
        // Only Referral schema fields persist; clinical detail goes in the
        // free-form extracted_data blob. The previous payload wrote many fields
        // the schema doesn't define (chief_complaint, secondary_diagnoses, vitals,
        // medications, allergies, urgency, ai_extracted, confidence_score) — all
        // silently dropped — plus an invalid document_type ('clinical_record').
        const URGENCY_TO_PRIORITY = { urgent: "urgent", high: "high", routine: "normal" };
        // Referral.document_type is a FILE-FORMAT enum (pdf/fax/image/electronic).
        // The extractor's document_info.document_type is a clinical document KIND
        // (e.g. "clinical_record"), so only adopt it when it happens to be a valid
        // format value; otherwise default to "electronic" for an uploaded document.
        const REFERRAL_DOC_TYPES = ["pdf", "fax", "image", "electronic"];
        const referralData = {
          patient_id: patientId,
          referral_source: extractedData.document_info?.source_facility || "Document Upload",
          diagnosis: extractedData.clinical?.primary_diagnosis || "",
          priority: URGENCY_TO_PRIORITY[assessUrgency(extractedData)] || "normal",
          status: "new",
          referral_date: todayEastern(),
          document_type: REFERRAL_DOC_TYPES.includes(extractedData.document_info?.document_type)
            ? extractedData.document_info.document_type
            : "electronic",
          extracted_data: {
            chief_complaint: extractedData.clinical?.chief_complaint || "",
            secondary_diagnoses: extractedData.clinical?.secondary_diagnoses || [],
            vitals: extractedData.vitals || {},
            medications: extractedData.clinical?.current_medications || [],
            allergies: extractedData.clinical?.allergies || "",
            ai_extracted: true,
            confidence_score: extractedData.document_info?.confidence_score || 0,
          },
        };

        const referral = await base44.entities.Referral.create(referralData);

        // Refresh the lists this just changed so a newly created patient appears
        // in the "Update Existing Patient" dropdown and app-wide patient/referral lists.
        queryClient.invalidateQueries({ queryKey: ['patients'] });
        queryClient.invalidateQueries({ queryKey: ['referrals'] });

        setResult({
          success: true,
          patientId,
          referralId: referral.id,
          message: `Document processed successfully. Patient ${mapping.createPatient ? "created" : "updated"} and triage initiated.`
        });

        if (onTriageCreated) {
          onTriageCreated({ patientId, referralId: referral.id, extractedData });
        }
      } else if ((mapping.createTriage || mapping.createReferral) && !patientId) {
        // Referral/triage was requested but no patient could be resolved — don't
        // stop silently with no feedback.
        setError("No patient record was available to attach the referral to. Select or create a patient first.");
      }
    } catch (err) {
      setError(err.message || "Failed to process document mapping");
      console.error(err);
    } finally {
      setProcessing(false);
    }
  };

  const assessUrgency = (data) => {
    const vitals = data.vitals || {};
    const clinical = data.clinical || {};

    // Check critical vitals
    if (vitals.heart_rate > 120 || vitals.heart_rate < 50) return "urgent";
    if (vitals.blood_pressure_systolic > 180 || vitals.blood_pressure_systolic < 90) return "urgent";
    if (vitals.oxygen_saturation < 90) return "urgent";
    if (vitals.respiratory_rate > 30) return "urgent";
    if (vitals.temperature > 103 || vitals.temperature < 95) return "urgent";

    // Check concerning diagnoses
    const urgentDiags = [
      "sepsis", "stroke", "mi", "pneumonia", "acute", "crisis",
      "cardiac", "respiratory", "hemorrhage", "trauma"
    ];
    const allDiags = [
      clinical.primary_diagnosis,
      ...( clinical.secondary_diagnoses || [])
    ].join(" ").toLowerCase();

    if (urgentDiags.some(d => allDiags.includes(d))) return "high";

    return vitals.pain_level > 7 ? "high" : "routine";
  };

  if (result?.success) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="w-6 h-6 text-green-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-bold text-green-800 text-lg">{result.message}</h3>
            <div className="mt-3 space-y-1 text-sm">
              <p className="text-slate-600">
                Patient ID: <span className="font-mono font-semibold">{result.patientId.substring(0, 8)}...</span>
              </p>
              <p className="text-slate-600">
                Referral ID: <span className="font-mono font-semibold">{result.referralId.substring(0, 8)}...</span>
              </p>
            </div>
            <div className="mt-4 flex gap-2">
              <Button
                onClick={() => {
                  setExtractedData(null);
                  setMapping({
                    createPatient: false,
                    updatePatient: false,
                    patientId: null,
                    createTriage: false,
                    createReferral: false
                  });
                  setResult(null);
                }}
                size="sm"
              >
                Process Another Document
              </Button>
              {result.patientId && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/PatientDetails?id=${result.patientId}`)}
                >
                  View Patient <ArrowRight className="w-3 h-3 ml-1" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <DocumentIngestionUploader onDataExtracted={handleDataExtracted} />

      {extractedData && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-4">
          <div>
            <h3 className="font-semibold text-slate-900 mb-3">Map to Patient & Workflow</h3>

            <div className="space-y-2">
              <label htmlFor="triage-action-create" className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer">
                <input
                  id="triage-action-create"
                  type="radio"
                  name="action"
                  checked={mapping.createPatient}
                  onChange={() =>
                    setMapping({
                      ...mapping,
                      createPatient: true,
                      updatePatient: false,
                      patientId: null
                    })
                  }
                  className="w-4 h-4"
                />
                <div className="font-medium text-slate-900">
                  Create New Patient
                  <p className="text-xs font-normal text-slate-500">
                    {extractedData.patient?.first_name} {extractedData.patient?.last_name}
                  </p>
                </div>
              </label>

              <label htmlFor="triage-action-update" className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer">
                <input
                  id="triage-action-update"
                  type="radio"
                  name="action"
                  checked={mapping.updatePatient}
                  onChange={() =>
                    setMapping({
                      ...mapping,
                      createPatient: false,
                      updatePatient: true
                    })
                  }
                  className="w-4 h-4"
                />
                <div className="font-medium text-slate-900">
                  Update Existing Patient
                  <p className="text-xs font-normal text-slate-500">
                    (Select patient from dropdown)
                  </p>
                </div>
              </label>
            </div>

            {mapping.updatePatient && (
              <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
                <p className="text-xs font-medium text-slate-700">
                  Select an existing patient to map clinical data
                </p>
                <SearchablePatientSelect
                  patients={patients}
                  value={mapping.patientId}
                  onValueChange={(patientId) => {
                    setMapping((prev) => ({ ...prev, patientId }));
                    setIdentityConfirmed(false);
                    setError(null);
                  }}
                  placeholder="Search and select patient..."
                />
                {!mapping.patientId && (
                  <p className="text-xs text-amber-600">
                    A patient must be selected before clinical data can be mapped.
                  </p>
                )}
                {identityCheck?.verdict === "mismatch" && (
                  <div className="p-2 bg-red-50 border border-red-300 rounded space-y-2">
                    <p className="text-xs font-semibold text-red-900">
                      ⚠️ The document's patient does not match this chart:
                    </p>
                    <ul className="text-xs text-red-800 list-disc pl-4">
                      {identityCheck.conflicts.map((c, i) => (
                        <li key={i}>Conflicting {c}</li>
                      ))}
                    </ul>
                    <label className="flex items-start gap-2 text-xs text-red-900">
                      <input
                        type="checkbox"
                        checked={identityConfirmed}
                        onChange={(e) => setIdentityConfirmed(e.target.checked)}
                        className="mt-0.5"
                      />
                      I verified this document belongs to the selected patient (name change,
                      chart correction, or extraction error) and take responsibility for this update.
                    </label>
                  </div>
                )}
                {identityCheck?.verdict === "unverifiable" && (
                  <p className="text-xs text-amber-600">
                    The document's patient identity could not be compared to this chart (no
                    name/DOB extracted) — double-check the selection before proceeding.
                  </p>
                )}
              </div>
            )}

            <div className="mt-4 pt-4 border-t border-slate-200">
              <p className="text-xs font-semibold text-slate-700 mb-2">Workflow Actions</p>
              <label className="flex items-center gap-3 p-2">
                <input
                  type="checkbox"
                  checked={mapping.createTriage}
                  onChange={(e) =>
                    setMapping({ ...mapping, createTriage: e.target.checked })
                  }
                  className="w-4 h-4"
                />
                <span className="text-sm text-slate-900">Create Triage/Referral</span>
              </label>
            </div>
          </div>

          {extractedData.extraction_notes && (
            <Alert className="border-amber-300 bg-amber-50">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <AlertDescription className="text-amber-800 text-xs">
                {extractedData.extraction_notes}
              </AlertDescription>
            </Alert>
          )}

          <div className="flex gap-2 pt-2 border-t border-slate-200">
            <Button
              onClick={handleProcessMapping}
              disabled={
                processing ||
                (!mapping.createPatient && !mapping.updatePatient) ||
                (mapping.updatePatient && !mapping.patientId) ||
                !mapping.createTriage
              }
              className="flex-1 gap-2"
            >
              {processing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processing…
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Create in System
                </>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setExtractedData(null);
                setMapping({
                  createPatient: false,
                  updatePatient: false,
                  patientId: null,
                  createTriage: false,
                  createReferral: false
                });
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && (
        <Alert className="border-red-300 bg-red-50">
          <AlertTriangle className="w-4 h-4 text-red-600" />
          <AlertDescription className="text-red-800">
            {error}
            {duplicateWarning && !duplicateWarning.confirmed && (
              <Button
                size="sm"
                variant="outline"
                className="mt-2 block"
                onClick={() => {
                  setDuplicateWarning((prev) => ({ ...prev, confirmed: true }));
                  setError(null);
                }}
              >
                These are different patients — create a new chart anyway
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}