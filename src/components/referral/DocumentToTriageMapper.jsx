import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, AlertTriangle, Loader2, ArrowRight } from "lucide-react";
import DocumentIngestionUploader from "../documents/DocumentIngestionUploader";
import SearchablePatientSelect from "../ui/SearchablePatientSelect";
import { todayEastern } from "@/components/utils/timezone";

export default function DocumentToTriageMapper({ onTriageCreated }) {
  const queryClient = useQueryClient();
  const { data: patients = [] } = useQuery({
    queryKey: ['patients-for-triage-mapper'],
    queryFn: () => base44.entities.Patient.list('-created_date', 1000),
    initialData: [],
  });

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

  const handleDataExtracted = (data) => {
    setExtractedData(data);
    setError(null);
    setResult(null);
  };

  const handleProcessMapping = async () => {
    if (!extractedData) return;

    setProcessing(true);
    setError(null);
    setResult(null);

    try {
      let patientId = mapping.patientId;

      // Create or update patient
      if (mapping.createPatient && extractedData.patient?.last_name) {
        const patientData = {
          first_name: extractedData.patient.first_name || "Unknown",
          last_name: extractedData.patient.last_name || "Unknown",
          date_of_birth: extractedData.patient.date_of_birth || "",
          medical_record_number: extractedData.patient.medical_record_number || "",
          phone: extractedData.patient.phone || "",
          email: extractedData.patient.email || "",
          address: extractedData.patient.address || "",
          primary_diagnosis: extractedData.clinical?.primary_diagnosis || "",
          secondary_diagnoses: extractedData.clinical?.secondary_diagnoses || [],
          allergies: extractedData.clinical?.allergies || "NKDA",
          current_medications: extractedData.clinical?.current_medications || [],
          baseline_vitals: extractedData.vitals || {},
          status: "active"
        };

        const newPatient = await base44.entities.Patient.create(patientData);
        patientId = newPatient.id;
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
        queryClient.invalidateQueries({ queryKey: ['patients-for-triage-mapper'] });
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
                  onClick={() => {
                    window.location.href = `/patientdetails?id=${result.patientId}`;
                  }}
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
                  onValueChange={(patientId) =>
                    setMapping((prev) => ({ ...prev, patientId }))
                  }
                  placeholder="Search and select patient..."
                />
                {!mapping.patientId && (
                  <p className="text-xs text-amber-600">
                    A patient must be selected before clinical data can be mapped.
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
          <AlertDescription className="text-red-800">{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}