import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAuthorizedReferral } from '@/functions/manageAuthorizedReferral';
import { useAuth } from '@/lib/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, Sparkles, FileText } from "lucide-react";
import { Link } from "react-router";
import { createPageUrl } from "@/utils";
import {
  assertTenantSdkRealmLeaseCurrent,
  captureTenantSdkRealmLease,
} from '@/lib/tenantSdkRealmGate';

/** Include a labeled line only when `value` is a non-empty string. */
function labeled(label, value) {
  const v = String(value || '').trim();
  return v ? `${label}: ${v}` : '';
}

/**
 * Build the Smart Note rough-draft seed from referral extraction.
 * Omits clinical sections the referral never stated so presence detection
 * cannot treat filler as documentation.
 */
export function buildAdmissionRoughNote(data = {}) {
  const meds = Array.isArray(data.medications)
    ? data.medications
        .map((m) => `- ${m?.name || ''} ${m?.dosage || ''} ${m?.frequency || ''}`.trim())
        .filter((line) => line.length > 2)
    : [];
  const functionalLines = [
    labeled('Ambulation', data.functional_status?.ambulation),
    labeled('ADLs', data.functional_status?.adl_status),
    labeled('Fall Risk', data.functional_status?.fall_risk),
    labeled('Cognitive Status', data.functional_status?.cognitive_status),
  ].filter(Boolean);
  const clinicalLines = [
    labeled('Recent Vitals', data.clinical_info?.vital_signs),
    labeled('Weight', data.clinical_info?.weight),
    labeled('Wounds', data.functional_status?.wounds),
    labeled('Pain', data.functional_status?.pain),
  ].filter(Boolean);
  const skilledLines = [
    Array.isArray(data.skilled_needs?.services_ordered) && data.skilled_needs.services_ordered.length
      ? `Services Ordered: ${data.skilled_needs.services_ordered.join(', ')}`
      : '',
    labeled('Frequency', data.skilled_needs?.frequency_duration),
    labeled('Goals', data.skilled_needs?.goals_of_care),
  ].filter(Boolean);
  const safety = Array.isArray(data.safety_concerns?.high_risk_conditions)
    ? data.safety_concerns.high_risk_conditions.filter(Boolean).join(', ')
    : '';
  const psychoLines = [
    labeled('Caregiver', data.psychosocial?.caregiver_info),
    labeled('Mental Health', data.psychosocial?.mental_health),
  ].filter(Boolean);
  const orders = Array.isArray(data.orders_treatments?.physician_orders)
    ? data.orders_treatments.physician_orders.filter(Boolean).join('\n')
    : '';

  const section = (title, lines) => {
    const body = (Array.isArray(lines) ? lines : [lines]).filter(Boolean);
    return body.length ? `${title}\n${body.join('\n')}` : '';
  };

  const sections = [
    'ADMISSION NOTE - From Referral',
    section('PATIENT INFORMATION:', [
      data.demographics?.full_name || 'Unknown',
      labeled('DOB', data.demographics?.date_of_birth),
      labeled('Address', data.demographics?.address),
      labeled('Phone', data.demographics?.phone),
    ]),
    section('INSURANCE:', [labeled('Primary', data.demographics?.insurance_primary)]),
    section('EMERGENCY CONTACT:', [
      data.demographics?.emergency_contact || '',
      labeled('Phone', data.demographics?.emergency_phone),
    ]),
    section('ADMISSION DETAILS:', [
      labeled('Admission Source', data.admission_details?.admission_source),
      labeled('Referral From', data.demographics?.referring_physician),
      labeled('Referral Reason', data.admission_details?.referral_reason),
    ]),
    section('DIAGNOSES:', [
      labeled('Primary', data.diagnoses?.primary_diagnosis),
      labeled('PDGM Group', data.diagnoses?.pdgm_clinical_group),
      Array.isArray(data.diagnoses?.secondary_diagnoses) && data.diagnoses.secondary_diagnoses.length
        ? `Secondary: ${data.diagnoses.secondary_diagnoses.join(', ')}`
        : '',
    ]),
    data.diagnoses?.allergies
      ? `ALLERGIES:\n${String(data.diagnoses.allergies).trim()}`
      : '',
    meds.length ? `CURRENT MEDICATIONS:\n${meds.join('\n')}` : '',
    functionalLines.length ? `FUNCTIONAL STATUS:\n${functionalLines.join('\n')}` : '',
    clinicalLines.length ? `CLINICAL INFORMATION:\n${clinicalLines.join('\n')}` : '',
    skilledLines.length ? `SKILLED NEEDS:\n${skilledLines.join('\n')}` : '',
    safety ? `SAFETY CONCERNS:\n${safety}` : '',
    psychoLines.length ? `PSYCHOSOCIAL:\n${psychoLines.join('\n')}` : '',
    orders ? `ORDERS & TREATMENTS:\n${orders}` : '',
  ].filter(Boolean);

  return sections.join('\n\n');
}

