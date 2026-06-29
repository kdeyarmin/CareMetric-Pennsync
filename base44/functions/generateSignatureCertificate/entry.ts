import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { jsPDF } from 'npm:jspdf@2.5.2';

/**
 * generateSignatureCertificate — renders a downloadable Certificate of Completion
 * PDF for a signed DocumentSignature. Reuses signatureIntegrity's `certificate`
 * action for the verification verdict + signer roster (so the tamper-evidence
 * logic lives in exactly one place), then lays it out as a PDF.
 *
 * Body: { signature_id }
 */

const VERDICT_LABEL = {
  valid: 'VERIFIED — content is intact and matches the sealed signature',
  tampered: 'TAMPERED — the record no longer matches what was signed',
  unverifiable: 'UNVERIFIABLE — signing secret not available to verify',
  unsigned: 'NOT SEALED — no tamper-evidence MAC on this record',
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { signature_id } = await req.json();
    if (!signature_id) return Response.json({ error: 'signature_id is required' }, { status: 400 });

    // Reuse the canonical verification + summary (forwards this user's context).
    const resp = await base44.functions.invoke('signatureIntegrity', {
      action: 'certificate',
      signature_id,
    });
    const cert = resp?.data?.certificate;
    if (!cert) return Response.json({ error: 'Could not build certificate' }, { status: 404 });

    const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : '—');
    const doc = new jsPDF();
    let y = 24;

    doc.setFontSize(22);
    doc.setFont(undefined, 'bold');
    doc.text('Certificate of Completion', 105, y, { align: 'center' });
    y += 8;
    doc.setFontSize(11);
    doc.setFont(undefined, 'normal');
    doc.text('Electronic Signature Record', 105, y, { align: 'center' });
    y += 14;

    doc.setDrawColor(200);
    doc.line(20, y, 190, y);
    y += 12;

    const row = (label, value) => {
      doc.setFont(undefined, 'bold');
      doc.text(`${label}:`, 20, y);
      doc.setFont(undefined, 'normal');
      doc.text(String(value ?? '—'), 70, y);
      y += 9;
    };

    doc.setFontSize(12);
    row('Document', cert.document_title);
    row('Document ID', cert.document_id);
    row('Status', cert.status);
    row('Completed', fmt(cert.completed_date));
    row('Sealed at', fmt(cert.stamped_at));

    y += 4;
    doc.setFont(undefined, 'bold');
    doc.text('Integrity verification', 20, y); y += 9;
    doc.setFont(undefined, 'normal');
    const v = cert.verification || {};
    const verdict = VERDICT_LABEL[v.status] || v.status || 'unknown';
    // Green for valid, red for tampered, amber otherwise.
    if (v.status === 'valid') doc.setTextColor(22, 130, 60);
    else if (v.status === 'tampered') doc.setTextColor(190, 30, 30);
    else doc.setTextColor(180, 120, 0);
    const wrapped = doc.splitTextToSize(verdict, 170);
    doc.text(wrapped, 20, y); y += wrapped.length * 7;
    doc.setTextColor(0, 0, 0);
    row('Algorithm', v.alg || '—');

    y += 4;
    doc.setFont(undefined, 'bold');
    doc.text('Signers', 20, y); y += 9;
    doc.setFont(undefined, 'normal');
    doc.setFontSize(11);
    for (const s of cert.signers || []) {
      if (y > 270) { doc.addPage(); y = 20; }
      const line = `${s.name || 'Signer'}${s.email ? ` <${s.email}>` : ''} — ${s.role || 'signer'} — ${s.status || 'pending'}${s.signed_date ? `, signed ${fmt(s.signed_date)}` : ''}`;
      const lw = doc.splitTextToSize(line, 170);
      doc.text(lw, 20, y); y += lw.length * 6 + 2;
    }

    y += 6;
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(`Generated ${fmt(cert.generated_at)} for ${user.full_name || user.email}.`, 20, y);

    const pdfBytes = doc.output('arraybuffer');
    return new Response(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="certificate-of-completion-${signature_id}.pdf"`,
      },
    });
  } catch (error) {
    console.error('generateSignatureCertificate error:', error);
    return Response.json({ error: 'Failed to generate certificate' }, { status: 500 });
  }
});
