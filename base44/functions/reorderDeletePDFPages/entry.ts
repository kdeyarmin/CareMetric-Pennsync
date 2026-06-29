import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { PDFDocument } from 'npm:pdf-lib@1.17.1';

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
    const response = await fetch(pdf_url);
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
      error: error.message || 'Failed to modify PDF pages' 
    }, { status: 500 });
  }
});