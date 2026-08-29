import { useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { invokeLLMWithFile } from "@/lib/invokeLLM";
import { validateReferralFile, resolveMimeType, REFERRAL_ACCEPT_ATTR } from "./referralUploadUtils";
import {
  openItemsForExtraction,
  buildResponseExtractionPrompt,
  RESPONSE_EXTRACTION_SCHEMA,
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
  const [docUrl, setDocUrl] = useState(null);
  const [docSummary, setDocSummary] = useState("");
  const [answers, setAnswers] = useState(null); // usable extracted answers
  const [accepted, setAccepted] = useState(() => new Set());

  // PHI-misdirection guard: when the host switches to a DIFFERENT referral
  // without remounting, a scan extracted for referral A must never be
  // previewed or applied against referral B's items (stable rule ids would
  // silently accept the wrong patient's answers). Render-time state
  // adjustment clears the preview; the ref lets an in-flight extraction
  // discard its own result if the referral changed while it ran.
  const referralIdRef = useRef(referral?.id ?? null);
  referralIdRef.current = referral?.id ?? null;
  const [prevReferralId, setPrevReferralId] = useState(referral?.id ?? null);
  if (prevReferralId !== (referral?.id ?? null)) {
    setPrevReferralId(referral?.id ?? null);
    setDocUrl(null);
    setDocSummary("");
    setAnswers(null);
    setAccepted(new Set());
  }

  const items = Array.isArray(tracking?.items) ? tracking.items : [];
  const openItems = openItemsForExtraction(items);
  const itemTitle = (id) => items.find((it) => it.id === id)?.title || id;

  if (!referral || !tracking || openItems.length === 0) return null;

  const reset = () => {
    setDocUrl(null);
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
    const forReferralId = referralIdRef.current;
    setBusy(true);
    reset();
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      if (referralIdRef.current !== forReferralId) return; // referral changed mid-flight — discard
      setDocUrl(file_url);
      const mime = resolveMimeType(file) || "application/pdf";
      const extraction = await invokeLLMWithFile({
        model: "automatic",
        prompt: buildResponseExtractionPrompt(openItems) +
          (mime.includes("image") ? "\n\nThis is a scanned image — read handwriting carefully." : ""),
        file_urls: [file_url],
        response_json_schema: RESPONSE_EXTRACTION_SCHEMA,
      });
      if (referralIdRef.current !== forReferralId) return; // referral changed mid-flight — discard
      const usable = usableAnswers(extraction, openItems);
      setDocSummary(extraction?.document_summary || "");
      setAnswers(usable);
      setAccepted(new Set(usable.map((a) => a.id)));
      if (usable.length === 0) {
        toast.info("No answers to the open items were found in this document — you can still resolve items manually.");
      }
    } catch (error) {
      console.error("Scanned response extraction failed:", error);
      toast.error("Couldn't read the scanned response. Try again or resolve items manually.");
      if (referralIdRef.current === forReferralId) reset();
    } finally {
      setBusy(false);
    }
  };

  const applyAccepted = async () => {
    const toApply = (answers || []).filter((a) => accepted.has(a.id));
    if (toApply.length === 0) return;
    setBusy(true);
    try {
      const merged = applyFaxAnswersToItems(items, toApply, undefined, "scan");
      await base44.entities.Referral.update(referral.id, {
        follow_up_requests: {
          ...tracking,
          items: merged.items,
          status: "received",
          received_at: new Date().toISOString(),
          response_scan: {
            document_url: docUrl,
            uploaded_at: new Date().toISOString(),
            auto_answered_count: merged.answeredCount,
          },
        },
      });
      toast.success(`${merged.answeredCount} item${merged.answeredCount === 1 ? "" : "s"} marked answered from the scanned response — verify and resolve below.`);
      reset();
      onApplied?.();
    } catch (error) {
      console.error("Applying scanned answers failed:", error);
      toast.error("Couldn't save the answers. Please try again.");
    } finally {
      setBusy(false);
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
