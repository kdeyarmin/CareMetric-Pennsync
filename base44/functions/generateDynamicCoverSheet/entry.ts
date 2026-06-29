import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { jsPDF } from 'npm:jspdf@2.5.2';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json();
    const {
      from_name,
      from_organization,
      from_phone,
      from_fax,
      from_address,
      to_name,
      to_organization,
      to_fax,
      to_phone,
      document_type,
      document_type_disclaimer,
      page_count,
      urgency,
      date,
      time,
      patient_name,
      patient_id,
      hipaa_disclaimer,
      notes,
    } = payload;

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    let yPos = 20;

    // Helper function to add text with word wrap
    const addWrappedText = (text, x, y, maxWidth, fontSize = 10) => {
      doc.setFontSize(fontSize);
      const lines = doc.splitTextToSize(text, maxWidth);
      doc.text(lines, x, y);
      return y + (lines.length * fontSize * 0.5);
    };

    // Header - Organization Name
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text(from_organization || 'Home Health Agency', pageWidth / 2, yPos, { align: 'center' });
    yPos += 10;

    // FAX COVER SHEET title
    doc.setFontSize(24);
    doc.text('FAX COVER SHEET', pageWidth / 2, yPos, { align: 'center' });
    yPos += 15;

    // Urgency indicator
    if (urgency === 'urgent' || urgency === 'stat') {
      doc.setFillColor(220, 38, 38);
      doc.rect(margin, yPos - 5, pageWidth - 2 * margin, 10, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text(urgency === 'stat' ? '*** STAT - IMMEDIATE ATTENTION REQUIRED ***' : '*** URGENT ***', pageWidth / 2, yPos, { align: 'center' });
      doc.setTextColor(0, 0, 0);
      yPos += 15;
    }

    // Document Type Disclaimer
    if (document_type_disclaimer) {
      doc.setFillColor(239, 246, 255);
      doc.rect(margin, yPos - 3, pageWidth - 2 * margin, 8, 'F');
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text(document_type_disclaimer, pageWidth / 2, yPos, { align: 'center' });
      yPos += 12;
    }

    // Date and Time
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Date: ${date}`, margin, yPos);
    doc.text(`Time: ${time}`, pageWidth - margin, yPos, { align: 'right' });
    yPos += 10;

    // Horizontal line
    doc.setLineWidth(0.5);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 10;

    // Two-column layout for sender/recipient
    const colWidth = (pageWidth - 3 * margin) / 2;

    // Both columns share this top baseline. (The FROM column previously
    // recomputed its own start from a formula that omitted the header height,
    // drawing ~35mm too high and overprinting the title/urgency area.)
    const colTop = yPos;

    // TO Section
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('TO:', margin, yPos);
    yPos += 7;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(to_name || '', margin + 5, yPos);
    yPos += 5;
    if (to_organization) {
      doc.text(to_organization, margin + 5, yPos);
      yPos += 5;
    }
    doc.text(`Fax: ${to_fax}`, margin + 5, yPos);
    yPos += 5;
    if (to_phone) {
      doc.text(`Phone: ${to_phone}`, margin + 5, yPos);
      yPos += 5;
    }

    // FROM Section (right column) — aligned to the same top baseline as TO.
    let fromY = colTop;

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('FROM:', pageWidth / 2 + margin, fromY);
    fromY += 7;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(from_name || '', pageWidth / 2 + margin + 5, fromY);
    fromY += 5;
    if (from_organization) {
      doc.text(from_organization, pageWidth / 2 + margin + 5, fromY);
      fromY += 5;
    }
    if (from_phone) {
      doc.text(`Phone: ${from_phone}`, pageWidth / 2 + margin + 5, fromY);
      fromY += 5;
    }
    if (from_fax) {
      doc.text(`Fax: ${from_fax}`, pageWidth / 2 + margin + 5, fromY);
      fromY += 5;
    }
    if (from_address) {
      const addrLines = doc.splitTextToSize(from_address, colWidth - 10);
      doc.text(addrLines, pageWidth / 2 + margin + 5, fromY);
      fromY += addrLines.length * 5;
    }

    yPos = Math.max(yPos, fromY) + 5;

    // Horizontal line
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 10;

    // Document Details
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Document Details:', margin, yPos);
    yPos += 7;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Type: ${document_type}`, margin + 5, yPos);
    doc.text(`Total Pages: ${page_count}`, pageWidth / 2 + margin, yPos);
    yPos += 6;

    if (patient_name) {
      doc.text(`Patient: ${patient_name}`, margin + 5, yPos);
      if (patient_id) {
        doc.text(`ID: ${patient_id}`, pageWidth / 2 + margin, yPos);
      }
      yPos += 6;
    }

    yPos += 5;

    // Additional Notes
    if (notes) {
      doc.setFont('helvetica', 'bold');
      doc.text('Notes:', margin, yPos);
      yPos += 6;
      doc.setFont('helvetica', 'normal');
      yPos = addWrappedText(notes, margin + 5, yPos, pageWidth - 2 * margin - 5, 9);
      yPos += 5;
    }

    // HIPAA Disclaimer
    yPos += 5;
    doc.setFillColor(255, 243, 205);
    const disclaimerHeight = 60;
    doc.rect(margin, yPos - 3, pageWidth - 2 * margin, disclaimerHeight, 'F');
    
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('CONFIDENTIALITY NOTICE - HIPAA PROTECTED INFORMATION', pageWidth / 2, yPos, { align: 'center' });
    yPos += 6;

    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    const disclaimerLines = doc.splitTextToSize(hipaa_disclaimer, pageWidth - 2 * margin - 10);
    doc.text(disclaimerLines, margin + 5, yPos);
    yPos += disclaimerLines.length * 2.5 + 5;

    // Footer
    yPos = pageHeight - 20;
    doc.setFontSize(7);
    doc.setTextColor(100, 100, 100);
    doc.text('This cover sheet is for informational purposes only and does not constitute medical advice or treatment.', pageWidth / 2, yPos, { align: 'center' });
    doc.text(`Generated by ${from_organization} on ${date} at ${time}`, pageWidth / 2, yPos + 4, { align: 'center' });

    // Convert to buffer and upload
    const pdfBytes = doc.output('arraybuffer');
    const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
    
    const file_url_result = await base44.integrations.Core.UploadFile({ 
      file: pdfBlob 
    });

    return Response.json({
      success: true,
      file_url: file_url_result.file_url,
      cover_sheet_data: payload,
    });

  } catch (error) {
    console.error('Cover sheet generation error:', error);
    return Response.json({ 
      error: error.message,
      details: error.toString() 
    }, { status: 500 });
  }
});