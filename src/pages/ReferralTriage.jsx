import { useState } from 'react';
import { toLocalISODate } from '@/lib/dateLocal';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowRight, CheckCircle2, Clock, AlertCircle, Filter } from 'lucide-react';
import PageContainer from '@/components/ui/PageContainer';
import PageHeader from '@/components/ui/PageHeader';
import ReferralTriageAnalyzer from '../components/referral/ReferralTriageAnalyzer';
import { todayEastern } from '@/components/utils/timezone';
import { toast } from 'sonner';
import { buildIncompleteReferralFromTriage, referralPatientReadiness } from '@/components/referral/referralPatientReadiness';

// Triage urgency levels → Referral.priority enum (low/normal/high/urgent).
const URGENCY_TO_PRIORITY = { CRITICAL: 'urgent', HIGH: 'high', MEDIUM: 'normal', LOW: 'low' };
const URGENCY_TO_TASK_PRIORITY = { CRITICAL: 'high', HIGH: 'high', MEDIUM: 'medium', LOW: 'medium' };

/**
 * AI-Powered Referral Triage Workflow
 * Parse incoming unstructured clinical data to triage and onboard referrals.
 */
export default function ReferralTriage() {
  const queryClient = useQueryClient();
  const [lastAnalysis, setLastAnalysis] = useState(null);
  const [showCreatePatient, setShowCreatePatient] = useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const handleTriageComplete = (analysis) => {
    setLastAnalysis(analysis);
    setShowCreatePatient(true);
  };

  const handleCreatePatientFromTriage = async () => {
    if (!lastAnalysis) return;

    try {
      const readiness = referralPatientReadiness(lastAnalysis);
      const referralPriority = URGENCY_TO_PRIORITY[lastAnalysis.urgency_level] || 'normal';

      if (!readiness.ready) {
        const referral = await base44.entities.Referral.create({
          ...buildIncompleteReferralFromTriage(lastAnalysis, {
            assignedTo: currentUser?.email,
            referralDate: todayEastern(),
          }),
          priority: referralPriority,
        });

        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 1);
        await base44.entities.Task.create({
          title: `Complete referral identity: ${readiness.full_name || lastAnalysis.patient_name || 'Unknown patient'}`,
          description: `Patient chart was not created because required identity data is missing: ${readiness.missing.join(', ')}. Complete the referral before admission.`,
          // 'followup' is the schema's enum value — 'referral_follow_up' is not a
          // member, so Base44 rejected or dropped it, and the task landed with no
          // type at all. What makes this a referral follow-up is the
          // related_entity pair below, not a bespoke type. Matches
          // ALLOWED_TASK_TYPES / safeTaskType() in ProactiveClinicalTaskGenerator,
          // whose fallback for an unclassified task is likewise 'followup'.
          type: 'followup',
          priority: URGENCY_TO_TASK_PRIORITY[lastAnalysis.urgency_level] || 'medium',
          status: 'pending',
          assigned_to: currentUser?.email,
          related_entity: 'Referral',
          related_entity_id: referral.id,
          due_timeframe: '24_hours',
          due_date: toLocalISODate(dueDate),
        });

        setShowCreatePatient(false);
        setLastAnalysis(null);
        queryClient.invalidateQueries({ queryKey: ['referrals'] });
        queryClient.invalidateQueries({ queryKey: ['tasks'] });
        toast.error(`Patient chart not created. Missing: ${readiness.missing.join(', ')}. An awaiting-info referral was queued for completion.`);
        return;
      }

      const patientData = {
        first_name: readiness.first_name,
        last_name: readiness.last_name,
        date_of_birth: readiness.identifiers.date_of_birth || null,
        medical_record_number: readiness.identifiers.medical_record_number || null,
        primary_diagnosis: lastAnalysis.primary_diagnosis,
        secondary_diagnoses: lastAnalysis.secondary_diagnoses || [],
        phone: readiness.identifiers.phone || null,
        address: readiness.identifiers.address || null,
        emergency_contact_name: lastAnalysis.emergency_contact_name || null,
        emergency_contact_phone: lastAnalysis.emergency_contact_phone || null,
        status: 'active',
        care_type: 'home_health',
        clinical_notes: lastAnalysis.clinical_summary,
      };

      const patient = await base44.entities.Patient.create(patientData);

      // Create the linked Referral record so triage admissions appear in the
      // referral queue / QA / metrics (same payload shape as
      // DocumentToTriageMapper). Deliberately NOT best-effort: a failure here
      // must stop and tell the user, or we silently regress to the old
      // patient-only flow where triage admissions were invisible downstream.
      try {
        await base44.entities.Referral.create({
          patient_id: patient.id,
          patient_name: lastAnalysis.patient_name || '',
          diagnosis: lastAnalysis.primary_diagnosis || '',
          referral_source: lastAnalysis.referral_source || 'Manual triage',
          referral_date: todayEastern(),
          document_type: 'manual',
          priority: referralPriority,
          status: 'ready_for_admission',
        });
      } catch (referralError) {
        console.error('Error creating referral from triage:', referralError);
        queryClient.invalidateQueries({ queryKey: ['patients'] });
        toast.error(
          `Patient ${lastAnalysis.patient_name} was created, but the referral queue record failed. Add the referral manually from Referral Intake.`
        );
        return;
      }

      // Create a referral intake task
      const dueTimeframe = lastAnalysis.urgency_level === 'CRITICAL' ? '24_hours' : 'this_week';
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + (dueTimeframe === '24_hours' ? 1 : 7));
      await base44.entities.Task.create({
        title: `Admission Setup: ${lastAnalysis.patient_name}`,
        description: `Complete admission assessment and reconcile medications. Urgency: ${lastAnalysis.urgency_level}`,
        type: 'schedule',
        priority: URGENCY_TO_TASK_PRIORITY[lastAnalysis.urgency_level] || 'medium',
        status: 'pending',
        assigned_to: currentUser?.email,
        due_timeframe: dueTimeframe,
        due_date: toLocalISODate(dueDate),
      });

      setShowCreatePatient(false);
      setLastAnalysis(null);
      queryClient.invalidateQueries({ queryKey: ['patients'] });
      queryClient.invalidateQueries({ queryKey: ['referrals'] });
      toast.success(`Patient ${lastAnalysis.patient_name} created and added to the referral queue.`);
    } catch (error) {
      console.error('Error creating patient:', error);
      toast.error('Failed to create patient. Please try again.');
    }
  };

  return (
    <PageContainer>
      <PageHeader
        icon={Filter}
        eyebrow="Documentation"
        title="Referral Triage"
        description="AI-powered analysis of incoming referrals with automatic urgency and risk assessment"
        favoritePage="ReferralTriage"
      />

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="p-6">
            <div className="flex items-start gap-3">
              <Clock className="w-5 h-5 text-blue-600 flex-shrink-0 mt-1" />
              <div>
                <p className="text-xs text-blue-600 font-semibold uppercase">Time Saved</p>
                <p className="text-2xl font-bold text-blue-900">45+ min</p>
                <p className="text-xs text-blue-600 mt-1">per admission</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-emerald-50 border-emerald-200">
          <CardContent className="p-6">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-1" />
              <div>
                <p className="text-xs text-emerald-600 font-semibold uppercase">Structured Data</p>
                <p className="text-2xl font-bold text-emerald-900">100%</p>
                <p className="text-xs text-emerald-600 mt-1">automatically parsed</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-navy-50 border-navy-200">
          <CardContent className="p-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-navy-600 flex-shrink-0 mt-1" />
              <div>
                <p className="text-xs text-navy-600 font-semibold uppercase">Risk Flagged</p>
                <p className="text-2xl font-bold text-navy-900">Auto</p>
                <p className="text-xs text-navy-600 mt-1">priority assignment</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Triage Analyzer */}
      <ReferralTriageAnalyzer onTriageComplete={handleTriageComplete} />

      {/* Post-Analysis Actions */}
      {lastAnalysis && showCreatePatient && (
        <Card className="mt-8 border-l-4 border-l-emerald-500">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-6 h-6 text-emerald-600" />
              Next Steps
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-slate-700">
              Triage analysis complete. PennSync will create a patient only when minimum identity data is present; otherwise it will queue an awaiting-info referral for completion.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                onClick={handleCreatePatientFromTriage}
                className="gap-2 bg-indigo-600 hover:bg-indigo-700"
              >
                <ArrowRight className="w-4 h-4" />
                Create Patient or Queue Referral
              </Button>
              <Button
                onClick={() => setShowCreatePatient(false)}
                variant="outline"
              >
                Review More
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Information Card */}
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>How It Works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[
              { number: '1', title: 'Upload', desc: 'Paste referral or upload fax text' },
              { number: '2', title: 'Analyze', desc: 'AI parses and structures data' },
              { number: '3', title: 'Assess', desc: 'Urgency level and risk assigned' },
              { number: '4', title: 'Onboard', desc: 'Create a patient or queue missing identity info' },
            ].map((step, i) => (
              <div key={i} className="p-4 border border-slate-200 rounded-lg">
                <div className="w-8 h-8 bg-indigo-600 text-white rounded-full flex items-center justify-center font-bold text-sm mb-2">
                  {step.number}
                </div>
                <p className="font-semibold text-slate-900 mb-1">{step.title}</p>
                <p className="text-xs text-slate-600">{step.desc}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </PageContainer>
  );
}