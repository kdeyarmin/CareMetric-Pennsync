import { useState } from 'react';
import { toLocalISODate, formatLocalDate } from '@/lib/dateLocal';
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

import DigitalSignaturePad from './DigitalSignaturePad';
import { toast } from 'sonner';
import { PATIENT_HISTORY_ROWS } from '@/lib/queryLimits';

const formatPdfDate = (value) => value ? formatLocalDate(value) : '—';

export default function DischargeSummaryWorkflow({ patientId, summaryId = null, initialStep = 'generate', onClose, onComplete }) {
  // initialStep lets a caller (e.g. the Discharge Summaries list "Review & Sign"
  // action) open an already-generated summary directly at the review/sign step
  // instead of the generate screen, so it can't accidentally create a duplicate.
  const [currentStep, setCurrentStep] = useState(initialStep); // generate, review, sign, complete
  const [dischargeDate, setDischargeDate] = useState(toLocalISODate());
  const [reviewNotes, setReviewNotes] = useState('');
  const [editedSummary, setEditedSummary] = useState(null);
  const [showSignaturePad, setShowSignaturePad] = useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: patient } = useQuery({
    queryKey: ['patient-discharge', patientId],
    queryFn: async () => {
      const [p] = await base44.entities.Patient.filter({ id: patientId });
      return p;
    },
    enabled: !!patientId
  });

  const { data: existingSummary, refetch: refetchSummary } = useQuery({
    queryKey: ['discharge-summary', patientId, summaryId],
    queryFn: async () => {
      // When a specific summary was selected (e.g. from the list), load exactly
      // that record so review/sign acts on it; otherwise fall back to the
      // patient's most recent summary (the generate-then-review flow).
      if (summaryId) {
        const [s] = await base44.entities.DischargeSummary.filter({ id: summaryId });
        return s;
      }
      const summaries = await base44.entities.DischargeSummary.filter(
        { patient_id: patientId },
        '-generated_date',
        PATIENT_HISTORY_ROWS,
      );
      return summaries[0];
    },
    enabled: !!(patientId || summaryId)
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
      if (!data?.discharge_summary) throw new Error('Discharge summary was not returned');
      return data;
    },
    onSuccess: (data) => {
      toast.success('Discharge summary generated successfully');
      setEditedSummary(data.discharge_summary);
      setCurrentStep('review');
      refetchSummary();
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to generate summary');
    }
  });

  // Update summary mutation
  const updateMutation = useMutation({
    mutationFn: async (updates) => {
      return base44.entities.DischargeSummary.update(
        existingSummary?.id || editedSummary?.id,
        updates
      );
    },
    onSuccess: () => {
      refetchSummary();
    },
    onError: (error) => {
      // Without this, a failed update left the user with no feedback at all —
      // for a legally-signed discharge document the workflow just appeared frozen.
      toast.error(error?.message || 'Failed to save the discharge summary. Please try again.');
    }
  });

  // Mark as reviewed
  const handleReviewComplete = async () => {
    // Disposition is a required legal fact that the AI no longer guesses — the
    // clinician must select it before this discharge document can be signed/locked.
    if (!summary?.discharge_disposition) {
      toast.error('Select the discharge disposition before completing review.');
      return;
    }
    try {
      await updateMutation.mutateAsync({
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
      });
      toast.success('Review completed');
      setCurrentStep('sign');
    } catch {
      // Failure already surfaced by updateMutation.onError; do not advance the step.
    }
  };

  // Handle signature
  const handleSignature = async (signatureData) => {
    try {
      await updateMutation.mutateAsync({
        status: 'signed',
        signature: {
          signature_data: signatureData,
          signed_by: currentUser?.email,
          signed_by_name: currentUser?.full_name,
          // Record the signer's ACTUAL credential (PT/OT/SW/LPN/etc. all sign
          // discharge summaries) rather than assuming 'RN' — this is a locked
          // legal document. Fall back to a neutral value when unknown.
          signed_by_credentials: currentUser?.credential_type || 'Unknown',
          signed_date: new Date().toISOString(),
          ip_address: 'System'
        }
      });
      toast.success('Discharge summary signed');
      setCurrentStep('complete');
      setShowSignaturePad(false);
    } catch {
      // Failure already surfaced by updateMutation.onError; keep the signature pad open.
    }
  };

  // Generate and download the signed discharge summary as a PDF.
  const handleDownloadPDF = async () => {
    try {
      const { exportToPDF } = await import('@/components/utils/pdfExporter');
      const content = [];
      const addSection = (label, value) => {
        if (value === undefined || value === null || value === '') return;
        content.push({ type: 'heading', text: label, size: 12 });
        content.push({ type: 'text', text: String(value) });
        content.push({ type: 'spacer', height: 3 });
      };
      addSection('Primary Diagnosis', summary.primary_diagnosis);
      if (Array.isArray(summary.secondary_diagnoses) && summary.secondary_diagnoses.length) {
        addSection('Secondary Diagnoses', summary.secondary_diagnoses.join(', '));
      }
      addSection('Admission / Discharge', `${formatPdfDate(summary.admission_date)} to ${formatPdfDate(summary.discharge_date)}`);
      addSection('Reason for Admission', summary.reason_for_admission);
      addSection('Summary of Care', summary.summary_of_care);
      if (summary.signature?.signed_by_name) {
        addSection('Signed By', `${summary.signature.signed_by_name}${summary.signature.signed_date ? ` on ${new Date(summary.signature.signed_date).toLocaleString()}` : ''}`);
      }
      await exportToPDF({
        filename: `discharge_summary_${(summary.patient_name || 'patient').replace(/\s+/g, '_')}.pdf`,
        title: 'Discharge Summary',
        subtitle: summary.patient_name || '',
        content,
      });
    } catch (err) {
      console.error('Discharge summary PDF error:', err);
      toast.error('Failed to generate PDF');
    }
  };

  const summary = editedSummary || existingSummary;

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
          <div className="flex items-center justify-center py-12 text-slate-500">
            <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading summary…
          </div>
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
                  disabled={generateMutation.isPending}
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
                Review the AI-generated summary. You can edit any section before signing.
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
              <Button onClick={handleReviewComplete}>
                <CheckCircle className="w-4 h-4 mr-2" />
                Complete Review
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Sign */}
        {currentStep === 'sign' && summary && (
          <div className="space-y-6">
            <Alert>
              <PenTool className="w-4 h-4" />
              <AlertDescription>
                Sign the discharge summary to finalize it. This will lock the document and generate a PDF.
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

            <Button
              onClick={() => setShowSignaturePad(true)}
              className="w-full"
            >
              <PenTool className="w-4 h-4 mr-2" />
              Sign Discharge Summary
            </Button>

            {showSignaturePad && (
              <DigitalSignaturePad
                onSave={handleSignature}
                onCancel={() => setShowSignaturePad(false)}
                signerName={currentUser?.full_name}
              />
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
                    await handleDownloadPDF();
                    onComplete?.();
                    onClose();
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