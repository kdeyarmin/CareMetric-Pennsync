import { useEffect, useRef, useState } from 'react';
import { toLocalISODate } from '@/lib/dateLocal';
import dischargePdfContent from '@/components/discharge/dischargePdfContent';
import DischargeSummaryLoadState from '@/components/discharge/DischargeSummaryLoadState';
import { useQuery, useMutation } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import SignaturePadCanvas from '@/components/signature/SignaturePadCanvas';
import { newEsignRequestId, signDischargeSummary, signatureFileFromDataUrl } from '@/lib/esignClient';

// Discharge disposition options (mirror the DischargeSummary schema enum). The AI
// generator no longer guesses a disposition — the reviewing clinician must set it.
const DISPOSITION_OPTIONS = [
  { value: 'home_independent', label: 'Home — Independent' },
  { value: 'home_with_support', label: 'Home — With Support' },
  { value: 'continuing_home_health', label: 'Continuing Home Health' },
  { value: 'transferred_to_facility', label: 'Transferred to Facility' },
  { value: 'expired', label: 'Expired' },
  { value: 'other', label: 'Other' },
];
import { 
  FileText, Loader2, CheckCircle, Sparkles, PenTool, Download, Eye
} from 'lucide-react';

import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { useAuthorizedPatient } from '@/hooks/useAuthorizedPatient';

