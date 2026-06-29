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

    const { pdf_urls } = await req.json();

    if (!pdf_urls || pdf_urls.length < 2) {
      return Response.json({ 
        error: 'At least 2 PDF URLs required' 
      }, { status: 400 });
    }

    // Create new PDF document
    const mergedPdf = await PDFDocument.create();

    // Fetch and merge each PDF
    for (const url of pdf_urls) {
      if (!isSafeFetchUrl(url)) {
        return Response.json({ error: 'Invalid or disallowed PDF URL' }, { status: 400 });
      }
      const response = await fetch(url);
      if (!response.ok) {
        return Response.json({ error: `Could not fetch a source PDF (HTTP ${response.status})` }, { status: 400 });
      }
      const pdfBytes = await response.arrayBuffer();
      const pdf = await PDFDocument.load(pdfBytes);
      
      const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      copiedPages.forEach((page) => {
        mergedPdf.addPage(page);
      });
    }

    // Save merged PDF
    const mergedPdfBytes = await mergedPdf.save();
    const blob = new Blob([mergedPdfBytes], { type: 'application/pdf' });
    const file = new File([blob], `merged-${Date.now()}.pdf`, { type: 'application/pdf' });

    const uploadResult = await base44.asServiceRole.integrations.Core.UploadFile({ file });

    await base44.asServiceRole.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'pdfs_merged',
      details: {
        source_pdfs: pdf_urls,
        merged_pdf: uploadResult.file_url,
        pdf_count: pdf_urls.length
      },
      page: 'pdf_merger'
    });

    return Response.json({
      success: true,
      merged_pdf_url: uploadResult.file_url
    });

  } catch (error) {
    console.error('PDF merge error:', error);
    return Response.json({ 
      error: error.message || 'Failed to merge PDFs' 
    }, { status: 500 });
  }
});