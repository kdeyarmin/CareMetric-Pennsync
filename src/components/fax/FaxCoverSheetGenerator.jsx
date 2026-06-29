import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { configNotReadyMessage } from "@/lib/aiFeatureError";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileText, AlertTriangle, CheckCircle, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import jsPDF from "jspdf";

export default function FaxCoverSheetGenerator({
  patientId,
  documentId,
  recipientNumber,
  recipientName,
  pageCount = 1,
  onCoverSheetReady, // (pdfUrl, coverData) => void
}) {
  const [expanded, setExpanded] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [coverData, setCoverData] = useState(null);
  const [includeCover, setIncludeCover] = useState(true);

  const [form, setForm] = useState({
    subject: "",
    notes: "",
    urgency: "routine",
    recipient_organization: "",
    sender_number: "",
  });

  const _urgencyColors = {
    routine: "bg-green-100 text-green-700 border-green-200",
    urgent: "bg-yellow-100 text-yellow-700 border-yellow-200",
    stat: "bg-red-100 text-red-700 border-red-200",
  };

  const generateCoverSheet = async () => {
    setIsGenerating(true);
    try {
      const result = await base44.functions.invoke('generateFaxCoverPage', {
        patient_id: patientId || null,
        document_id: documentId || null,
        recipient_number: recipientNumber || "",
        recipient_name: recipientName || "",
        recipient_organization: form.recipient_organization,
        sender_number: form.sender_number,
        subject: form.subject,
        notes: form.notes,
        urgency: form.urgency,
        page_count: pageCount,
      });

      const data = result.data?.cover_page_data;
      if (!data) throw new Error("No cover data returned");

      setCoverData(data);

      // Build PDF cover page
      const pdfUrl = await buildCoverPDF(data);
      onCoverSheetReady?.(pdfUrl, data);
      toast.success("Cover sheet generated");
    } catch (error) {
      toast.error(configNotReadyMessage(error) || ("Failed to generate cover sheet: " + error.message));
    } finally {
      setIsGenerating(false);
    }
  };

  const buildCoverPDF = async (data) => {
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
    const W = 215.9;
    const margin = 20;
    let y = margin;

    // Header bar
    pdf.setFillColor(30, 64, 175); // indigo-800
    pdf.rect(0, 0, W, 18, "F");
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(13);
    pdf.setFont("helvetica", "bold");
    pdf.text("CONFIDENTIAL FAX TRANSMISSION", W / 2, 12, { align: "center" });

    y = 26;

    // Urgency badge
    const urgencyLabel = (data.urgency || "routine").toUpperCase();
    const urgencyColor = data.urgency === "stat" ? [220, 38, 38] : data.urgency === "urgent" ? [217, 119, 6] : [22, 163, 74];
    pdf.setFillColor(...urgencyColor);
    pdf.roundedRect(margin, y - 4, 40, 8, 2, 2, "F");
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(9);
    pdf.setFont("helvetica", "bold");
    pdf.text(urgencyLabel, margin + 20, y + 1, { align: "center" });

    // Date/Time right aligned
    pdf.setTextColor(80, 80, 80);
    pdf.setFontSize(9);
    pdf.setFont("helvetica", "normal");
    pdf.text(`${data.date}  ${data.time}`, W - margin, y + 1, { align: "right" });

    y += 14;

    // Divider
    pdf.setDrawColor(200, 200, 200);
    pdf.line(margin, y, W - margin, y);
    y += 8;

    // TO / FROM grid
    const col1 = margin;
    const col2 = W / 2 + 4;
    const rowH = 7;

    const drawField = (label, value, x, curY) => {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8);
      pdf.setTextColor(100, 100, 100);
      pdf.text(label, x, curY);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      pdf.setTextColor(20, 20, 20);
      pdf.text(value || "—", x, curY + rowH - 1);
    };

    drawField("TO:", data.to_name || "—", col1, y);
    drawField("FROM:", data.from_name || "—", col2, y);
    y += rowH + 4;

    drawField("ORGANIZATION:", data.to_organization || "—", col1, y);
    drawField("FAX:", data.from_fax || "—", col2, y);
    y += rowH + 4;

    drawField("FAX:", data.to_fax || "—", col1, y);
    drawField("PAGES (incl. cover):", String(data.total_pages || pageCount + 1), col2, y);
    y += rowH + 8;

    // Subject
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(100, 100, 100);
    pdf.text("SUBJECT:", col1, y);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.setTextColor(20, 20, 20);
    pdf.text(data.subject || "—", col1, y + rowH - 1);
    y += rowH + 8;

    // Patient Info box
    if (data.patient_name && data.patient_name !== "N/A") {
      pdf.setFillColor(239, 246, 255); // blue-50
      pdf.setDrawColor(147, 197, 253); // blue-300
      pdf.roundedRect(margin, y, W - 2 * margin, 26, 3, 3, "FD");
      y += 6;

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9);
      pdf.setTextColor(30, 64, 175);
      pdf.text("PATIENT INFORMATION", col1 + 4, y);
      y += 6;

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.setTextColor(20, 20, 20);
      pdf.text(`Name: ${data.patient_name}`, col1 + 4, y);
      pdf.text(`DOB: ${data.patient_dob || "—"}`, col2, y);
      y += 5;
      pdf.text(`MRN: ${data.patient_mrn || "—"}`, col1 + 4, y);
      if (data.patient_diagnosis && data.patient_diagnosis !== "N/A") {
        pdf.text(`Dx: ${data.patient_diagnosis}`, col2, y);
      }
      y += 10;
    }

    // Document info
    if (data.document_title) {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8);
      pdf.setTextColor(100, 100, 100);
      pdf.text("DOCUMENT:", col1, y);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      pdf.setTextColor(20, 20, 20);
      pdf.text(data.document_title, col1, y + rowH - 1);
      y += rowH + 8;
    }

    // Notes
    if (data.notes) {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8);
      pdf.setTextColor(100, 100, 100);
      pdf.text("NOTES:", col1, y);
      y += 5;
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      pdf.setTextColor(20, 20, 20);
      const noteLines = pdf.splitTextToSize(data.notes, W - 2 * margin);
      pdf.text(noteLines, col1, y);
      y += noteLines.length * 5 + 8;
    }

    // Confidentiality Notice
    const noticeText = data.confidentiality_notice ||
      "CONFIDENTIALITY NOTICE: This fax transmission contains confidential health information protected by HIPAA. If you have received this fax in error, please notify the sender immediately and destroy all copies.";

    pdf.setFillColor(255, 249, 231);
    pdf.setDrawColor(251, 191, 36);
    const noticeLines = pdf.splitTextToSize(noticeText, W - 2 * margin - 8);
    const noticeH = noticeLines.length * 4.5 + 8;
    const noticeY = Math.max(y + 8, 245);
    pdf.roundedRect(margin, noticeY, W - 2 * margin, noticeH, 3, 3, "FD");
    pdf.setFont("helvetica", "italic");
    pdf.setFontSize(7.5);
    pdf.setTextColor(120, 90, 0);
    pdf.text(noticeLines, margin + 4, noticeY + 6);

    const pdfBlob = pdf.output("blob");
    const pdfFile = new File([pdfBlob], "fax-cover-sheet.pdf", { type: "application/pdf" });
    const { file_url } = await base44.integrations.Core.UploadFile({ file: pdfFile });
    return file_url;
  };

  const handleToggle = () => {
    // includeCover still holds the PRE-toggle value here, so the user is turning
    // the cover sheet OFF when it is currently true. Clear the stale cover data in
    // that case (the previous `!includeCover` test was inverted and never fired on
    // un-check, leaving a stale cover sheet attached to the fax).
    setIncludeCover(!includeCover);
    if (includeCover) {
      setCoverData(null);
      onCoverSheetReady?.(null, null);
    }
  };

  return (
    <Card className="overflow-hidden border-slate-200 bg-slate-50/70">
      <CardHeader className="py-4 px-4 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <FileText className="w-4 h-4 text-indigo-600" />
            Fax Cover Sheet
            {coverData && (
              <Badge className="bg-green-100 text-green-700 border-green-200 text-xs gap-1">
                <CheckCircle className="w-3 h-3" /> Ready
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={includeCover}
                onChange={handleToggle}
                className="rounded"
              />
              Include
            </label>
            {includeCover && (
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setExpanded(!expanded)}>
                {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      {includeCover && expanded && (
        <CardContent className="pt-0 pb-4 px-4 space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Subject</Label>
              <Input
                placeholder="RE: Patient records..."
                value={form.subject}
                onChange={(e) => setForm(f => ({ ...f, subject: e.target.value }))}
                className="h-11 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Urgency</Label>
              <Select value={form.urgency} onValueChange={(v) => setForm(f => ({ ...f, urgency: v }))}>
                <SelectTrigger className="h-11 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="routine">Routine</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                  <SelectItem value="stat">STAT</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Recipient Organization</Label>
              <Input
                placeholder="Hospital / Clinic name"
                value={form.recipient_organization}
                onChange={(e) => setForm(f => ({ ...f, recipient_organization: e.target.value }))}
                className="h-11 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Sender Fax #</Label>
              <Input
                placeholder="+1234567890"
                value={form.sender_number}
                onChange={(e) => setForm(f => ({ ...f, sender_number: e.target.value }))}
                className="h-11 text-sm"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Notes / Message</Label>
            <Textarea
              placeholder="Any additional notes for the recipient..."
              value={form.notes}
              onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={2}
              className="text-sm resize-none"
            />
          </div>

          {form.urgency === "stat" && (
            <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              STAT priority — recipient will be notified of immediate action required.
            </div>
          )}

          <Button
            onClick={generateCoverSheet}
            disabled={isGenerating}
            size="sm"
            className="w-full h-11 rounded-xl bg-slate-900 text-white hover:bg-slate-800"
          >
            {isGenerating ? (
              <><Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> Generating...</>
            ) : (
              <><FileText className="w-3.5 h-3.5 mr-2" /> {coverData ? "Regenerate Cover Sheet" : "Generate Cover Sheet"}</>
            )}
          </Button>

          {coverData && (
            <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2 space-y-0.5">
              <p className="font-semibold flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Cover sheet will be prepended to your fax</p>
              <p>To: {coverData.to_name} · {coverData.to_fax}</p>
              <p>Subject: {coverData.subject}</p>
              <p>Pages: {coverData.total_pages}</p>
            </div>
          )}
        </CardContent>
      )}

      {includeCover && !expanded && !coverData && (
        <CardContent className="pt-0 pb-3 px-4">
          <Button
            onClick={() => { setExpanded(true); }}
            variant="outline"
            size="sm"
            className="w-full h-11 rounded-xl text-slate-700 border-slate-300 hover:bg-slate-100 text-sm"
          >
            Configure & Generate Cover Sheet
          </Button>
        </CardContent>
      )}
    </Card>
  );
}