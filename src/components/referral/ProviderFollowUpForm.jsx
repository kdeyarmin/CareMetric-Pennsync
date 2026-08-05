import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileDown, ClipboardCopy, Send, FileText, Printer } from "lucide-react";
import { toast } from "sonner";
import { exportToPDF } from "@/components/utils/pdfExporter";
import { buildProviderForm, providerFormToText } from "./referralFollowUpEngine.js";

const severityBadge = (severity) =>
  severity === "critical" ? "bg-red-600 text-white" : severity === "high" ? "bg-orange-500 text-white" : "bg-yellow-500 text-white";

/** pdfExporter `content` sections for a provider form (shared by the
 *  single-form download/fax path and the batch export on the page). */
export function followUpFormPdfContent(form) {
  return [
    { type: "text", text: form.intro },
    ...form.sections.flatMap((s) => [
      { type: "heading", text: `${s.number}. [${s.severity.toUpperCase()}] ${s.title}`, size: 12 },
      { type: "text", text: `REQUEST: ${s.request}` },
      ...(s.hint ? [{ type: "text", text: `NOTE: ${s.hint}` }] : []),
      { type: "text", text: `WHY WE NEED IT: ${s.why} (${s.citation})` },
      {
        type: "text",
        text:
          s.response_type === "document"
            ? "RESPONSE:  [ ] Document attached    [ ] Written below:"
            : "RESPONSE:",
      },
      { type: "text", text: "_________________________________________________________________" },
      { type: "text", text: "_________________________________________________________________" },
    ]),
    { type: "heading", text: "Completion", size: 12 },
    ...form.signatureBlock.map((t) => ({ type: "text", text: t })),
  ];
}

/**
 * Provider-facing information-request form, built from the selected follow-up
 * items. The provider sees, per item: exactly what to send back, why it is
 * required (with the regulation / PDGM mechanism), and a response area — so
 * one round trip completes the referral. Deterministic rendering of
 * referralFollowUpEngine output; no AI here, and deliberately NO dollar
 * amounts anywhere (this document leaves the building).
 */
export default function ProviderFollowUpForm({
  header,
  items,
  onMarkSent,
  markSentDisabled,
  onFax,
  faxDisabled,
  faxLabel,
}) {
  const [busy, setBusy] = useState(false);
  const form = useMemo(() => buildProviderForm(header, items), [header, items]);

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(providerFormToText(form));
      toast.success("Form text copied — paste into a fax cover or message.");
    } catch {
      toast.error("Couldn't copy to clipboard.");
    }
  };

  const downloadPdf = async () => {
    setBusy(true);
    try {
      await exportToPDF({
        // Non-identifying filename — embedding the patient's name would leak PHI
        // into browser download history and stored file metadata.
        filename: `referral-follow-up-${Date.now()}.pdf`,
        title: form.title,
        subtitle: `${header.patientName || ""}${header.patientDob ? ` — DOB ${header.patientDob}` : ""}`,
        content: followUpFormPdfContent(form),
      });
      toast.success("Provider form PDF downloaded.");
    } catch (error) {
      console.error("Error exporting follow-up form PDF:", error);
      toast.error("Couldn't generate the PDF.");
    } finally {
      setBusy(false);
    }
  };

  if (!items || items.length === 0) {
    return (
      <Card className="border-2 border-green-300 bg-green-50">
        <CardContent className="p-6 text-center text-sm text-green-900">
          Nothing to request — every reviewed element is present on this referral.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-navy-300">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="w-5 h-5 text-navy-600" />
            Provider Information Request — Preview
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Button type="button" variant="outline" size="sm" onClick={copyText}>
              <ClipboardCopy className="w-4 h-4 mr-1" /> Copy text
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={downloadPdf} disabled={busy}>
              <FileDown className="w-4 h-4 mr-1" /> {busy ? "Generating…" : "Download PDF"}
            </Button>
            {onFax && (
              <Button type="button" size="sm" onClick={onFax} disabled={faxDisabled}>
                <Printer className="w-4 h-4 mr-1" /> {faxLabel || "Fax to provider"}
              </Button>
            )}
            {onMarkSent && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="border-navy-400 text-navy-700"
                onClick={onMarkSent}
                disabled={markSentDisabled}
              >
                <Send className="w-4 h-4 mr-1" /> Mark sent manually
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-slate-700 bg-slate-50 border rounded p-3">{form.intro}</p>
        {form.sections.map((s) => (
          <div key={s.number} className="border rounded-lg p-3">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-semibold text-slate-900">{s.number}. {s.title}</span>
              <Badge className={severityBadge(s.severity)}>{s.severity}</Badge>
              <Badge variant="outline">{s.category}</Badge>
            </div>
            <p className="text-sm text-slate-800"><span className="font-semibold">Request:</span> {s.request}</p>
            {s.hint && <p className="text-xs text-slate-600 mt-0.5"><span className="font-semibold">Note:</span> {s.hint}</p>}
            <p className="text-xs text-slate-600 mt-1">
              <span className="font-semibold">Why we need it:</span> {s.why}{" "}
              <span className="text-slate-500">({s.citation})</span>
            </p>
            <div className="mt-2 text-xs text-slate-400 border-t pt-2">
              {s.response_type === "document" ? "☐ Document attached   ☐ Written response" : "Response"}: ____________________________
            </div>
          </div>
        ))}
        <div className="text-xs text-slate-600 border-t pt-3 space-y-1">
          {form.signatureBlock.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
