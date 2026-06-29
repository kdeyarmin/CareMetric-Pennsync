import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { jsPDF } from 'npm:jspdf';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const requestedModule = body.moduleName || body.module_title || null;
    const recordId = body.completion_id || body.certificate_id || null;
    const moduleId = body.module_id || null;

    // Re-derive the certificate's facts from a record the caller actually OWNS so
    // a cert can't be minted for training they never completed. Reads are scoped
    // to the caller's own email (reliable regardless of per-id RLS). Callers pass
    // inconsistent shapes (moduleName / module_title+certificate_id /
    // completion_id+module_id) — all are resolved here.
    const [myCerts, myAssignments] = await Promise.all([
      base44.asServiceRole.entities.TrainingCertificate.filter({ user_id: user.email }, '-issued_at', 500).catch(() => []),
      base44.asServiceRole.entities.TrainingAssignment.filter({ assigned_to_user_id: user.email }, '-completion_date', 500).catch(() => []),
    ]);
    const myCompleted = myAssignments.filter((a) => a.status === 'completed' || a.pass_fail_result === 'passed');

    if (myCerts.length === 0 && myCompleted.length === 0) {
      return Response.json({ error: 'No completed training found for this account.' }, { status: 403 });
    }

    const norm = (s) => String(s || '').trim().toLowerCase();
    let moduleName = null;
    let completionDate = null;
    let score = null;

    const cert = myCerts.find((c) =>
      (recordId && (c.id === recordId || c.certificate_id === recordId)) ||
      (requestedModule && norm(c.course_title) === norm(requestedModule)));
    if (cert) {
      moduleName = cert.course_title || requestedModule;
      completionDate = cert.completion_date || cert.issued_at || null;
      score = typeof cert.score === 'number' ? cert.score : null;
    } else {
      // Fall back to a completed course assignment the caller owns. Match by the
      // assignment id (recordId) or, for legacy callers, the course id (moduleId).
      const comp = myCompleted.find((a) =>
        (recordId && a.id === recordId) || (moduleId && a.course_id === moduleId) ||
        (requestedModule && norm(a.course_title) === norm(requestedModule)));
      if (comp) {
        completionDate = comp.completion_date || null;
        score = typeof comp.score_percentage === 'number' ? comp.score_percentage : null;
        moduleName = comp.course_title || requestedModule;
      } else if (recordId) {
        // A specific record was requested but none of the caller's records match
        // it — refuse rather than mint against an id they don't own.
        return Response.json({ error: 'Training record not found for this account.' }, { status: 403 });
      }
    }

    // Fall back to the request only for display fields we could not derive (the
    // legacy caller that passes just moduleName); ownership is already established
    // by the non-empty owned-record check above.
    moduleName = moduleName || requestedModule;
    completionDate = completionDate || body.completionDate || body.completion_date || null;
    if (score === null && typeof body.score === 'number') score = body.score;

    if (!moduleName || !completionDate) {
      return Response.json({ error: 'Module name and completion date required' }, { status: 400 });
    }

    const doc = new jsPDF('landscape');

    // Certificate border
    doc.setDrawColor(79, 70, 229);
    doc.setLineWidth(2);
    doc.rect(10, 10, 277, 190, 'S');
    doc.setLineWidth(0.5);
    doc.rect(15, 15, 267, 180, 'S');

    // Decorative corners
    doc.setFillColor(79, 70, 229);
    [
      [10, 10], [287, 10], [10, 200], [287, 200]
    ].forEach(([x, y]) => {
      doc.circle(x, y, 3, 'F');
    });

    // Fetch and add logo
    try {
      const logoUrl = 'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/68ee80d98929370f9e8f2932/52cac091f_20170AA9-BB95-4BA4-B4E7-793615312CC4.png';
      const logoResponse = await fetch(logoUrl);
      const logoBlob = await logoResponse.blob();
      const logoArrayBuffer = await logoBlob.arrayBuffer();
      const logoBase64 = btoa(String.fromCharCode(...new Uint8Array(logoArrayBuffer)));
      const logoDataUrl = `data:image/png;base64,${logoBase64}`;
      doc.addImage(logoDataUrl, 'PNG', 128.5, 25, 40, 40);
    } catch (error) {
      console.error('Logo fetch failed:', error);
    }

    // Title
    doc.setFontSize(36);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(79, 70, 229);
    doc.text('Certificate of Completion', 148.5, 80, { align: 'center' });

    // Subtitle
    doc.setFontSize(14);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(107, 114, 128);
    doc.text('This certifies that', 148.5, 95, { align: 'center' });

    // Name
    doc.setFontSize(28);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(user.full_name || 'User', 148.5, 110, { align: 'center' });

    // Line under name
    doc.setDrawColor(79, 70, 229);
    doc.setLineWidth(0.5);
    doc.line(90, 112, 207, 112);

    // Body text
    doc.setFontSize(13);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(55, 65, 81);
    doc.text('has successfully completed the training module', 148.5, 125, { align: 'center' });

    // Module name
    doc.setFontSize(18);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(79, 70, 229);
    const moduleLines = doc.splitTextToSize(moduleName, 200);
    const moduleY = 135 + (moduleLines.length - 1) * 3;
    doc.text(moduleLines, 148.5, 135, { align: 'center' });

    // Score (if provided)
    if (score !== undefined && score !== null) {
      doc.setFontSize(12);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(34, 197, 94);
      doc.text(`Score: ${Math.round(score)}%`, 148.5, moduleY + 10, { align: 'center' });
    }

    // Date
    doc.setFontSize(11);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(107, 114, 128);
    const formattedDate = new Date(completionDate).toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
    doc.text(`Completion Date: ${formattedDate}`, 148.5, moduleY + 20, { align: 'center' });

    // Signature line
    doc.setDrawColor(107, 114, 128);
    doc.setLineWidth(0.3);
    doc.line(50, 175, 120, 175);
    doc.line(177, 175, 247, 175);

    doc.setFontSize(9);
    doc.setTextColor(107, 114, 128);
    doc.text('Penn Sync Training Platform', 85, 182, { align: 'center' });
    doc.text('Certificate ID: ' + Date.now().toString(36).toUpperCase(), 212, 182, { align: 'center' });

    // Footer
    doc.setFillColor(79, 70, 229);
    doc.rect(0, 195, 297, 15, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.text('Penn Sync - AI-Powered Healthcare Training & Documentation', 148.5, 203, { align: 'center' });

    const pdfBytes = doc.output('arraybuffer');

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename=Training_Certificate_${(user.full_name || 'User').replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`
      }
    });
  } catch (error) {
    console.error('Error generating certificate:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});