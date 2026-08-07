import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { PDFDocument, rgb } from 'npm:pdf-lib@1.17.1';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


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

// SSRF guard: only fetch https URLs on the app's own storage/app hosts, never
// internal IPs / metadata. The allowlist is hardcoded (always-on, fail-closed)
// rather than env-configured; add a host here if file storage ever moves.
const FILE_URL_ALLOWED_HOSTS = ['qtrypzzcjebvfcihiynt.supabase.co', 'base44.app', 'base44.io'];
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
  if (!FILE_URL_ALLOWED_HOSTS.some((h) => host === h || host.endsWith('.' + h))) return false;
  return true;
}

// Fetch that re-validates every redirect hop against isSafeFetchUrl. With the
// default redirect:'follow' the guard only checks the FIRST URL, so an
// allowlisted host that 3xx-redirects to an internal/metadata IP would still be
// fetched (SSRF). Returns null if a hop resolves to a disallowed host.
async function safeFetchFollow(initialUrl) {
  let response;
  let nextUrl = initialUrl;
  for (let hop = 0; hop < 4; hop++) {
    response = await fetch(nextUrl, { redirect: 'manual' });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) break;
      const resolved = new URL(location, nextUrl).toString();
      if (!isSafeFetchUrl(resolved)) return null;
      nextUrl = resolved;
      continue;
    }
    break;
  }
  return response;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

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
    // Fetch original PDF. Guard response.ok so an expired/404 storage URL yields
    // a clean 400 instead of feeding an HTML error page into pdf-lib (opaque 500).
    const pdfResponse = await safeFetchFollow(original_pdf_url);
    if (!pdfResponse) {
      return Response.json({ error: 'Redirect to a disallowed host blocked' }, { status: 400 });
    }
    if (!pdfResponse.ok) {
      return Response.json({ error: 'Failed to fetch original PDF' }, { status: 400 });
    }
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
      error: 'Failed to annotate PDF' 
    }, { status: 500 });
  }
});