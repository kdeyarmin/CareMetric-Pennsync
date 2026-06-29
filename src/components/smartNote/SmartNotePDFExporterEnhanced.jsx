import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FileDown, Loader2 } from "lucide-react";
import jsPDF from "jspdf";
import { todayEastern } from "../utils/timezone";
import { base44 } from "@/api/base44Client";

const VISIT_TYPE_LABELS = {
  routine_visit: "Routine Skilled Nursing Visit",
  admission: "Start of Care (SOC)",
  recertification: "Recertification",
  discharge: "Discharge",
  prn: "PRN Visit",
};

function addWrappedText(doc, text, x, y, maxWidth, lineHeight, pageHeight, margin) {
  const lines = doc.splitTextToSize(text, maxWidth);
  for (const line of lines) {
    if (y > pageHeight - margin - 30) {
      doc.addPage();
      y = margin + 10;
    }
    doc.text(line, x, y);
    y += lineHeight;
  }
  return y;
}

import { toast } from "sonner";

export default function SmartNotePDFExporterEnhanced({
  finalNote,
  patient,
  visitType,
  analysisScore,
  analysis,
  currentUser,
  signatureImage,
}) {
  const [exporting, setExporting] = useState(false);

  const exportPDF = async () => {
    if (!finalNote) return;
    setExporting(true);

    try {
      // Fetch active care plans for this patient
      let carePlans = [];
      if (patient?.id) {
        try {
          carePlans = await base44.entities.CarePlan.filter(
            { patient_id: patient.id, status: "active" },
            "-created_date",
            10
          );
        } catch {}
      }

      const doc = new jsPDF("p", "mm", "letter");
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 18;
      const contentWidth = pageWidth - 2 * margin;
      let y = 0;

      // ─── BRANDED HEADER BANNER ───────────────────────────────────────────
      doc.setFillColor(30, 64, 175); // indigo-800
      doc.rect(0, 0, pageWidth, 22, "F");

      doc.setTextColor(255, 255, 255);
      doc.setFontSize(14);
      doc.setFont(undefined, "bold");
      doc.text("Penn Sync", margin, 10);

      doc.setFontSize(8);
      doc.setFont(undefined, "normal");
      doc.text("Home Health & Hospice Clinical Documentation", margin, 16);

      // Right-side header info
      doc.setFontSize(8);
      doc.text(`Date: ${todayEastern()}`, pageWidth - margin - 35, 10);
      doc.text(`Score: ${analysisScore ?? "N/A"}%`, pageWidth - margin - 35, 15);

      y = 28;

      // ─── DOCUMENT TITLE ──────────────────────────────────────────────────
      doc.setTextColor(30, 64, 175);
      doc.setFontSize(13);
      doc.setFont(undefined, "bold");
      doc.text("CLINICAL NURSING NOTE", margin, y);
      y += 5;
      doc.setDrawColor(30, 64, 175);
      doc.setLineWidth(0.5);
      doc.line(margin, y, pageWidth - margin, y);
      y += 6;

      // ─── PATIENT DEMOGRAPHICS BOX ─────────────────────────────────────────
      doc.setFillColor(245, 247, 255);
      doc.setDrawColor(180, 195, 235);
      doc.setLineWidth(0.3);
      doc.roundedRect(margin, y, contentWidth, 26, 2, 2, "FD");

      doc.setTextColor(30, 64, 175);
      doc.setFontSize(8);
      doc.setFont(undefined, "bold");
      doc.text("PATIENT INFORMATION", margin + 3, y + 5);

      doc.setTextColor(30, 30, 30);
      doc.setFont(undefined, "normal");
      doc.setFontSize(9);

      const col1x = margin + 3;
      const col2x = margin + contentWidth / 2 + 3;
      const rowH = 5;
      let infoY = y + 10;

      const patName = `${patient?.first_name || "—"} ${patient?.last_name || ""}`.trim();
      const dob = patient?.date_of_birth || "Not on file";
      const mrn = patient?.medical_record_number || "Not on file";
      const dx = patient?.primary_diagnosis || "Not documented";
      const _careType = (patient?.care_type || "home_health").replace(/_/g, " ");
      const visitLabel = VISIT_TYPE_LABELS[visitType] || visitType?.replace(/_/g, " ") || "—";
      const clinician = currentUser?.full_name || "—";

      doc.setFont(undefined, "bold"); doc.text("Patient:", col1x, infoY);
      doc.setFont(undefined, "normal"); doc.text(patName, col1x + 16, infoY);
      doc.setFont(undefined, "bold"); doc.text("Clinician:", col2x, infoY);
      doc.setFont(undefined, "normal"); doc.text(clinician, col2x + 18, infoY);
      infoY += rowH;

      doc.setFont(undefined, "bold"); doc.text("DOB:", col1x, infoY);
      doc.setFont(undefined, "normal"); doc.text(dob, col1x + 10, infoY);
      doc.setFont(undefined, "bold"); doc.text("MRN:", col2x, infoY);
      doc.setFont(undefined, "normal"); doc.text(mrn, col2x + 10, infoY);
      infoY += rowH;

      doc.setFont(undefined, "bold"); doc.text("Dx:", col1x, infoY);
      doc.setFont(undefined, "normal");
      doc.text(doc.splitTextToSize(dx, contentWidth / 2 - 20)[0], col1x + 7, infoY);
      doc.setFont(undefined, "bold"); doc.text("Visit Type:", col2x, infoY);
      doc.setFont(undefined, "normal"); doc.text(visitLabel, col2x + 20, infoY);

      y += 32;

      // ─── CLINICAL NOTE BODY ───────────────────────────────────────────────
      doc.setTextColor(30, 64, 175);
      doc.setFontSize(9);
      doc.setFont(undefined, "bold");
      doc.text("CLINICAL NOTE", margin, y);
      y += 4;
      doc.setDrawColor(200, 210, 240);
      doc.line(margin, y, pageWidth - margin, y);
      y += 5;

      doc.setTextColor(0, 0, 0);
      doc.setFont(undefined, "normal");
      doc.setFontSize(9.5);
      y = addWrappedText(doc, finalNote, margin, y, contentWidth, 5, pageHeight, margin);
      y += 8;

      // ─── CARE PLAN SUMMARY SECTION ────────────────────────────────────────
      if (carePlans.length > 0) {
        if (y > pageHeight - margin - 60) {
          doc.addPage();
          y = margin + 10;
        }

        doc.setFillColor(240, 253, 244);
        doc.setDrawColor(134, 239, 172);
        doc.setLineWidth(0.3);
        doc.roundedRect(margin, y, contentWidth, 8, 1.5, 1.5, "FD");

        doc.setTextColor(22, 101, 52);
        doc.setFontSize(9);
        doc.setFont(undefined, "bold");
        doc.text("ACTIVE CARE PLAN SUMMARY", margin + 3, y + 5.5);
        y += 13;

        doc.setFontSize(8.5);
        for (const cp of carePlans) {
          if (y > pageHeight - margin - 25) {
            doc.addPage();
            y = margin + 10;
          }
          doc.setFont(undefined, "bold");
          doc.setTextColor(22, 101, 52);
          doc.text(`• Problem: `, margin + 2, y);
          doc.setFont(undefined, "normal");
          doc.setTextColor(0, 0, 0);
          const problemText = doc.splitTextToSize(cp.problem || "—", contentWidth - 30)[0];
          doc.text(problemText, margin + 20, y);
          y += 4.5;

          if (cp.goal) {
            doc.setFont(undefined, "italic");
            doc.setTextColor(60, 60, 60);
            const goalLine = doc.splitTextToSize(`  Goal: ${cp.goal}`, contentWidth - 6)[0];
            doc.text(goalLine, margin + 4, y);
            y += 4.5;
          }

          if (cp.interventions?.length) {
            doc.setFont(undefined, "normal");
            doc.setTextColor(80, 80, 80);
            const intv = cp.interventions.slice(0, 3).join(" · ");
            const intvLine = doc.splitTextToSize(`  Interventions: ${intv}`, contentWidth - 6)[0];
            doc.text(intvLine, margin + 4, y);
            y += 4.5;
          }
          y += 2;
        }
        y += 4;
      }

      // ─── COMPLIANCE REPORT SECTION ────────────────────────────────────────
      if (analysis && analysis.findings && analysis.findings.length > 0) {
        if (y > pageHeight - margin - 40) {
          doc.addPage();
          y = margin + 10;
        }

        doc.setFillColor(255, 247, 237); // orange-50
        doc.setDrawColor(253, 186, 116); // orange-300
        doc.setLineWidth(0.3);
        doc.roundedRect(margin, y, contentWidth, 8, 1.5, 1.5, "FD");

        doc.setTextColor(194, 65, 12); // orange-700
        doc.setFontSize(9);
        doc.setFont(undefined, "bold");
        doc.text("COMPLIANCE REPORT & FINDINGS", margin + 3, y + 5.5);
        y += 13;

        doc.setFontSize(8.5);
        for (const finding of analysis.findings) {
          if (y > pageHeight - margin - 20) {
            doc.addPage();
            y = margin + 10;
          }
          doc.setFont(undefined, "bold");
          doc.setTextColor(0, 0, 0);
          doc.text(`• [${(finding.severity || '').toUpperCase()}] ${finding.issue}`, margin + 2, y);
          y += 4.5;
          doc.setFont(undefined, "normal");
          doc.setTextColor(60, 60, 60);
          const detailText = doc.splitTextToSize(`Suggestion: ${finding.suggestion || "N/A"}`, contentWidth - 10);
          for (const line of detailText) {
             if (y > pageHeight - margin - 10) { doc.addPage(); y = margin + 10; }
             doc.text(line, margin + 8, y);
             y += 4.5;
          }
          y += 2;
        }
        y += 4;
      }

      // ─── SIGNATURE SECTION ────────────────────────────────────────────────
      if (y > pageHeight - margin - 45) {
        doc.addPage();
        y = margin + 10;
      }

      doc.setDrawColor(180, 180, 180);
      doc.setLineWidth(0.3);
      doc.line(margin, y, pageWidth - margin, y);
      y += 7;

      doc.setTextColor(30, 64, 175);
      doc.setFontSize(9);
      doc.setFont(undefined, "bold");
      doc.text("CLINICIAN ATTESTATION & SIGNATURE", margin, y);
      y += 5;

      doc.setTextColor(60, 60, 60);
      doc.setFont(undefined, "normal");
      doc.setFontSize(8);
      const attestation =
        "I certify that the above documentation accurately reflects the skilled nursing visit performed and is a true and accurate representation of the clinical care provided.";
      y = addWrappedText(doc, attestation, margin, y, contentWidth, 4.5, pageHeight, margin);
      y += 6;

      // Signature lines
      const sigLineW = 70;
      const dateLineX = margin + sigLineW + 20;
      const dateLineW = 45;

      if (signatureImage) {
        doc.setFontSize(8);
        doc.setFont(undefined, "bold");
        doc.setTextColor(0, 0, 0);
        doc.text("Clinician Signature (Digital):", margin, y);
        y += 4;
        try {
          doc.addImage(signatureImage, "PNG", margin, y, sigLineW, 18);
          y += 21;
        } catch {
          doc.setDrawColor(0); doc.line(margin, y + 8, margin + sigLineW, y + 8);
          y += 12;
        }
      } else {
        doc.setDrawColor(60, 60, 60);
        doc.setLineWidth(0.4);
        doc.line(margin, y + 8, margin + sigLineW, y + 8);

        doc.setFont(undefined, "bold"); doc.setFontSize(7.5); doc.setTextColor(80, 80, 80);
        doc.text("Clinician Signature", margin, y + 12);
        doc.text("Print Name & Credentials", margin, y + 17);
      }

      // Date line
      doc.setDrawColor(60, 60, 60);
      doc.setLineWidth(0.4);
      doc.line(dateLineX, y + 8, dateLineX + dateLineW, y + 8);
      doc.setFont(undefined, "bold"); doc.setFontSize(7.5); doc.setTextColor(80, 80, 80);
      doc.text("Date / Time", dateLineX, y + 12);

      y += 24;

      // Care scope badge
      doc.setFont(undefined, "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(130, 130, 130);
      doc.text(`Care Type: ${(patient?.care_type || "home_health").replace(/_/g, " ").toUpperCase()}  |  Compliance Score: ${analysisScore ?? "N/A"}%`, margin, y);

      // ─── FOOTER (every page) ──────────────────────────────────────────────
      const totalPages = doc.getNumberOfPages();
      for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);
        doc.setFontSize(7);
        doc.setTextColor(160, 160, 160);
        doc.text(
          `Penn Sync Clinical Documentation  |  Generated: ${new Date().toLocaleString()}  |  Page ${p} of ${totalPages}`,
          margin,
          pageHeight - 5
        );
        doc.setDrawColor(200, 200, 200);
        doc.line(margin, pageHeight - 8, pageWidth - margin, pageHeight - 8);
      }

      const filename = `${patient?.last_name || "Patient"}_${todayEastern()}_ClinicalNote.pdf`;
      doc.save(filename);
    } catch (err) {
      console.error("PDF export error:", err);
      toast.error("Failed to export PDF. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <Button
      onClick={exportPDF}
      disabled={!finalNote || exporting}
      variant="outline"
      className="h-12 sm:h-10 gap-2 font-semibold"
    >
      {exporting ? (
        <><Loader2 className="w-4 h-4 animate-spin" /> Exporting…</>
      ) : (
        <><FileDown className="w-4 h-4" /> Export PDF</>
      )}
    </Button>
  );
}