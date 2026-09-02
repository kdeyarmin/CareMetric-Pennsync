import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { toLocalISODate } from "@/lib/dateLocal";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { createPageUrl } from "@/utils";
import ReferralPDFSummarizer from "@/components/referral/ReferralPDFSummarizer";
import ReferralAnalyzer from "@/components/referral/ReferralAnalyzer";
import AdmissionBriefEmailCard from "@/components/referral/AdmissionBriefEmailCard";
import ClinicalManagerBriefCard from "@/components/referral/ClinicalManagerBriefCard";
import ProviderFaxRequestCard from "@/components/referral/ProviderFaxRequestCard";
import FinancialGate from "@/components/ui/FinancialGate";
import { generateDiagnosisCodes, codeLabel } from "@/components/referral/diagnosisCodeGenerator";
import { referralPatientReadiness } from "@/components/referral/referralPatientReadiness";
import AIAdmissionDocumentationAssistant from "@/components/clinical/AIAdmissionDocumentationAssistant";
import AIGeneratedOASISAssessment from "@/components/oasis/AIGeneratedOASISAssessment";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FileText, UserPlus, ArrowRight, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from 'sonner';

export default function ReferralProcessor() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [extractedData, setExtractedData] = useState(null);
  const [referralAnalysis, setReferralAnalysis] = useState(null);
  // Source referral file + generated admission packet, for the nurse briefing email.
  const [sourceFile, setSourceFile] = useState(null);
  const [packetUrl, setPacketUrl] = useState(null);
  // The AI-generated admission narrative (from the note generator inside the
  // summarizer), embedded into the nurse briefing email when available.
  const [admissionNote, setAdmissionNote] = useState("");
  const [isCreatingPatient, setIsCreatingPatient] = useState(false);
  const [selectedSecondaryDx, _setSelectedSecondaryDx] = useState([]);
  const [createdPatientId, setCreatedPatientId] = useState(null);

  const createPatientFromReferral = async () => {
    if (!extractedData) return;

    setIsCreatingPatient(true);
    try {
      // Deterministic PDGM-sequenced coding from the referral (codes only
      // ever harvested from the referral, never generated) — the default
      // diagnosis set when the user hasn't hand-picked one above.
      let coding = null;
      try {
        const me = await base44.auth.me().catch(() => null);
        const { fetchCallerPdgmRateConfig } = await import('@/lib/agencySettings');
        const rateRow = await fetchCallerPdgmRateConfig(me?.agency_name);
        coding = generateDiagnosisCodes(extractedData, {
          rates: rateRow?.rates,
          icdGroups: rateRow?.icd10_clinical_groups,
        });
      } catch {
        coding = generateDiagnosisCodes(extractedData);
      }

      // Same readiness gate as triage/intake — never mint "Doe," / "Unknown" charts.
      const readiness = referralPatientReadiness({
        patient_name: extractedData.demographics?.full_name,
        full_name: extractedData.demographics?.full_name,
        date_of_birth: extractedData.demographics?.date_of_birth,
        medical_record_number: extractedData.demographics?.medical_record_number || extractedData.demographics?.mrn,
        phone: extractedData.demographics?.phone,
        address: extractedData.demographics?.address,
      });
      if (!readiness.ready) {
        toast.error(`Cannot create patient chart. Missing: ${readiness.missing.join(', ')}.`);
        return;
      }

      const patientData = {
        first_name: readiness.first_name,
        last_name: readiness.last_name,
        date_of_birth: readiness.identifiers.date_of_birth || null,
        address: readiness.identifiers.address || null,
        phone: readiness.identifiers.phone || null,
        email: null,
        emergency_contact_name: extractedData.demographics?.emergency_contact || null,
        emergency_contact_phone: extractedData.demographics?.emergency_phone || null,
        emergency_contact_relationship: extractedData.demographics?.emergency_relationship || null,
        physician_name: extractedData.demographics?.primary_care_physician || extractedData.demographics?.referring_physician || null,
        physician_phone: extractedData.demographics?.pcp_contact || extractedData.demographics?.referring_physician_contact || null,
        primary_diagnosis:
          (coding?.primary ? codeLabel(coding.primary) : null) ||
          extractedData.diagnoses?.primary_diagnosis ||
          null,
        secondary_diagnoses:
          selectedSecondaryDx.length > 0
            ? selectedSecondaryDx
            : coding?.secondaries?.length
            ? coding.secondaries.map(codeLabel)
            : (extractedData.diagnoses?.secondary_diagnoses || []),
        allergies: extractedData.diagnoses?.allergies || null,
        current_medications: extractedData.medications || [],
        admission_date: extractedData.admission_details?.admission_date || toLocalISODate(),
        admission_source: extractedData.admission_details?.admission_source || 'home',
        care_type: 'home_health',
        status: 'active'
      };

      const newPatient = await base44.entities.Patient.create(patientData);
      setCreatedPatientId(newPatient.id);
      queryClient.invalidateQueries({ queryKey: ['patients'] });

      toast.success('Patient created successfully!');
      // Return the new id so callers can use it immediately — setCreatedPatientId
      // is async and the captured createdPatientId is still stale within the same tick.
      return newPatient.id;
    } catch (error) {
      console.error('Error creating patient:', error);
      toast.error('Failed to create patient. Please try again or create manually.');
    } finally {
      setIsCreatingPatient(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
        <Alert className="bg-gradient-to-r from-blue-50 to-navy-50 border-blue-300">
          <FileText className="w-4 h-4 text-blue-600" />
          <AlertDescription className="text-blue-900">
            <p className="font-semibold mb-2">AI-Powered Referral Processing</p>
            <p className="text-sm mb-1">Upload referrals from any source (PDFs, faxes, scanned documents) to automatically:</p>
            <ul className="text-sm ml-4 space-y-0.5 list-disc">
              <li><strong>Extract & categorize</strong> all patient data with intelligent field mapping</li>
              <li><strong>Flag incomplete information</strong> with actionable prompts for missing data</li>
              <li><strong>Prioritize by urgency</strong> using clinical factors and requested start dates</li>
              <li><strong>Recommend scheduling</strong> and optimal nurse assignments based on skills</li>
            </ul>
          </AlertDescription>
        </Alert>

        <ReferralPDFSummarizer
          onDataExtracted={(data) => {
            setExtractedData(data);
            // A new document supersedes the previous one's analysis/links/note.
            setReferralAnalysis(null);
            setPacketUrl(null);
            setAdmissionNote("");
          }}
          onNoteGenerated={(result) => setAdmissionNote(result?.note || "")}
          onSourceFile={(file) => setSourceFile(file)}
          onExtractionComplete={(_data, _raw, pdfUrl) => setPacketUrl(pdfUrl || null)}
          onUseForAdmission={(_data) => {
            navigate(createPageUrl('SmartNoteAssistant'));
          }}
        />

        {extractedData && (
          <>
            <ReferralAnalyzer
              referralData={extractedData}
              onAnalysisComplete={(analysis) => setReferralAnalysis(analysis)}
            />

            <Card className="border-2 border-amber-300 bg-amber-50">
              <CardContent className="p-3 sm:p-4 md:p-6">
                <div role="alert" className="flex items-start gap-3 text-sm text-amber-950">
                  <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <p className="font-semibold">PDGM diagnosis ranking is unavailable.</p>
                    <p className="mt-1">Diagnoses are not ranked or selected by reimbursement. Use documented clinical evidence and official coding review to choose the primary diagnosis.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {extractedData && (
          <>
            <AIGeneratedOASISAssessment
              referralData={extractedData}
              visitType="Start of Care"
            />

            <AIAdmissionDocumentationAssistant
              referralData={extractedData}
              oasisSuggestions={null}
              patientData={null}
              onSaveSection={() => {
              }}
            />

            {/* Fax the provider one itemized request for everything still
                missing or needing clarification (F2F, orders, coding, …) */}
            <ProviderFaxRequestCard referralData={extractedData} analysis={referralAnalysis} />

            {/* Email the admitting nurse the full briefing + referral documents */}
            <AdmissionBriefEmailCard
              referralData={extractedData}
              analysis={referralAnalysis}
              admissionNote={admissionNote}
              sourceFileUrl={sourceFile?.url || ""}
              packetUrl={packetUrl || ""}
            />

            {/* Revenue brief PDF for the clinical manager — financial data, so
                admin-gated (the card also fails closed internally and the PDGM
                dollars are stripped server-side for non-admin callers). */}
            <FinancialGate>
              <ClinicalManagerBriefCard
                referralData={extractedData}
                analysis={referralAnalysis}
                sourceFileUrl={sourceFile?.url || ""}
                packetUrl={packetUrl || ""}
              />
            </FinancialGate>

            <Card className="border-2 border-green-300 bg-green-50">
              <CardContent className="p-3 sm:p-4 md:p-6">
                <h3 className="text-base sm:text-lg font-semibold text-green-900 mb-3 sm:mb-4">Next Steps</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Button
                    onClick={createPatientFromReferral}
                    disabled={isCreatingPatient || createdPatientId}
                    className="w-full min-h-[44px]"
                  >
                    {createdPatientId ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        Patient Created
                      </>
                    ) : isCreatingPatient ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <UserPlus className="w-4 h-4 mr-2" />
                        <span className="hidden sm:inline">Create Patient Record</span>
                        <span className="sm:hidden">Create Patient</span>
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => navigate(createPageUrl('SmartNoteAssistant'))}
                    className="w-full min-h-[44px]"
                  >
                    <ArrowRight className="w-4 h-4 mr-2" />
                    <span className="hidden sm:inline">Go to Smart Note Assistant</span>
                    <span className="sm:hidden">Smart Notes</span>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}
    </div>
  );
}
