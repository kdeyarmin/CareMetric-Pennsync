import { jsPDF } from "jspdf";
import { HIPAA_NOTICE, URGENCY_LABELS } from "./FaxCoverSheet";

export async function generateCoverSheetPDF(coverData, recipientName, recipientFax) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 50;
  let y = 50;

  // Header bar
  doc.setFillColor(30, 58, 138);
  doc.rect(0, 0, pageWidth, 80, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(28);
  doc.setFont('helvetica', 'bold');
  doc.text('FAX', margin, 52);

  // Urgency badge
  if (coverData.urgency && coverData.urgency !== 'normal') {
    doc.setFontSize(14);
    doc.setTextColor(255, 200, 200);
    doc.text(URGENCY_LABELS[coverData.urgency] || '', pageWidth - margin, 52, { align: 'right' });
  }

  y = 110;
  doc.setTextColor(0, 0, 0);

  // Date
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Date: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`, margin, y);
  y += 30;

  // TO section
  doc.setFillColor(240, 244, 248);
  doc.rect(margin - 10, y - 15, pageWidth - (2 * margin) + 20, 60, 'F');
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('TO:', margin, y);
  doc.setFont('helvetica', 'normal');
  doc.text(recipientName || 'N/A', margin + 60, y);
  y += 18;
  doc.setFont('helvetica', 'bold');
  doc.text('FAX:', margin, y);
  doc.setFont('helvetica', 'normal');
  doc.text(recipientFax || 'N/A', margin + 60, y);
  y += 50;

  // FROM section
  doc.setFillColor(240, 244, 248);
  doc.rect(margin - 10, y - 15, pageWidth - (2 * margin) + 20, 78, 'F');
  doc.setFont('helvetica', 'bold');
  doc.text('FROM:', margin, y);
  doc.setFont('helvetica', 'normal');
  doc.text(coverData.sender_name || 'N/A', margin + 60, y);
  y += 18;
  if (coverData.sender_company) {
    doc.setFont('helvetica', 'bold');
    doc.text('COMPANY:', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(coverData.sender_company, margin + 80, y);
    y += 18;
  }
  if (coverData.sender_phone) {
    doc.setFont('helvetica', 'bold');
    doc.text('PHONE:', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(coverData.sender_phone, margin + 60, y);
    y += 18;
  }
  y += 35;

  // Subject
  if (coverData.subject) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('RE: ' + coverData.subject, margin, y);
    y += 25;
  }

  // Divider
  doc.setDrawColor(200, 200, 200);
  doc.line(margin, y, pageWidth - margin, y);
  y += 20;

  // Message
  if (coverData.message) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    const lines = doc.splitTextToSize(coverData.message, pageWidth - (2 * margin));
    doc.text(lines, margin, y);
    y += lines.length * 16 + 20;
  }

  // HIPAA Notice
  if (coverData.include_hipaa) {
    if (y > 600) {
      doc.addPage();
      y = 50;
    }
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, y, pageWidth - margin, y);
    y += 15;
    doc.setFontSize(7);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(100, 100, 100);
    const hipaaLines = doc.splitTextToSize(HIPAA_NOTICE, pageWidth - (2 * margin));
    doc.text(hipaaLines, margin, y);
  }

  const pdfBlob = doc.output('blob');
  return new File([pdfBlob], 'cover-sheet.pdf', { type: 'application/pdf' });
}