export default function DischargeSummaryWorkflow({ patientId, summaryId = null, initialStep = 'generate', onClose, onComplete }) {
  // initialStep lets a caller (e.g. the Discharge Summaries list "Review & Sign"
  // action) open an already-generated summary directly at the review/sign step
  // instead of the generate screen, so it can't accidentally create a duplicate.
  const [currentStep, setCurrentStep] = useState(initialStep); // generate, review, sign, complete
  const [dischargeDate, setDischargeDate] = useState(toLocalISODate());
  const [reviewNotes, setReviewNotes] = useState('');
  const [editedSummary, setEditedSummary] = useState(null);
  const [attested, setAttested] = useState(false);
  const [signatureImage, setSignatureImage] = useState(null);
  const signRequestIdRef = useRef(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const [activeSummaryId, setActiveSummaryId] = useState(summaryId);
  const { tenantContext } = useAuth();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: patient } = useAuthorizedPatient({
    patientId,
    agencyId: tenantContext?.agency_id,
    purpose: 'selector',
    enabled: !!patientId && !!tenantContext?.agency_id,
  });

  const { data: existingSummary, refetch: refetchSummary, isPending: summaryPending, isError: summaryError } = useQuery({
    queryKey: ['discharge-summary', tenantContext?.agency_id, patientId, activeSummaryId],
    queryFn: async () => {
      const summaries = await base44.entities.DischargeSummary.filter(
        { patient_id: patientId, ...(activeSummaryId ? { id: activeSummaryId } : {}) },
        '-generated_date', 1,
      );
      const record = summaries[0];
      if (record && (record.patient_id !== patientId || (activeSummaryId && record.id !== activeSummaryId))) {
        throw new Error('The discharge summary does not match the selected patient and document.');
      }
      return record ?? null;
    },
    enabled: !!patientId && !!tenantContext?.agency_id,
  });

  // Generate summary mutation
  const generateMutation = useMutation({
    mutationFn: async () => {
      const response = await base44.functions.invoke('generateDischargeSummary', {
        patient_id: patientId,
        discharge_date: dischargeDate
      });
      const data = response?.data ?? response;
      if (data?.error) throw new Error(data.error);
      if (!data?.discharge_summary?.id || data.discharge_summary.patient_id !== patientId) {
        throw new Error('A discharge summary for the selected patient was not returned');
      }
      return data;
    },
    onSuccess: (data) => {
      if (!mounted.current) return;
      setActiveSummaryId(data.discharge_summary.id);
      setEditedSummary(data.discharge_summary);
      setCurrentStep('review');
    },
    onError: (error) => {
      if (mounted.current) toast.error(error.message || 'Failed to generate summary');
    }
  });

  // Update summary mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, updates }) => base44.entities.DischargeSummary.update(id, updates),
  });

  // Sign through the e-signature broker: it authenticates the clinician,
  // requires an active membership and chart access, stores the image
  // privately, and seals the reviewed content's digest with an HMAC. The
  // browser never writes the signature or the signed status itself.
  const signMutation = useMutation({
    mutationFn: async () => {
      if (!attested || !signatureImage || summary?.status !== 'reviewed' || summary.patient_id !== patientId) {
        throw new Error('Review this patient’s summary and complete the signature attestation first.');
      }
      const file = signatureFileFromDataUrl(signatureImage, 'discharge-signature.png');
      signRequestIdRef.current ||= newEsignRequestId('discharge');
      return signDischargeSummary({
        agencyId: tenantContext?.agency_id,
        dischargeSummaryId: summary?.id,
        file,
        clientRequestId: signRequestIdRef.current,
      });
    },
    onSuccess: async () => {
      if (!mounted.current) return;
      const refreshed = await refetchSummary();
      if (!mounted.current) return;
      if (refreshed.isError || !['signed', 'sent'].includes(refreshed.data?.status)) {
        toast.error('The signature was submitted, but the signed summary could not be reloaded. Reopen this summary to confirm its status.');
        return;
      }
      setEditedSummary(refreshed.data);
      setCurrentStep('complete');
    },
    onError: (error) => {
      if (mounted.current) toast.error(error?.message || 'The discharge summary could not be signed');
    },
  });

  // Mark as reviewed
  const handleReviewComplete = async () => {
    if (!summary?.id || summary.patient_id !== patientId || !currentUser?.email
      || !['draft', 'pending_review', 'reviewed'].includes(summary.status) || updateMutation.isPending) return;
    // Disposition is a required legal fact that the AI no longer guesses — the
    // clinician must select it before this discharge document can be signed/locked.
    if (!summary?.discharge_disposition) {
      toast.error('Select the discharge disposition before completing review.');
      return;
    }
    try {
      const updated = await updateMutation.mutateAsync({ id: summary.id, updates: {
        // Persist the clinician's edits to the narrative fields. Without this the
        // edits lived only in local state, so the reviewed/signed/locked record
        // (and the generated PDF) kept the ORIGINAL AI text — the clinician would
        // sign content that was never stored, a legal-integrity defect.
        summary_of_care: summary?.summary_of_care,
        discharge_instructions: summary?.discharge_instructions,
        // Persist the reviewer-set clinical facts (previously fabricated by the
        // generator and never surfaced for review).
        discharge_disposition: summary?.discharge_disposition,
        functional_status: summary?.functional_status,
        status: 'reviewed',
        reviewed_by: currentUser?.email,
        reviewed_date: new Date().toISOString(),
        review_notes: reviewNotes
      } });
      if (!mounted.current) return;
      if (updated?.id !== summary.id || updated.patient_id !== patientId || updated.status !== 'reviewed') {
        throw new Error('The reviewed summary could not be verified.');
      }
      setActiveSummaryId(updated.id);
      setEditedSummary(updated);
      setAttested(false);
      setSignatureImage(null);
      signRequestIdRef.current = null;
      setCurrentStep('sign');
    } catch {
      if (mounted.current) toast.error('The reviewed summary could not be saved and verified. Your edits are still here; please retry.');
    }
  };

  // Generate and download the signed discharge summary as a PDF.
  const handleDownloadPDF = async () => {
    try {
      const { exportToPDF } = await import('@/components/utils/pdfExporter');
      if (!mounted.current) return false;
      const content = dischargePdfContent(summary);
      await exportToPDF({
        filename: `discharge_summary_${(summary.patient_name || 'patient').replace(/\s+/g, '_')}.pdf`,
        title: 'Discharge Summary',
        subtitle: summary.patient_name || '',
        content,
      });
      return mounted.current;
    } catch {
      if (mounted.current) toast.error('Failed to generate PDF. The summary remains open so you can retry.');
      return false;
    }
  };

  const summary = editedSummary || existingSummary;
  const readOnly = ['signed', 'sent'].includes(summary?.status);
  const reviewDisabled = readOnly || updateMutation.isPending;

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Discharge Summary Workflow
          </DialogTitle>
        </DialogHeader>

        {/* Progress Steps */}
        <div className="flex items-center justify-between mb-6">
          {['generate', 'review', 'sign', 'complete'].map((step, idx) => (
            <div key={step} className="flex items-center flex-1">
              <div className={`flex items-center gap-2 ${
                currentStep === step ? 'text-blue-600 font-semibold' :
                ['generate', 'review', 'sign', 'complete'].indexOf(currentStep) > idx ? 'text-green-600' :
                'text-slate-400'
              }`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${
                  currentStep === step ? 'border-blue-600 bg-blue-50' :
                  ['generate', 'review', 'sign', 'complete'].indexOf(currentStep) > idx ? 'border-green-600 bg-green-50' :
                  'border-slate-300'
                }`}>
                  {['generate', 'review', 'sign', 'complete'].indexOf(currentStep) > idx ? (
                    <CheckCircle className="w-5 h-5" />
                  ) : (
                    <span className="text-sm">{idx + 1}</span>
                  )}
                </div>
                <span className="hidden sm:inline capitalize">{step}</span>
              </div>
              {idx < 3 && (
                <div className={`h-0.5 flex-1 mx-2 ${
                  ['generate', 'review', 'sign', 'complete'].indexOf(currentStep) > idx ? 'bg-green-600' : 'bg-slate-300'
                }`} />
              )}
            </div>
          ))}
        </div>

        {/* When opened directly at review/sign for a selected summary, wait for it to load. */}
        {(currentStep === 'review' || currentStep === 'sign') && !summary && (
          <DischargeSummaryLoadState pending={summaryPending} error={summaryError} onRetry={() => refetchSummary()} />
        )}

        {/* Step 1: Generate */}
        {currentStep === 'generate' && (
          <div className="space-y-6">
            <Alert>
              <Sparkles className="w-4 h-4" />
              <AlertDescription>
                AI will analyze all visit notes, care plans, and medication changes to generate a comprehensive discharge summary.
              </AlertDescription>
            </Alert>

            <Card>
              <CardHeader>
                <CardTitle>Patient Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-slate-600">Patient Name</p>
                    <p className="font-semibold">{patient?.first_name} {patient?.last_name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-600">Primary Diagnosis</p>
                    <p className="font-semibold">{patient?.primary_diagnosis || 'Not specified'}</p>
                  </div>
                </div>

                <div>
                  <Label>Discharge Date</Label>
                  <Input
                    type="date"
                    value={dischargeDate}
                    onChange={(e) => setDischargeDate(e.target.value)}
                  />
                </div>

                <Button
                  onClick={() => generateMutation.mutate()}
                  disabled={generateMutation.isPending || !patient || !dischargeDate || !tenantContext?.agency_id}
                  className="w-full"
                >
                  {generateMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Generating Discharge Summary...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Generate Discharge Summary
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Step 2: Review */}
        {currentStep === 'review' && summary && (
          <div className="space-y-6">
            <Alert>
              <Eye className="w-4 h-4" />
              <AlertDescription>
                {readOnly ? 'This summary is signed. Its clinical content is read-only.' : 'Review the AI-generated summary. You can edit any section before signing.'}
              </AlertDescription>
            </Alert>

            <Tabs defaultValue="summary" className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="summary">Summary</TabsTrigger>
                <TabsTrigger value="care-plans">Care Plans</TabsTrigger>
                <TabsTrigger value="medications">Medications</TabsTrigger>
                <TabsTrigger value="metadata">Metadata</TabsTrigger>
              </TabsList>

              <TabsContent value="summary" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Summary of Care</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Textarea
                      disabled={reviewDisabled}
                      value={summary.summary_of_care}
                      onChange={(e) => setEditedSummary({ ...summary, summary_of_care: e.target.value })}
                      rows={15}
                      className="font-mono text-sm"
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Discharge Instructions</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Textarea
                      disabled={reviewDisabled}
                      value={summary.discharge_instructions}
                      onChange={(e) => setEditedSummary({ ...summary, discharge_instructions: e.target.value })}
                      rows={5}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Discharge Disposition &amp; Functional Status</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label className="mb-1 block">
                        Discharge Disposition <span className="text-red-600">*</span>
                      </Label>
                      <Select
                        disabled={reviewDisabled}
                        value={summary.discharge_disposition || ''}
                        onValueChange={(value) => setEditedSummary({ ...summary, discharge_disposition: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select where the patient was discharged to…" />
                        </SelectTrigger>
                        <SelectContent>
                          {DISPOSITION_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="mb-1 block">Functional Status at Discharge</Label>
                      <Textarea
                        disabled={reviewDisabled}
                        value={summary.functional_status?.at_discharge || ''}
                        onChange={(e) => setEditedSummary({
                          ...summary,
                          functional_status: { ...(summary.functional_status || {}), at_discharge: e.target.value },
                        })}
                        rows={3}
                        placeholder="Describe the patient's actual functional status at discharge (e.g. improved, unchanged, declined, transferred to acute care)."
                      />
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="care-plans">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Care Plan Outcomes</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {summary.care_plan_outcomes?.map((outcome, idx) => (
                        <div key={idx} className="border rounded p-3">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex-1">
                              <p className="font-semibold">{outcome.problem}</p>
                              <p className="text-sm text-slate-600">{outcome.goal}</p>
                            </div>
                            <Badge className={
                              outcome.outcome === 'met' ? 'bg-green-100 text-green-800' :
                              outcome.outcome === 'partially_met' ? 'bg-yellow-100 text-yellow-800' :
                              'bg-slate-100 text-slate-800'
                            }>
                              {(outcome.outcome || '').replace('_', ' ')}
                            </Badge>
                          </div>
                          <p className="text-sm text-slate-700">{outcome.notes}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="medications">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Medication Summary</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <h4 className="font-semibold mb-2">Medications at Discharge</h4>
                      <ul className="list-disc list-inside space-y-1">
                        {summary.medication_summary?.medications_at_discharge?.map((med, idx) => (
                          <li key={idx} className="text-sm">{med}</li>
                        ))}
                      </ul>
                    </div>

                    {summary.medication_summary?.medication_changes?.length > 0 && (
                      <div>
                        <h4 className="font-semibold mb-2">Medication Changes</h4>
                        <div className="space-y-2">
                          {summary.medication_summary.medication_changes.map((change, idx) => (
                            <div key={idx} className="text-sm border-l-4 border-blue-500 pl-3 py-1">
                              <Badge variant="outline" className="mb-1">
                                {(change.change_type || '').replace('_', ' ')}
                              </Badge>
                              <p>{change.medication}</p>
                              <p className="text-slate-600 text-xs">{change.reason}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="metadata">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Generation Metadata</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-slate-600">Visits Analyzed</p>
                        <p className="font-semibold">{summary.ai_generation_metadata?.visits_analyzed || 0}</p>
                      </div>
                      <div>
                        <p className="text-slate-600">Care Plans Analyzed</p>
                        <p className="font-semibold">{summary.ai_generation_metadata?.care_plans_analyzed || 0}</p>
                      </div>
                      <div>
                        <p className="text-slate-600">Total Visits</p>
                        <p className="font-semibold">{summary.visit_summary?.total_visits || 0}</p>
                      </div>
                      <div>
                        <p className="text-slate-600">Confidence Score</p>
                        <p className="font-semibold">{summary.ai_generation_metadata?.generation_confidence || 0}%</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            <div>
              <Label>Review Notes (Optional)</Label>
              <Textarea
                disabled={reviewDisabled}
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                placeholder="Add any notes about your review..."
                rows={3}
              />
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              {!readOnly && <Button onClick={handleReviewComplete} disabled={updateMutation.isPending || !currentUser?.email}>
                {updateMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-2" />}
                Complete Review
              </Button>}
            </div>
          </div>
        )}

        {/* Step 3: Sign */}
        {currentStep === 'sign' && summary && (
          <div className="space-y-6">
            <Alert>
              <PenTool className="w-4 h-4" />
              <AlertDescription>
                Your signature is recorded against the exact reviewed content. The server stamps your identity,
                the time, and a fingerprint of the summary; editing it afterwards is not possible.
              </AlertDescription>
            </Alert>

            <Card>
              <CardHeader>
                <CardTitle>Summary Preview</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-slate-50 p-4 rounded-lg max-h-96 overflow-y-auto">
                  <div className="whitespace-pre-wrap text-sm">
                    {summary.summary_of_care}
                  </div>
                </div>
              </CardContent>
            </Card>

            {summary.status === 'reviewed' ? (
              <Card>
                <CardHeader>
                  <CardTitle>Clinician Signature</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id="discharge-attestation"
                      disabled={signMutation.isPending}
                      checked={attested}
                      onCheckedChange={(value) => setAttested(value === true)}
                    />
                    <Label htmlFor="discharge-attestation" className="text-sm leading-snug">
                      I personally reviewed this discharge summary and attest that it is accurate and complete
                      to the best of my knowledge.
                    </Label>
                  </div>
                  <SignaturePadCanvas onSignatureCapture={setSignatureImage} disabled={signMutation.isPending} />
                  <div className="flex justify-end gap-3">
                    <Button variant="outline" onClick={onClose}>
                      Cancel
                    </Button>
                    <Button
                      onClick={() => signMutation.mutate()}
                      disabled={!attested || !signatureImage || signMutation.isPending || !tenantContext?.agency_id}
                    >
                      {signMutation.isPending
                        ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        : <PenTool className="w-4 h-4 mr-2" />}
                      Sign Discharge Summary
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Alert>
                <AlertDescription>
                  {summary.status === 'signed'
                    ? 'This discharge summary is already signed.'
                    : 'Complete the clinical review before signing.'}
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* Step 4: Complete */}
        {currentStep === 'complete' && summary && (
          <div className="space-y-6">
            <Alert className="bg-green-50 border-green-200">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <AlertDescription className="text-green-800">
                Discharge summary has been completed and signed successfully!
              </AlertDescription>
            </Alert>

            <Card>
              <CardContent className="pt-6 text-center">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="w-8 h-8 text-green-600" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Summary Complete</h3>
                <p className="text-slate-600 mb-4">
                  Signed by {summary.signature?.signed_by_name} on{' '}
                  {new Date(summary.signature?.signed_date).toLocaleString()}
                </p>

                <div className="flex justify-center gap-3">
                  <Button variant="outline" onClick={onClose}>
                    Close
                  </Button>
                  <Button onClick={async () => {
                    if (await handleDownloadPDF()) {
                      onComplete?.();
                      onClose();
                    }
                  }}>
                    <Download className="w-4 h-4 mr-2" />
                    Download PDF
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}