import { copyTextToClipboard } from '@/lib/copyTextToClipboard';
import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  AlertCircle,
  Loader,
  Upload,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Download,
} from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import {
  PDF_TEXT_MAX_BYTES,
  describePdfTextError,
  extractPdfText,
  isPdfFile,
} from './referralPdfText';

const pages = (count) => `${count} page${count === 1 ? '' : 's'}`;

/** Which pages triage did not see, or null when it saw the whole packet. */
function describePartialRead({ pageCount, emptyPages, unreadPages }) {
  const parts = [];
  if (emptyPages > 0) {
    parts.push(`${emptyPages} of ${pages(pageCount)} had no readable text (they look like scanned images), so triage did not see ${emptyPages === 1 ? 'it' : 'them'}.`);
  }
  if (unreadPages > 0) {
    parts.push(`The packet is longer than triage can read at once, so the last ${pages(unreadPages)} ${unreadPages === 1 ? 'was' : 'were'} not included.`);
  }
  if (!parts.length) return null;
  return `${parts.join(' ')} Review those pages before relying on this triage — Referral Intake can read scanned pages.`;
}

/**
 * AI-powered referral triage analyzer
 * Reads an uploaded referral packet PDF and suggests urgency levels and care plans
 */
export default function ReferralTriageAnalyzer({ onTriageComplete, onTriageReset }) {
  const [fileName, setFileName] = useState(null);
  // 'reading' while the PDF's text is pulled out, 'analyzing' during the
  // triage call, null when idle.
  const [stage, setStage] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);
  const inFlightRef = useRef(false);
  const busy = stage !== null;

  const urgencyColors = {
    CRITICAL: 'bg-red-100 text-red-800 border-red-300',
    HIGH: 'bg-orange-100 text-orange-800 border-orange-300',
    MEDIUM: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    LOW: 'bg-green-100 text-green-800 border-green-300',
  };
  const urgencyBannerClass = (level) =>
    urgencyColors[String(level || '').toUpperCase()]
    || 'bg-slate-100 text-slate-800 border-slate-300';

  const analyzePacket = async (file) => {
    // In-flight dedupe: a second packet dropped while one is being read or
    // analyzed would race two billed triage calls into one result panel.
    if (!file || inFlightRef.current) return;
    inFlightRef.current = true;

    // A new packet replaces the previous one's result here AND on the page, so
    // nothing offers to create the previous patient while this one is read.
    setError(null);
    setNotice(null);
    setAnalysis(null);
    setFileName(file.name || 'Referral packet');
    onTriageReset?.();

    try {
      if (!isPdfFile(file)) {
        setError('Upload the referral packet as a PDF.');
        return;
      }
      if (file.size > PDF_TEXT_MAX_BYTES) {
        setError('This PDF is larger than 25 MB. Split the packet, or use Referral Intake.');
        return;
      }

      setStage('reading');
      let packet;
      try {
        packet = await extractPdfText(file);
      } catch (err) {
        setError(describePdfTextError(err));
        return;
      }
      if (!packet.text) {
        setError('This PDF has no readable text — it looks like a scanned or faxed image. Use Referral Intake, which can read scanned documents.');
        return;
      }
      setNotice(describePartialRead(packet));

      setStage('analyzing');
      // Route through the authenticated Base44 function (attaches the auth token
      // and targets the backend origin); a raw relative fetch never reaches it.
      const response = await base44.functions.invoke('triageReferralWithAI', {
        referralData: packet.text,
      });
      const result = response?.data || {};

      if (result.success && result.analysis) {
        setAnalysis(result.analysis);
        onTriageComplete?.(result.analysis);
        toast.success('Triage analysis complete');
      } else {
        setError(result.error || 'Failed to analyze referral');
      }
    } catch (err) {
      setError(err.message || 'Analysis error');
      console.error('Triage error:', err);
    } finally {
      inFlightRef.current = false;
      setStage(null);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    // Clear now: picking the same file again (say, after a failure) fires no
    // change event otherwise.
    e.target.value = '';
    analyzePacket(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    if (!busy) setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    // Moving over the zone's own children fires dragleave too.
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (busy) return;
    analyzePacket(e.dataTransfer?.files?.[0]);
  };

  const handleCopyAnalysis = async () => {
    const text = JSON.stringify(analysis, null, 2);
    if (!await copyTextToClipboard(text)) return;
    toast.success('Analysis copied to clipboard');
  };

  const handleDownloadAnalysis = () => {
    const dataStr = JSON.stringify(analysis, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    const link = document.createElement('a');
    link.setAttribute('href', dataUri);
    // Non-identifying filename — embedding the patient's name would leak PHI into
    // browser download history and stored file metadata.
    link.setAttribute('download', `triage-${Date.now()}.json`);
    link.click();
  };

  const dropZoneClass = busy
    ? 'border-slate-300 bg-slate-50'
    : isDragging
      ? 'border-indigo-500 bg-indigo-50'
      : 'border-slate-300 hover:border-indigo-500 hover:bg-indigo-50';

  return (
    <div className="w-full space-y-6">
      {/* Input Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5 text-indigo-600" />
            Referral Packet
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            data-testid="referral-packet-dropzone"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            aria-busy={busy}
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${dropZoneClass}`}
          >
            {busy ? (
              <div className="space-y-2" role="status">
                <Loader className="w-10 h-10 text-indigo-600 mx-auto animate-spin" />
                <p className="font-medium text-indigo-700">
                  {stage === 'reading' ? 'Reading referral packet…' : 'Analyzing referral…'}
                </p>
                <p className="text-xs text-slate-500 truncate">{fileName}</p>
              </div>
            ) : (
              <div className="space-y-3">
                <Upload className="w-10 h-10 text-slate-400 mx-auto" />
                <div>
                  <p className="font-medium text-slate-700">
                    {fileName ? 'Upload another referral packet' : 'Upload the referral packet PDF'}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Drag and drop it here, or choose a file. Triage starts automatically. PDF, up to 25 MB.
                  </p>
                </div>
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  className="gap-2 bg-indigo-600 hover:bg-indigo-700"
                >
                  <Upload className="w-4 h-4" />
                  Choose PDF
                </Button>
                {analysis && fileName && (
                  <p className="text-xs text-emerald-700 flex items-center justify-center gap-1 truncate">
                    <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                    Analyzed {fileName}
                  </p>
                )}
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              aria-label="Referral packet PDF"
              onChange={handleFileChange}
              disabled={busy}
              className="hidden"
            />
          </div>

          {notice && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-amber-900">Part of the packet was not analyzed</p>
                <p className="text-sm text-amber-800">{notice}</p>
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex gap-2">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-red-900">Error</p>
                <p className="text-sm text-red-700">{error}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Analysis Results */}
      {analysis && (
        <div className="space-y-4">
          {/* Urgency Banner */}
          <div className={`p-4 rounded-lg border-2 ${urgencyBannerClass(analysis.urgency_level)}`}>
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                {String(analysis.urgency_level || '').toUpperCase() === 'CRITICAL' && (
                  <AlertTriangle className="w-6 h-6" />
                )}
                {String(analysis.urgency_level || '').toUpperCase() === 'HIGH' && (
                  <AlertCircle className="w-6 h-6" />
                )}
                {['MEDIUM', 'LOW'].includes(String(analysis.urgency_level || '').toUpperCase()) && (
                  <CheckCircle2 className="w-6 h-6" />
                )}
                <div>
                  <p className="text-sm font-bold">Urgency Level: {analysis.urgency_level || 'Unknown'}</p>
                  <p className="text-xs mt-1">{analysis.urgency_reason}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Patient Information */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Patient Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-slate-600 uppercase font-semibold">Patient Name</p>
                  <p className="text-sm font-semibold text-slate-900">{analysis.patient_name}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-600 uppercase font-semibold">Date of Birth</p>
                  <p className="text-sm font-semibold text-slate-900">{analysis.date_of_birth}</p>
                </div>
              </div>
              <div>
                <p className="text-xs text-slate-600 uppercase font-semibold">Primary Diagnosis</p>
                <p className="text-sm text-slate-900">{analysis.primary_diagnosis}</p>
              </div>
              {analysis.secondary_diagnoses?.length > 0 && (
                <div>
                  <p className="text-xs text-slate-600 uppercase font-semibold mb-2">Secondary Diagnoses</p>
                  <div className="flex flex-wrap gap-1">
                    {analysis.secondary_diagnoses.map((dx, i) => (
                      <Badge key={i} variant="outline">
                        {dx}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Clinical Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Clinical Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-700 leading-relaxed">
                {analysis.clinical_summary}
              </p>
            </CardContent>
          </Card>

          {/* Risk Factors */}
          {analysis.key_risk_factors?.length > 0 && (
            <Card className="border-yellow-200 bg-yellow-50">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-yellow-600" />
                  Risk Factors
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {analysis.key_risk_factors.map((risk, i) => (
                    <li key={i} className="text-sm text-slate-700 flex gap-2">
                      <span className="text-yellow-600 font-bold">•</span>
                      {risk}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Preliminary Care Plan */}
          <Card className="border-indigo-200 bg-indigo-50">
            <CardHeader>
              <CardTitle className="text-lg">Preliminary Care Plan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-slate-600 uppercase font-semibold">Nursing Frequency</p>
                  <p className="text-sm font-semibold text-slate-900">
                    {analysis.preliminary_care_plan?.skilled_nursing_frequency}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-600 uppercase font-semibold">Medications to Reconcile</p>
                  <p className="text-sm text-slate-900">
                    {analysis.preliminary_care_plan?.medications_to_reconcile}
                  </p>
                </div>
              </div>

              {analysis.preliminary_care_plan?.initial_focus_areas?.length > 0 && (
                <div>
                  <p className="text-xs text-slate-600 uppercase font-semibold mb-2">Initial Focus Areas</p>
                  <ul className="space-y-1">
                    {analysis.preliminary_care_plan.initial_focus_areas.map((area, i) => (
                      <li key={i} className="text-sm text-slate-700 flex gap-2">
                        <span className="text-indigo-600">✓</span>
                        {area}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {analysis.preliminary_care_plan?.equipment_needed?.length > 0 && (
                <div>
                  <p className="text-xs text-slate-600 uppercase font-semibold mb-2">Equipment Needed</p>
                  <div className="flex flex-wrap gap-1">
                    {analysis.preliminary_care_plan.equipment_needed.map((equip, i) => (
                      <Badge key={i} variant="secondary">
                        {equip}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {analysis.preliminary_care_plan?.safety_concerns?.length > 0 && (
                <div>
                  <p className="text-xs text-slate-600 uppercase font-semibold mb-2">Safety Concerns</p>
                  <div className="bg-red-50 p-2 rounded border border-red-200">
                    {analysis.preliminary_care_plan.safety_concerns.map((concern, i) => (
                      <p key={i} className="text-sm text-red-800 mb-1">
                        ⚠️ {concern}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Data Gaps */}
          {analysis.data_gaps?.length > 0 && (
            <Card className="border-slate-300">
              <CardHeader>
                <CardTitle className="text-lg">Data Gaps - Info Needed</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-slate-600 mb-2">Request the following from referral source:</p>
                <ul className="space-y-1">
                  {analysis.data_gaps.map((gap, i) => (
                    <li key={i} className="text-sm text-slate-700">
                      • {gap}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Admission Notes */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Admission Nurse Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-slate-50 p-3 rounded border border-slate-200">
                <p className="text-sm text-slate-700">{analysis.admission_notes}</p>
              </div>
            </CardContent>
          </Card>

          {/* Export Actions */}
          <div className="flex gap-2">
            <Button
              onClick={handleCopyAnalysis}
              variant="outline"
              className="gap-2 flex-1"
            >
              <Copy className="w-4 h-4" />
              Copy Analysis
            </Button>
            <Button
              onClick={handleDownloadAnalysis}
              variant="outline"
              className="gap-2 flex-1"
            >
              <Download className="w-4 h-4" />
              Download JSON
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
