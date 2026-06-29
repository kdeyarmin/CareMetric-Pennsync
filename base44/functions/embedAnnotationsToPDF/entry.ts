import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { PDFDocument, rgb } from 'npm:pdf-lib@1.17.1';

// SSRF guard: only fetch https URLs on public hosts, never internal IPs /
// metadata. Set FILE_URL_ALLOWED_HOSTS (comma-separated) to restrict to your
// storage host(s).
function isSafeFetchUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (['localhost', '0.0.0.0', '127.0.0.1', '::1', '169.254.169.254'].includes(host)) return false;
  if (host.endsWith('.internal') || host.endsWith('.local')) return false;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
  }
  const allow = Deno.env.get('FILE_URL_ALLOWED_HOSTS');
  if (allow) {
    const hosts = allow.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
    if (!hosts.some((h) => host === h || host.endsWith('.' + h))) return false;
  }
  return true;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { 
      pdf_url, 
      annotations,
      patient_id,
      document_type 
    } = await req.json();

    if (!pdf_url || !annotations) {
      return Response.json({ 
        error: 'Missing required fields: pdf_url and annotations' 
      }, { status: 400 });
    }

    if (!isSafeFetchUrl(pdf_url)) {
      return Response.json({ error: 'Invalid or disallowed pdf_url' }, { status: 400 });
    }
    // Fetch the original PDF
    const pdfResponse = await fetch(pdf_url);
    if (!pdfResponse.ok) {
      throw new Error(`Failed to fetch PDF: ${pdfResponse.statusText}`);
    }
    const pdfBytes = await pdfResponse.arrayBuffer();

    // Load the PDF document
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pages = pdfDoc.getPages();

    // Embed annotations for each page
    for (const [pageNumStr, pageAnnotations] of Object.entries(annotations)) {
      const pageNum = parseInt(pageNumStr);
      if (pageNum < 1 || pageNum > pages.length || !pageAnnotations || pageAnnotations.length === 0) {
        continue;
      }

      const page = pages[pageNum - 1];
      const { height } = page.getSize();

      for (const annotation of pageAnnotations) {
        // PDF coordinates start from bottom-left, canvas from top-left
        const pdfY = height - annotation.y;

        if (annotation.type === 'text') {
          page.drawText(annotation.text, {
            x: annotation.x,
            y: pdfY,
            size: annotation.fontSize || 14,
            color: rgb(0, 0, 0),
          });
        } else if (annotation.type === 'date') {
          page.drawText(annotation.text, {
            x: annotation.x,
            y: pdfY,
            size: 12,
            color: rgb(0, 0, 0),
          });
        } else if (annotation.type === 'signature' && annotation.signatureDataUrl) {
          // Embed the signature image. A bad/empty data URI or a non-PNG image
          // (canvas can emit JPEG) would otherwise throw and abort the whole
          // batch — guard the format and isolate per-annotation failures.
          try {
            const dataUrl = String(annotation.signatureDataUrl);
            const signatureBase64 = dataUrl.split(',')[1];
            if (signatureBase64) {
              const signatureBytes = Uint8Array.from(atob(signatureBase64), c => c.charCodeAt(0));
              const isJpeg = /^data:image\/jpe?g/i.test(dataUrl);
              const signatureImage = isJpeg
                ? await pdfDoc.embedJpg(signatureBytes)
                : await pdfDoc.embedPng(signatureBytes);

              page.drawImage(signatureImage, {
                x: annotation.x,
                y: pdfY - (annotation.height || 0),
                width: annotation.width || signatureImage.width,
                height: annotation.height || signatureImage.height,
              });
            }
          } catch (sigErr) {
            console.error('Failed to embed signature annotation:', sigErr.message);
          }
        }
      }
    }

    // Save the modified PDF
    const signedPdfBytes = await pdfDoc.save();

    // Upload the signed PDF to Base44 storage
    const blob = new Blob([signedPdfBytes], { type: 'application/pdf' });
    const fileName = `signed-${document_type || 'document'}-${patient_id || 'unknown'}-${Date.now()}.pdf`;
    
    const file = new File([blob], fileName, { type: 'application/pdf' });

    // Upload using Base44 integration
    const uploadResult = await base44.asServiceRole.integrations.Core.UploadFile({ file });

    // Count signatures
    const signatureCount = Object.values(annotations).reduce((count, pageAnnots) => {
      return count + (Array.isArray(pageAnnots) ? pageAnnots.filter(a => a.type === 'signature').length : 0);
    }, 0);

    // Log the signature event
    await base44.asServiceRole.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'document_signed',
      details: {
        document_type,
        patient_id,
        signature_count: signatureCount,
        total_annotations: Object.values(annotations).reduce((sum, arr) => sum + arr.length, 0),
        original_pdf: pdf_url,
        signed_pdf: uploadResult.file_url
      },
      page: 'pdf_signature'
    });

    return Response.json({
      success: true,
      signed_pdf_url: uploadResult.file_url,
      signature_count: signatureCount,
      signature_date: new Date().toISOString()
    });

  } catch (error) {
    console.error('PDF annotation error:', error);
    return Response.json({ 
      error: error.message || 'Failed to process PDF annotations' 
    }, { status: 500 });
  }
});