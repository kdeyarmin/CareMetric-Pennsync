import { copyTextToClipboard } from '@/lib/copyTextToClipboard';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  FileText,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  PACKET_MAX_BYTES,
  describeJobProgress,
  getPacketTriage,
  isOpenJob,
  isPdfFile,
  jobErrorMessage,
  listPacketTriage,
  processPacketTriage,
  startPacketTriage,
} from './referralTriageJobs';

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const pageRange = ({ start_page: start, end_page: end }) => (start === end ? `${start}` : `${start}–${end}`);

// What a run can change; a run that changes none of it is not making progress.
const progressKey = (job) => `${job?.status}:${job?.parts_done}:${job?.summarizing}`;

function statusBadge(job) {
  if (job.status === 'ready') {
    return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">{job.urgency_level ? `Ready · ${job.urgency_level}` : 'Ready'}</Badge>;
  }
  if (job.status === 'failed') return <Badge className="bg-red-100 text-red-800 border-red-200">Failed</Badge>;
  return <Badge className="bg-indigo-100 text-indigo-800 border-indigo-200">Analyzing</Badge>;
}

/**
 * Referral packet triage. The packet PDF is uploaded to private storage and
 * analyzed on the server in the background, page range by page range, so a
 * 75-100 page scanned packet works and the user may leave while it runs; they
 * are notified when it is ready. While this panel is open it drives the job
 * itself, so a packet someone is watching finishes as fast as it can.
 */
