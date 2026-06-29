import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import ReferralPDFSummarizer from "@/components/referral/ReferralPDFSummarizer";
import ReferralAnalyzer from "@/components/referral/ReferralAnalyzer";
import AIAdmissionDocumentationAssistant from "@/components/clinical/AIAdmissionDocumentationAssistant";
import AIGeneratedOASISAssessment from "@/components/oasis/AIGeneratedOASISAssessment";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FileText, UserPlus, ArrowRight, TrendingUp, Sparkles, Target, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from 'sonner';

export default function ReferralProcessor() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [extractedData, setExtractedData] = useState(null);
  const [_referralAnalysis, setReferralAnalysis] = useState(null);
  const [isCreatingPatient, setIsCreatingPatient] = useState(false);
  const [diagnosisRanking, setDiagnosisRanking] = useState(null);
  const [isRankingDiagnoses, setIsRankingDiagnoses] = useState(false);
  const [selectedPrimaryDx, setSelectedPrimaryDx] = useState(null);
  const [selectedSecondaryDx, _setSelectedSecondaryDx] = useState([]);
  const [isCreatingCarePlans, setIsCreatingCarePlans] = useState(false);
  const [createdPatientId, setCreatedPatientId] = useState(null);
  const [createdCarePlans, setCreatedCarePlans] = useState(null);

  const rankDiagnoses = async () => {
    if (!extractedData?.diagnoses) return;

    setIsRankingDiagnoses(true);
    try {
      const diagnosesList = [
        extractedData.diagnoses.primary_diagnosis,
        ...(extractedData.diagnoses.secondary_diagnoses || [])
      ].filter(Boolean);

      const { data } = await base44.functions.invoke('rankDiagnosesByPDGM', {
        diagnoses: diagnosesList,
        patient_data: extractedData
      });

      setDiagnosisRanking(data);
      
      // Auto-select the optimal diagnosis
      if (data.optimal_primary_diagnosis) {
        setSelectedPrimaryDx(data.optimal_primary_diagnosis);
      }
    } catch (error) {
      console.error('Error ranking diagnoses:', error);
      toast.error('Failed to rank diagnoses. Please try again.');
    }
    setIsRankingDiagnoses(false);
  };

  const createPatientFromReferral = async () => {
    if (!extractedData) return;

    setIsCreatingPatient(true);
    try {
      // Parse patient name intelligently from extracted data
      const fullName = extractedData.demographics?.full_name || '';
      const nameParts = fullName.trim().split(/\s+/);
      const firstName = nameParts[0] || 'Unknown';
      const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : 'Unknown';

      const patientData = {
        first_name: firstName,
        last_name: lastName,
        date_of_birth: extractedData.demographics?.date_of_birth || null,
        address: extractedData.demographics?.address || null,
        phone: extractedData.demographics?.phone || null,
        email: null,
        emergency_contact_name: extractedData.demographics?.emergency_contact || null,
        emergency_contact_phone: extractedData.demographics?.emergency_phone || null,
        emergency_contact_relationship: extractedData.demographics?.emergency_relationship || null,
        physician_name: extractedData.demographics?.primary_care_physician || extractedData.demographics?.referring_physician || null,
        physician_phone: extractedData.demographics?.pcp_contact || extractedData.demographics?.referring_physician_contact || null,
        primary_diagnosis: selectedPrimaryDx || extractedData.diagnoses?.primary_diagnosis || null,
        secondary_diagnoses: selectedSecondaryDx.length > 0 ? selectedSecondaryDx : (extractedData.diagnoses?.secondary_diagnoses || []),
        allergies: extractedData.diagnoses?.allergies || null,
        current_medications: extractedData.medications || [],
        admission_date: extractedData.admission_details?.admission_date || new Date().toISOString().split('T')[0],
        admission_source: extractedData.admission_details?.admission_source || 'home',
        care_type: 'home_health',
        status: 'active'
      };

      const newPatient = await base44.entities.Patient.create(patientData);
      setCreatedPatientId(newPatient.id);
      queryClient.invalidateQueries({ queryKey: ['patients'] });

      toast.success('Patient created successfully!');
      // Return the new id so callers (generateCarePlans) can use it immediately
      // — setCreatedPatientId is async and the captured createdPatientId is still
      // stale within the same tick.
      return newPatient.id;
    } catch (error) {
      console.error('Error creating patient:', error);
      toast.error('Failed to create patient. Please try again or create manually.');
    } finally {
      setIsCreatingPatient(false);
    }
  };

  const generateCarePlans = async () => {
    if (!createdPatientId && !extractedData) return;

    setIsCreatingCarePlans(true);
    try {
      // If no patient created yet, create one first
      let patientId = createdPatientId;
      if (!patientId) {
        patientId = await createPatientFromReferral();
      }

      if (!patientId) {
        throw new Error('Failed to create patient');
      }

      const { data } = await base44.functions.invoke('generateCarePlansFromReferral', {
        patient_id: patientId,
        referral_data: extractedData,
        primary_diagnosis: selectedPrimaryDx || extractedData.diagnoses?.primary_diagnosis,
        secondary_diagnoses: selectedSecondaryDx.length > 0 ? selectedSecondaryDx : extractedData.diagnoses?.secondary_diagnoses
      });

      setCreatedCarePlans(data);
      queryClient.invalidateQueries({ queryKey: ['carePlans'] });

      toast.success(`Successfully created ${data.care_plans_created} care plans!`);
    } catch (error) {
      console.error('Error generating care plans:', error);
      toast.error('Failed to generate care plans. Please try again.');
    }
    setIsCreatingCarePlans(false);
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
          onDataExtracted={(data) => setExtractedData(data)}
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

            {/* PDGM Diagnosis Ranking */}
            <Card className="border-2 border-navy-300 bg-navy-50">
              <CardContent className="p-3 sm:p-4 md:p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base sm:text-lg font-semibold text-navy-900 flex items-center gap-2">
                    <TrendingUp className="w-5 h-5" />
                    PDGM Diagnosis Optimization
                  </h3>
                  <Button
                    onClick={rankDiagnoses}
                    disabled={isRankingDiagnoses}
                    size="sm"
                    className="bg-navy-600 hover:bg-navy-700"
                  >
                    {isRankingDiagnoses ? (
                      <>
                        <Sparkles className="w-4 h-4 mr-2 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <TrendingUp className="w-4 h-4 mr-2" />
                        Rank by Reimbursement
                      </>
                    )}
                  </Button>
                </div>

                {diagnosisRanking && (
                  <div className="space-y-4">
                    <Alert className="bg-indigo-50 border-indigo-300">
                      <AlertDescription>
                        <p className="font-semibold text-indigo-900 mb-1">Optimal Primary Diagnosis:</p>
                        <p className="text-sm text-indigo-800">{diagnosisRanking.optimal_primary_diagnosis}</p>
                      </AlertDescription>
                    </Alert>

                    <div className="space-y-3">
                      {diagnosisRanking.ranked_diagnoses?.map((dx, idx) => (
                        <div
                          key={idx}
                          className={`border-2 rounded-lg p-3 cursor-pointer transition-all ${
                            selectedPrimaryDx === dx.diagnosis
                              ? 'border-navy-600 bg-navy-100'
                              : 'border-navy-200 bg-white hover:border-navy-400'
                          }`}
                          onClick={() => setSelectedPrimaryDx(dx.diagnosis)}
                        >
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge className="bg-navy-600 text-white">#{dx.rank}</Badge>
                                <Badge className={`${
                                  dx.reimbursement_tier === 'High' ? 'bg-green-600' :
                                  dx.reimbursement_tier === 'Medium' ? 'bg-yellow-600' :
                                  'bg-slate-600'
                                } text-white`}>
                                  {dx.reimbursement_tier}
                                </Badge>
                                <span className="text-xs text-slate-600">{dx.estimated_payment_range}</span>
                              </div>
                              <p className="font-semibold text-slate-900">{dx.diagnosis}</p>
                            </div>
                            {selectedPrimaryDx === dx.diagnosis && (
                              <CheckCircle2 className="w-5 h-5 text-navy-600 flex-shrink-0" />
                            )}
                          </div>

                          <div className="space-y-2 text-sm">
                            <div>
                              <p className="font-semibold text-slate-900">PDGM Group: {dx.pdgm_clinical_group}</p>
                            </div>

                            <div>
                              <p className="font-semibold text-slate-700">Key Factors:</p>
                              <ul className="ml-4 space-y-1">
                                {dx.key_factors?.map((factor, fidx) => (
                                  <li key={fidx} className="text-slate-600">• {factor}</li>
                                ))}
                              </ul>
                            </div>

                            {dx.documentation_requirements?.length > 0 && (
                              <div>
                                <p className="font-semibold text-slate-700">Documentation Required:</p>
                                <ul className="ml-4 space-y-1">
                                  {dx.documentation_requirements.map((req, ridx) => (
                                    <li key={ridx} className="text-slate-600">• {req}</li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            <p className="text-slate-600 italic">{dx.rationale}</p>
                          </div>
                        </div>
                      ))}
                    </div>

                    {diagnosisRanking.pdgm_optimization_tips?.length > 0 && (
                      <Alert className="bg-blue-50 border-blue-300">
                        <AlertDescription>
                          <p className="font-semibold text-blue-900 mb-2 flex items-center gap-2"><Sparkles className="w-4 h-4" /> PDGM Optimization Tips:</p>
                          <ul className="space-y-1">
                            {diagnosisRanking.pdgm_optimization_tips.map((tip, idx) => (
                              <li key={idx} className="text-sm text-blue-800">• {tip}</li>
                            ))}
                          </ul>
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                )}
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

            {/* Care Plan Generation */}
            {diagnosisRanking && selectedPrimaryDx && (
              <Card className="border-2 border-teal-300 bg-teal-50">
                <CardContent className="p-3 sm:p-4 md:p-6">
                  <h3 className="text-base sm:text-lg font-semibold text-teal-900 mb-3 flex items-center gap-2">
                    <Target className="w-5 h-5" />
                    Auto-Generate Care Plans
                  </h3>
                  
                  {!createdCarePlans ? (
                    <div className="space-y-3">
                      <Alert className="bg-white border-teal-300">
                        <AlertDescription className="text-sm text-slate-700">
                          Generate comprehensive, Medicare-compliant care plans based on the selected diagnosis and referral data.
                        </AlertDescription>
                      </Alert>
                      <Button
                        onClick={generateCarePlans}
                        disabled={isCreatingCarePlans || isCreatingPatient}
                        className="bg-teal-600 hover:bg-teal-700 w-full min-h-[44px]"
                      >
                        {isCreatingCarePlans ? (
                          <>
                            <Sparkles className="w-4 h-4 mr-2 animate-spin" />
                            Generating Care Plans...
                          </>
                        ) : (
                          <>
                            <Target className="w-4 h-4 mr-2" />
                            Generate Care Plans
                          </>
                        )}
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <Alert className="bg-green-50 border-green-300">
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                        <AlertDescription>
                          <p className="font-semibold text-green-900">
                            Successfully created {createdCarePlans.care_plans_created} care plans!
                          </p>
                        </AlertDescription>
                      </Alert>

                      <div className="space-y-2">
                        {createdCarePlans.care_plans?.map((cp, idx) => (
                          <div key={idx} className="bg-white border border-teal-200 rounded p-3">
                            <p className="font-semibold text-slate-900 mb-1">{cp.problem}</p>
                            <p className="text-sm text-slate-700 mb-2">Goal: {cp.goal}</p>
                            <div className="flex gap-2">
                              <Badge className="bg-teal-600 text-white text-xs">{cp.status}</Badge>
                              <Badge variant="outline" className="text-xs">
                                Target: {new Date(cp.target_date).toLocaleDateString()}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>

                      {createdCarePlans.education_priorities?.length > 0 && (
                        <Alert className="bg-blue-50 border-blue-300">
                          <AlertDescription>
                            <p className="font-semibold text-blue-900 mb-1">Education Priorities:</p>
                            <ul className="space-y-1">
                              {createdCarePlans.education_priorities.map((edu, idx) => (
                                <li key={idx} className="text-sm text-blue-800">• {edu}</li>
                              ))}
                            </ul>
                          </AlertDescription>
                        </Alert>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Card className="border-2 border-green-300 bg-green-50">
              <CardContent className="p-3 sm:p-4 md:p-6">
                <h3 className="text-base sm:text-lg font-semibold text-green-900 mb-3 sm:mb-4">Next Steps</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Button
                    onClick={createPatientFromReferral}
                    disabled={isCreatingPatient || createdPatientId}
                    className="bg-green-600 hover:bg-green-700 w-full min-h-[44px]"
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