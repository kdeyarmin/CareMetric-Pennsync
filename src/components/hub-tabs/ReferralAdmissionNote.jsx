import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, Sparkles, FileText } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function ReferralAdmissionNote() {
  const urlParams = new URLSearchParams(window.location.search);
  const referralId = urlParams.get('referral_id');
  const [prepopulatedData, setPrepopulatedData] = useState(null);

  const { data: referral, isLoading } = useQuery({
    queryKey: ['referral', referralId],
    queryFn: async () => {
      if (!referralId) return null;
      const refs = await base44.entities.Referral.filter({ id: referralId });
      return refs[0];
    },
    enabled: !!referralId
  });

  useEffect(() => {
    if (referral?.extracted_data) {
      // Format extracted data for Smart Note prepopulation with granular sections
      const data = referral.extracted_data;
      const prepopulated = {
        patientId: referral.patient_id,
        patientName: data.demographics?.full_name,
        visitType: 'admission',
        diagnosis: data.diagnoses?.primary_diagnosis,
        
        // Granular structured data for specific sections
        medications: data.medications || [],
        allergies: data.diagnoses?.allergies,
        diagnoses: {
          primary: data.diagnoses?.primary_diagnosis,
          secondary: data.diagnoses?.secondary_diagnoses || [],
          pdgm_group: data.diagnoses?.pdgm_clinical_group
        },
        vitalSigns: data.clinical_info?.vital_signs,
        functionalStatus: data.functional_status,
        safetyRisks: data.safety_concerns?.high_risk_conditions || [],
        skilledNeeds: data.skilled_needs,
        referralContext: {
          source: data.admission_details?.admission_source,
          physician: data.demographics?.referring_physician,
          reason: data.admission_details?.referral_reason,
          priority: referral.analysis_results?.priority_analysis?.priority
        },
        
        // Build comprehensive note from referral data
        roughNote: `ADMISSION NOTE - From Referral

PATIENT INFORMATION:
${data.demographics?.full_name || 'Unknown'}
DOB: ${data.demographics?.date_of_birth || 'Not documented'}
${data.demographics?.address ? `Address: ${data.demographics.address}` : ''}
${data.demographics?.phone ? `Phone: ${data.demographics.phone}` : ''}

INSURANCE:
Primary: ${data.demographics?.insurance_primary || 'Not documented'}

EMERGENCY CONTACT:
${data.demographics?.emergency_contact || 'Not documented'}
${data.demographics?.emergency_phone ? `Phone: ${data.demographics.emergency_phone}` : ''}

ADMISSION DETAILS:
Admission Source: ${data.admission_details?.admission_source || 'Not documented'}
Referral From: ${data.demographics?.referring_physician || 'Not documented'}
Referral Reason: ${data.admission_details?.referral_reason || 'Not documented'}

DIAGNOSES:
Primary: ${data.diagnoses?.primary_diagnosis || 'Not documented'}
${data.diagnoses?.pdgm_clinical_group ? `PDGM Group: ${data.diagnoses.pdgm_clinical_group}` : ''}
${data.diagnoses?.secondary_diagnoses?.length > 0 ? `Secondary: ${data.diagnoses.secondary_diagnoses.join(', ')}` : ''}

ALLERGIES:
${data.diagnoses?.allergies || 'None documented'}

CURRENT MEDICATIONS:
${data.medications?.map(m => `- ${m.name} ${m.dosage || ''} ${m.frequency || ''}`).join('\n') || 'None documented'}

FUNCTIONAL STATUS:
Ambulation: ${data.functional_status?.ambulation || 'Not assessed'}
ADLs: ${data.functional_status?.adl_status || 'Not assessed'}
Fall Risk: ${data.functional_status?.fall_risk || 'Not assessed'}
Cognitive Status: ${data.functional_status?.cognitive_status || 'Not assessed'}

CLINICAL INFORMATION:
${data.clinical_info?.vital_signs ? `Recent Vitals: ${data.clinical_info.vital_signs}` : ''}
${data.clinical_info?.weight ? `Weight: ${data.clinical_info.weight}` : ''}
${data.functional_status?.wounds ? `Wounds: ${data.functional_status.wounds}` : ''}
${data.functional_status?.pain ? `Pain: ${data.functional_status.pain}` : ''}

SKILLED NEEDS:
Services Ordered: ${data.skilled_needs?.services_ordered?.join(', ') || 'To be determined'}
${data.skilled_needs?.frequency_duration ? `Frequency: ${data.skilled_needs.frequency_duration}` : ''}
${data.skilled_needs?.goals_of_care ? `Goals: ${data.skilled_needs.goals_of_care}` : ''}

SAFETY CONCERNS:
${data.safety_concerns?.high_risk_conditions?.join(', ') || 'None noted'}

PSYCHOSOCIAL:
${data.psychosocial?.caregiver_info ? `Caregiver: ${data.psychosocial.caregiver_info}` : ''}
${data.psychosocial?.mental_health ? `Mental Health: ${data.psychosocial.mental_health}` : ''}

ORDERS & TREATMENTS:
${data.orders_treatments?.physician_orders?.join('\n') || 'To be clarified with physician'}`,
        
        referralData: data
      };
      
      setPrepopulatedData(prepopulated);
      // Stash the prepopulation payload in sessionStorage (same-origin, cleared
      // on tab close) instead of serializing PHI into the iframe URL query
      // string, where it would leak into browser history, proxy/access logs,
      // and Referer headers.
      try {
        if (referral.id) {
          sessionStorage.setItem(`referral_prepopulate:${referral.id}`, JSON.stringify(prepopulated));
        }
      } catch { /* ignore storage quota */ }
    }
  }, [referral]);

  if (isLoading) {
    return (
      <div className="p-8 text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
        <p className="text-slate-600">Loading referral data...</p>
      </div>
    );
  }

  if (!referral) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <Alert className="bg-red-50 border-red-300">
          <AlertDescription className="text-red-900">
            Referral not found. Please return to the referral intake page.
          </AlertDescription>
        </Alert>
        <Link to={createPageUrl('ReferralIntake')}>
          <Button className="mt-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Referral Intake
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="mb-6">
        <Link to={createPageUrl('ReferralIntake')}>
          <Button variant="outline" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Referral Intake
          </Button>
        </Link>
      </div>

      <Card className="mb-6 border-2 border-navy-300 bg-navy-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-navy-600" />
            Admission Note from Referral
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert className="bg-blue-50 border-blue-300 mb-4">
            <AlertDescription className="text-blue-900">
              This Smart Note has been prepopulated with all available information from the referral. 
              Review and complete the admission documentation below.
            </AlertDescription>
          </Alert>
          
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              <strong>Patient:</strong> {referral.patient_name || 'Unknown'}
            </p>
            <p className="text-sm text-slate-700">
              <strong>Referral Source:</strong> {referral.referral_source || 'N/A'}
            </p>
            {referral.extracted_data && (
              <p className="text-sm text-green-700 flex items-center gap-1">
                <FileText className="w-4 h-4" />
                Referral processed with AI analysis - all data extracted
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Smart Note Component */}
      {prepopulatedData && (
        <div className="bg-white rounded-lg shadow-lg p-6">
          <iframe
            src={createPageUrl(`SmartNoteAssistant?patient_id=${referral.patient_id}&visit_type=admission&referral_mode=true&referral_id=${encodeURIComponent(referral.id)}`)}
            className="w-full h-[800px] border-0"
            title="Smart Note Assistant"
          />
        </div>
      )}
    </div>
  );
}