export default function ReferralAdmissionNote() {
  const { tenantContext } = useAuth();
  const urlParams = new URLSearchParams(window.location.search);
  const referralId = urlParams.get('referral_id');
  const [prepopulatedData, setPrepopulatedData] = useState(null);

  const { data: referral, isLoading, isError: referralUnavailable } = useQuery({
    queryKey: ['referrals', 'authorized', tenantContext?.agency_id, referralId],
    queryFn: async () => {
      if (!referralId) return null;
      const result = await getAuthorizedReferral({
        agencyId: tenantContext.agency_id,
        referralId,
      });
      return result.referral;
    },
    enabled: !!referralId && !!tenantContext?.agency_id
  });

  useEffect(() => {
    if (referral?.extracted_data) {
      let lease;
      try {
        lease = captureTenantSdkRealmLease();
        assertTenantSdkRealmLeaseCurrent(lease);
      } catch {
        return;
      }
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
        
        // Build the admission seed from referral data. Clinical sections that
        // the referral did not state are OMITTED — never filled with
        // "Not assessed" / "None documented" / "NKDA". Those fillers used to
        // satisfy Smart Note presence checks so the nurse was never asked and
        // invented absences rode into the chart.
        roughNote: buildAdmissionRoughNote(data),
        
        referralData: data
      };
      
      assertTenantSdkRealmLeaseCurrent(lease);
      setPrepopulatedData(prepopulated);
      // Stash the prepopulation payload in authority-purged sessionStorage
      // instead of serializing PHI into a URL query string, where it would leak
      // into browser history, proxy/access logs, and Referer headers.
      try {
        if (referral.id) {
          assertTenantSdkRealmLeaseCurrent(lease);
          sessionStorage.setItem(`referral_prepopulate:${referral.id}`, JSON.stringify({
            ...prepopulated,
            // Keep patient identity out of the navigation URL. The Smart Note
            // route reads it from this authority-purged record.
            patientId: referral.patient_id || '',
            visitType: 'admission',
          }));
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

  if (referralUnavailable) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <Alert className="bg-red-50 border-red-300">
          <AlertDescription className="text-red-900">
            Referral access could not be authorized. No referral data is being shown.
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

      {/* Descendant browsing contexts are unavailable at this security
          checkpoint. Continue in the same protected application realm. */}
      {prepopulatedData && (
        <div className="bg-white rounded-lg shadow-lg p-6">
          <Alert className="mb-4 bg-amber-50 border-amber-300">
            <AlertDescription className="text-amber-950">
              Embedded clinical workspaces are disabled. Continue to Smart Note
              in this tab to preserve the active workspace privacy boundary.
            </AlertDescription>
          </Alert>
          <Link
            to={createPageUrl(`SmartNoteAssistant?visit_type=admission&referral_mode=true&referral_id=${encodeURIComponent(referral.id)}`)}
          >
            <Button>Continue to Smart Note</Button>
          </Link>
        </div>
      )}
    </div>
  );
}
