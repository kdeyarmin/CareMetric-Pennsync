import { useRef, useState } from "react";
import uploadClinicalFile from '@/components/utils/uploadClinicalFile';
import useScopedOperation from '@/hooks/useScopedOperation';
import { getAuthorizedReferral, updateAuthorizedReferral } from '@/functions/manageAuthorizedReferral';
import { extractReferralResponseScan } from '@/functions/extractReferralResponseScan';
import { validateReferralFile, resolveMimeType, REFERRAL_ACCEPT_ATTR } from "./referralUploadUtils";
import {
  openItemsForExtraction,
  usableAnswers,
} from "./responseIngestion.js";
import { applyFaxAnswersToItems } from "./followUpFaxMatcher.js";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScanLine, UploadCloud, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

/**
 * Scanned provider-response ingestion — the manual counterpart to the
 * inbound-fax auto-ingestion. Intake scans the returned "Additional
 * Information Request" form (mailed back, handed back, or received on the
 * office fax machine), uploads it here on the referral it belongs to, and the
 * extracted per-item answers are PREVIEWED for confirmation before the same
 * conservative merge applies them (open items only; a scan never overwrites a
 * portal/fax answer or reopens a resolved item; resolving stays with staff).
 */
export default function ScannedResponseUpload({ referral, tracking, onApplied }) {
  const fileInputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [docUri, setDocUri] = useState(null);
  const referralKey = JSON.stringify([referral?.agency_id ?? null, referral?.id ?? null]);
  const operations = useScopedOperation(referralKey);
  const [docSummary, setDocSummary] = useState("");
  const [answers, setAnswers] = useState(null); // usable extracted answers
  const [accepted, setAccepted] = useState(() => new Set());

  // PHI-misdirection guard: when the host switches to a DIFFERENT referral
  // without remounting, a scan extracted for referral A must never be
  // previewed or applied against referral B's items (stable rule ids would
  // silently accept the wrong patient's answers). Render-time state
  // adjustment clears the preview; the ref lets an in-flight extraction
  // discard its own result if the referral changed while it ran.
  const [prevReferralKey, setPrevReferralKey] = useState(referralKey);
  if (prevReferralKey !== referralKey) {
    setPrevReferralKey(referralKey);
    setBusy(false);
    setDocUri(null);
    setDocSummary('');
    setAnswers(null);
    setAccepted(new Set());
  }

  const items = Array.isArray(tracking?.items) ? tracking.items : [];
  const openItems = openItemsForExtraction(items);
  const itemTitle = (id) => items.find((it) => it.id === id)?.title || id;

  if (!referral || !tracking || openItems.length === 0) return null;

  const reset = () => {
    setDocUri(null);
    setDocSummary("");
    setAnswers(null);
    setAccepted(new Set());
  };

  const handleFile = async (file) => {
    if (!file) return;
    const { valid, error } = validateReferralFile(file);
    if (!valid) {
      toast.error(error);
      return;
    }
    const operation = operations.begin();
    if (!operation) return;
    setBusy(true);
    reset();
    try {
      const { file_url, file_uri } = await uploadClinicalFile({ file });
      if (!operations.isCurrent(operation)) return;
      setDocUri(file_uri);
      const mime = resolveMimeType(file) || 'application/pdf';
      const extraction = await extractReferralResponseScan({
        fileUrl: file_url, referralId: referral.id, agencyId: referral.agency_id,
        isImage: mime.includes('image'),
      });
      if (!operations.isCurrent(operation)) return;
      const usable = usableAnswers(extraction, openItems);
      setDocSummary(typeof extraction?.document_summary === 'string' ? extraction.document_summary : '');
      setAnswers(usable);
      setAccepted(new Set(usable.map(a => a.id)));
      if (usable.length === 0) toast.info('No unambiguous answers to the open items were found. You can still resolve items manually.');
    } catch {
      if (!operations.isCurrent(operation)) return;
      toast.error("Couldn't read the scanned response. Try again or resolve items manually.");
      reset();
    } finally {
      if (operations.isCurrent(operation)) setBusy(false);
      operations.finish(operation);
    }
  };

  const applyAccepted = async () => {
    const toApply = (answers || []).filter((a) => accepted.has(a.id));
    if (toApply.length === 0 || !docUri) return;
    const operation = operations.begin();
    if (!operation) return;
    setBusy(true);
    try {
      const { referral: latest } = await getAuthorizedReferral({ agencyId: referral.agency_id, referralId: referral.id });
      if (!operations.isCurrent(operation)) return;
      const latestTracking = latest.follow_up_requests;
      if (!latestTracking || latestTracking.sent_at !== tracking.sent_at) {
        throw new Error('The follow-up request changed. Refresh it before applying this scan.');
      }
      const latestOpenItems = openItemsForExtraction(latestTracking.items);
      const unchanged = toApply.filter(answer => {
        const original = openItems.find(item => item.id === answer.id);
        const current = latestOpenItems.find(item => item.id === answer.id);
        return original && current && original.question === current.question && original.title === current.title;
      });
      const merged = applyFaxAnswersToItems(latestTracking.items, unchanged, undefined, 'scan');
      if (merged.answeredCount === 0) {
        toast.info('These items have already been answered or changed. Refresh the request before applying answers.');
        return;
      }
      await updateAuthorizedReferral({
        agencyId: referral.agency_id,
        referralId: referral.id,
        changes: {
          follow_up_requests: {
            ...latestTracking,
            items: merged.items,
            status: "received",
            received_at: new Date().toISOString(),
            response_scan: {
              document_uri: docUri,
              uploaded_at: new Date().toISOString(),
              auto_answered_count: merged.answeredCount,
            },
          },
        },
      });
      if (!operations.isCurrent(operation)) return;
      reset();
      onApplied?.();
    } catch (error) {
      if (!operations.isCurrent(operation)) return;
      toast.error(error?.message || "Couldn't save the answers. Please try again.");
    } finally {
      if (operations.isCurrent(operation)) setBusy(false);
      operations.finish(operation);
    }
  };

  return (
    <div className="bg-teal-50 border border-teal-200 rounded-lg p-3 space-y-2">
      <p className="text-sm font-semibold text-teal-900 flex items-center gap-1">
        <ScanLine className="w-4 h-4" /> Scan in the provider's response
      </p>
      <p className="text-xs text-teal-800">
        Got the completed form back on paper or the office fax machine? Upload the scan — the answers are
        extracted against the {openItems.length} open item{openItems.length === 1 ? "" : "s"}, you confirm
        them, and the items are marked answered.
      </p>
      <input
        ref={fileInputRef}
        type="file"
        accept={REFERRAL_ACCEPT_ATTR}
        className="sr-only"
        onChange={(e) => {
          handleFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <Button type="button" size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={busy}>
        {busy && !answers ? (
          <span className="flex items-center"><span className="animate-spin rounded-full h-4 w-4 border-b-2 border-teal-700 mr-2" />Reading scan…</span>
        ) : (
          <><UploadCloud className="w-4 h-4 mr-1" /> Upload scanned response</>
        )}
      </Button>

      {answers && answers.length > 0 && (
        <div className="space-y-2">
          {docSummary && <p className="text-xs text-slate-600 italic">{docSummary}</p>}
          <p className="text-xs font-semibold text-slate-900">
            Extracted answers — uncheck anything that doesn't look right:
          </p>
          {answers.map((a) => (
            <label
              key={a.id}
              htmlFor={`scan-answer-${a.id}`}
              className="flex items-start gap-2 bg-white border border-teal-200 rounded p-2 cursor-pointer"
            >
              <Checkbox
                id={`scan-answer-${a.id}`}
                checked={accepted.has(a.id)}
                disabled={busy}
                onCheckedChange={() =>
                  setAccepted((prev) => {
                    const next = new Set(prev);
                    if (next.has(a.id)) next.delete(a.id);
                    else next.add(a.id);
                    return next;
                  })
                }
                aria-label={`Accept answer: ${itemTitle(a.id)}`}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="text-xs font-semibold text-slate-900 block">{itemTitle(a.id)}</span>
                <span className="text-xs text-slate-700">{a.response_text}</span>
              </span>
            </label>
          ))}
          {openItems.length > answers.length && (
            <p className="text-[11px] text-slate-500 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              No response found for {openItems.length - answers.length} open item{openItems.length - answers.length === 1 ? "" : "s"} — they stay open.
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" onClick={applyAccepted} disabled={busy || accepted.size === 0} className="bg-teal-600 hover:bg-teal-700">
              <CheckCircle2 className="w-4 h-4 mr-1" /> Apply {accepted.size} answer{accepted.size === 1 ? "" : "s"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={reset} disabled={busy}>
              Discard
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}