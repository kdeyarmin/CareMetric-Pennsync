import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { PDFDocument } from 'npm:pdf-lib@1.17.1';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


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

    const { pdf_url, page_order } = await req.json();

    if (!pdf_url || !page_order || page_order.length === 0) {
      return Response.json({ 
        error: 'Missing required fields' 
      }, { status: 400 });
    }

    if (!isSafeFetchUrl(pdf_url)) {
      return Response.json({ error: 'Invalid or disallowed pdf_url' }, { status: 400 });
    }
    // Fetch original PDF
    const response = await safeFetchFollow(pdf_url);
    if (!response) {
      return Response.json({ error: 'Invalid or disallowed pdf_url' }, { status: 400 });
    }
    if (!response.ok) {
      return Response.json({ error: 'Failed to fetch PDF' }, { status: 400 });
    }
    const pdfBytes = await response.arrayBuffer();
    const originalPdf = await PDFDocument.load(pdfBytes);
    const pageCount = originalPdf.getPageCount();

    // Create new PDF with reordered/filtered pages
    const newPdf = await PDFDocument.create();

    for (const pageNum of page_order) {
      // page_order is caller-supplied: validate before copyPages, which throws a
      // generic 500 on an out-of-range/non-integer index.
      const idx = pageNum - 1;
      if (!Number.isInteger(idx) || idx < 0 || idx >= pageCount) {
        return Response.json({ error: `Invalid page number: ${pageNum}` }, { status: 400 });
      }
      const [copiedPage] = await newPdf.copyPages(originalPdf, [idx]);
      newPdf.addPage(copiedPage);
    }

    // Save modified PDF
    const modifiedPdfBytes = await newPdf.save();
    const blob = new Blob([modifiedPdfBytes], { type: 'application/pdf' });
    const file = new File([blob], `modified-${Date.now()}.pdf`, { type: 'application/pdf' });

    const uploadResult = await base44.asServiceRole.integrations.Core.UploadFile({ file });

    await base44.asServiceRole.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'pdf_pages_modified',
      details: {
        original_pdf: pdf_url,
        modified_pdf: uploadResult.file_url,
        original_page_count: originalPdf.getPageCount(),
        final_page_count: page_order.length
      },
      page: 'pdf_page_manager'
    });

    return Response.json({
      success: true,
      modified_pdf_url: uploadResult.file_url
    });

  } catch (error) {
    console.error('PDF page modification error:', error);
    return Response.json({ 
      error: 'Failed to modify PDF pages' 
    }, { status: 500 });
  }
});