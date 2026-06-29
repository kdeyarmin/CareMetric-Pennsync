import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { PDFDocument, rgb } from 'npm:pdf-lib@1.17.1';

// Parse a "#RRGGBB" string into a pdf-lib color, defaulting to black. A missing
// or malformed annotation.color previously threw (slice on undefined) or fed NaN
// into rgb() — either aborting the whole request with a 500.
const hexToRgb = (hex) => {
  const h = String(hex || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return rgb(0, 0, 0);
  return rgb(
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255
  );
};

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

    const { original_pdf_url, annotations, total_pages } = await req.json();

    if (!original_pdf_url || !annotations) {
      return Response.json({ 
        error: 'Missing required fields' 
      }, { status: 400 });
    }

    if (!isSafeFetchUrl(original_pdf_url)) {
      return Response.json({ error: 'Invalid or disallowed original_pdf_url' }, { status: 400 });
    }
    // Fetch original PDF
    const pdfResponse = await fetch(original_pdf_url);
    const pdfBytes = await pdfResponse.arrayBuffer();
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pages = pdfDoc.getPages();

    // Apply annotations to each page
    for (const annotation of annotations) {
      const page = pages[annotation.page - 1];
      if (!page) continue;

      const { height } = page.getSize();

      if (annotation.type === 'text') {
        page.drawText(annotation.text, {
          x: annotation.x,
          y: height - annotation.y,
          size: annotation.fontSize || 16,
          color: hexToRgb(annotation.color),
        });
      } else if (annotation.type === 'highlight') {
        page.drawRectangle({
          x: annotation.x,
          y: height - annotation.y - annotation.height,
          width: annotation.width,
          height: annotation.height,
          color: hexToRgb(annotation.color),
          opacity: 0.3,
        });
      } else if (annotation.type === 'draw') {
        // Draw path as series of lines
        for (let i = 1; i < annotation.path.length; i++) {
          const from = annotation.path[i - 1];
          const to = annotation.path[i];
          
          page.drawLine({
            start: { x: from.x, y: height - from.y },
            end: { x: to.x, y: height - to.y },
            thickness: annotation.lineWidth || 2,
            color: hexToRgb(annotation.color),
          });
        }
      }
    }

    // Save PDF
    const annotatedPdfBytes = await pdfDoc.save();
    const blob = new Blob([annotatedPdfBytes], { type: 'application/pdf' });
    const file = new File([blob], `annotated-${Date.now()}.pdf`, { type: 'application/pdf' });

    const uploadResult = await base44.asServiceRole.integrations.Core.UploadFile({ file });

    await base44.asServiceRole.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'pdf_annotated',
      details: {
        original_pdf: original_pdf_url,
        annotated_pdf: uploadResult.file_url,
        annotation_count: annotations.length
      },
      page: 'pdf_editor'
    });

    return Response.json({
      success: true,
      annotated_pdf_url: uploadResult.file_url
    });

  } catch (error) {
    console.error('PDF annotation error:', error);
    return Response.json({ 
      error: error.message || 'Failed to annotate PDF' 
    }, { status: 500 });
  }
});