export default function ReferralTriageAnalyzer({
  agencyId,
  initialJobId = null,
  onTriageComplete,
  onTriageReset,
  retryDelayMs = 4000,
  busyDelayMs = 8000,
}) {
  const [jobs, setJobs] = useState([]);
  const [selectedId, setSelectedId] = useState(initialJobId);
  const [selectedJob, setSelectedJob] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [connectionNotice, setConnectionNotice] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);
  const callbacks = useRef({ onTriageComplete, onTriageReset });
  callbacks.current = { onTriageComplete, onTriageReset };

  const analysis = selectedJob?.status === 'ready' ? selectedJob.analysis : null;

  const urgencyColors = {
    CRITICAL: 'bg-red-100 text-red-800 border-red-300',
    HIGH: 'bg-orange-100 text-orange-800 border-orange-300',
    MEDIUM: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    LOW: 'bg-green-100 text-green-800 border-green-300',
  };
  const urgencyBannerClass = (level) =>
    urgencyColors[String(level || '').toUpperCase()]
    || 'bg-slate-100 text-slate-800 border-slate-300';

  const rememberJob = useCallback((job) => {
    if (!job?.id) return;
    setJobs((previous) => {
      const { analysis: _omit, ...summary } = job;
      const rest = previous.filter((row) => row.id !== job.id);
      return previous.some((row) => row.id === job.id)
        ? previous.map((row) => (row.id === job.id ? summary : row))
        : [summary, ...rest];
    });
  }, []);

  const loadList = useCallback(async () => {
    if (!agencyId) return;
    try {
      setJobs(await listPacketTriage({ agencyId }));
    } catch (err) {
      setError(jobErrorMessage(err, 'Your recent packets could not be loaded.'));
    }
  }, [agencyId]);

  useEffect(() => { loadList(); }, [loadList]);

  // Follow the selected job: read it, drive it while it is open, and hand a
  // finished triage to the page. Cancelled when the selection or agency changes.
  useEffect(() => {
    if (!selectedId || !agencyId) return undefined;
    let cancelled = false;
    setSelectedJob(null);
    setConnectionNotice(null);
    (async () => {
      let job;
      try {
        job = await getPacketTriage({ agencyId, jobId: selectedId });
      } catch (err) {
        if (!cancelled) setError(jobErrorMessage(err, 'That referral packet could not be opened.'));
        return;
      }
      let failures = 0;
      while (!cancelled) {
        setSelectedJob(job);
        rememberJob(job);
        if (!isOpenJob(job)) break;
        try {
          const before = progressKey(job);
          const { job: next, busy } = await processPacketTriage({ agencyId, jobId: selectedId });
          job = next;
          failures = 0;
          // Another run holds it, or this run could not move it on (its file
          // was briefly unavailable, a summary attempt failed): wait before the
          // next run rather than asking again at once.
          if ((busy || progressKey(next) === before) && isOpenJob(next) && !cancelled) await sleep(busyDelayMs);
        } catch {
          failures += 1;
          if (failures >= 3 && !cancelled) {
            setConnectionNotice('Lost contact with the analysis. It keeps running on the server, and you will be notified when it finishes.');
          }
          await sleep(failures >= 3 ? busyDelayMs : retryDelayMs);
          if (cancelled) return;
          try { job = await getPacketTriage({ agencyId, jobId: selectedId }); } catch { /* keep the last state */ }
        }
      }
      if (cancelled) return;
      setConnectionNotice(null);
      if (job.status === 'ready' && job.analysis) {
        callbacks.current.onTriageComplete?.(job.analysis);
        toast.success('Triage analysis complete');
      }
    })();
    return () => { cancelled = true; };
  }, [selectedId, agencyId, rememberJob, retryDelayMs, busyDelayMs]);

  const selectJob = (jobId) => {
    if (jobId === selectedId) return;
    setError(null);
    callbacks.current.onTriageReset?.();
    setSelectedId(jobId);
  };

  const handlePacket = async (file) => {
    if (!file || uploading) return;
    setError(null);
    if (!isPdfFile(file)) {
      setError('Upload the referral packet as a PDF.');
      return;
    }
    if (file.size > PACKET_MAX_BYTES) {
      setError('This PDF is larger than 25 MB. Split the packet and upload the parts.');
      return;
    }
    if (!agencyId) {
      setError('Your agency could not be determined. Reload the page and try again.');
      return;
    }
    // A new packet replaces the previous one's result here AND on the page, so
    // nothing offers to create the previous patient while this one runs.
    callbacks.current.onTriageReset?.();
    setUploading(true);
    try {
      const job = await startPacketTriage({ agencyId, file });
      rememberJob(job);
      setSelectedId(job.id);
    } catch (err) {
      setError(jobErrorMessage(err, 'The packet could not be uploaded. Try again.'));
      toast.error('The packet could not be uploaded');
    } finally {
      setUploading(false);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    // Clear now: picking the same file again (say, after a failure) fires no
    // change event otherwise.
    e.target.value = '';
    handlePacket(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    if (!uploading) setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    // Moving over the zone's own children fires dragleave too.
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (uploading) return;
    handlePacket(e.dataTransfer?.files?.[0]);
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

  const dropZoneClass = uploading
    ? 'border-slate-300 bg-slate-50'
    : isDragging
      ? 'border-indigo-500 bg-indigo-50'
      : 'border-slate-300 hover:border-indigo-500 hover:bg-indigo-50';

  const progressPercent = selectedJob?.part_count
    ? Math.round(((selectedJob.parts_done || 0) / selectedJob.part_count) * (selectedJob.summarizing ? 100 : 90))
    : 0;

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
            aria-busy={uploading}
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${dropZoneClass}`}
          >
            {uploading ? (
              <div className="space-y-2" role="status">
                <Loader className="w-10 h-10 text-indigo-600 mx-auto animate-spin" />
                <p className="font-medium text-indigo-700">Uploading referral packet…</p>
              </div>
            ) : (
              <div className="space-y-3">
                <Upload className="w-10 h-10 text-slate-400 mx-auto" />
                <div>
                  <p className="font-medium text-slate-700">Upload the referral packet PDF</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Scanned or digital, up to 200 pages and 25 MB. Drag and drop it here, or choose a file.
                    It is analyzed in the background — you can leave this page and you will be notified when it is ready.
                  </p>
                </div>
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  className="gap-2 bg-indigo-600 hover:bg-indigo-700"
                >
                  <Upload className="w-4 h-4" />
                  Choose PDF
                </Button>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              aria-label="Referral packet PDF"
              onChange={handleFileChange}
              disabled={uploading}
              className="hidden"
            />
          </div>

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

      {/* Selected packet: progress, failure, or partial-read note */}
      {selectedJob && isOpenJob(selectedJob) && (
        <Card className="border-indigo-200">
          <CardContent className="p-5 space-y-3" role="status">
            <div className="flex items-center gap-2">
              <Loader className="w-5 h-5 text-indigo-600 animate-spin flex-shrink-0" />
              <p className="font-semibold text-slate-900 truncate">{selectedJob.file_name}</p>
            </div>
            <p className="text-sm text-indigo-700">
              {describeJobProgress(selectedJob)}
              {selectedJob.page_count ? ` · ${selectedJob.page_count} pages` : ''}
            </p>
            <div className="h-2 rounded-full bg-indigo-100 overflow-hidden">
              <div className="h-full bg-indigo-600 transition-all" style={{ width: `${Math.max(5, progressPercent)}%` }} />
            </div>
            <p className="text-xs text-slate-500">
              You can leave this page. The packet keeps processing, and you will get a notification when the triage is ready.
            </p>
            {connectionNotice && <p className="text-xs text-amber-700">{connectionNotice}</p>}
          </CardContent>
        </Card>
      )}

      {selectedJob?.status === 'failed' && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex gap-2">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-900">{selectedJob.file_name} could not be analyzed</p>
            <p className="text-sm text-red-700">{selectedJob.error_message || 'Upload the packet again.'}</p>
          </div>
        </div>
      )}

      {analysis && selectedJob?.unread_pages?.length > 0 && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-900">Part of the packet was not analyzed</p>
            <p className="text-sm text-amber-800">
              Pages {selectedJob.unread_pages.map(pageRange).join(', ')} could not be read, so triage did not see them.
              Review those pages before relying on this triage.
            </p>
          </div>
        </div>
      )}

      {/* Recent packets */}
      {jobs.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="w-5 h-5 text-slate-500" />
              Your recent packets
            </CardTitle>
            <Button variant="ghost" size="sm" className="gap-1" onClick={loadList}>
              <RefreshCw className="w-4 h-4" />
              Refresh
            </Button>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-slate-100">
              {jobs.map((job) => (
                <li key={job.id}>
                  <button
                    type="button"
                    onClick={() => selectJob(job.id)}
                    aria-current={job.id === selectedId ? 'true' : undefined}
                    className={`w-full text-left py-3 px-2 rounded-md flex items-center justify-between gap-3 hover:bg-slate-50 ${job.id === selectedId ? 'bg-indigo-50' : ''}`}
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-slate-900 truncate">{job.file_name}</span>
                      <span className="block text-xs text-slate-500">
                        {job.page_count ? `${job.page_count} pages · ` : ''}
                        {job.created_date ? new Date(job.created_date).toLocaleString() : ''}
                        {isOpenJob(job) ? ` · ${describeJobProgress(job)}` : ''}
                      </span>
                    </span>
                    {statusBadge(job)}
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

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
