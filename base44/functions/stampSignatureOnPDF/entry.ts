/**
 * stampSignatureOnPDF
 *
 * Accepts a PDF URL + a base64 PNG signature data-url, stamps the signature
 * at the bottom-right of the last page, uploads the result and returns the new URL.
 *
 * Body: { pdf_url: string, signature_data_url: string }
 * Returns: { file_url: string }
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { PDFDocument, rgb } from 'npm:pdf-lib@1.17.1';

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

function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
function isInternalInvoke(body) {
  const expected = String(Deno.env.get('INTERNAL_FN_SECRET') || '').trim();
  if (!expected) return false;
  return timingSafeEqualStr(String(body?.internal_secret || '').trim(), expected);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (user && isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    const body = await req.json();
    // Authenticated user OR trusted nested invoke from submitSignerSignature
    // (public capability-token portal has no session).
    if (!user && !isInternalInvoke(body)) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { pdf_url, signature_data_url } = body;
    if (!pdf_url || !signature_data_url) {
      return Response.json({ error: 'Missing pdf_url or signature_data_url' }, { status: 400 });
    }

    if (!isSafeFetchUrl(pdf_url)) return Response.json({ error: 'Invalid or disallowed pdf_url' }, { status: 400 });
    // Fetch the PDF bytes with MANUAL redirects, re-validating every hop —
    // redirect:'follow' would let an allowlisted host 3xx into an internal/
    // metadata address (mirrors processPatientFileUpdate's safeFetchFollow).
    // Guard response.ok so an expired/404 storage URL yields a clean 400
    // instead of feeding an HTML error page into pdf-lib (opaque 500).
    let pdfResponse = null;
    let nextUrl = pdf_url;
    for (let hop = 0; hop < 4; hop++) {
      pdfResponse = await fetch(nextUrl, { redirect: 'manual' });
      if (pdfResponse.status >= 300 && pdfResponse.status < 400) {
        const location = pdfResponse.headers.get('location');
        if (!location) break;
        const resolved = new URL(location, nextUrl).toString();
        if (!isSafeFetchUrl(resolved)) {
          return Response.json({ error: 'Invalid or disallowed pdf_url redirect' }, { status: 400 });
        }
        nextUrl = resolved;
        continue;
      }
      break;
    }
    if (!pdfResponse || !pdfResponse.ok) {
      return Response.json({ error: 'Failed to fetch PDF' }, { status: 400 });
    }
    const pdfBytes = await pdfResponse.arrayBuffer();

    // Load PDF
    const pdfDoc = await PDFDocument.load(pdfBytes);

    // Convert data-url to Uint8Array
    const base64 = signature_data_url.replace(/^data:image\/png;base64,/, '');
    const sigBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));

    // Embed signature image
    const sigImage = await pdfDoc.embedPng(sigBytes);
    const sigDims = sigImage.scale(0.3); // scale down

    // Stamp on the last page, bottom-right with margin
    const pages = pdfDoc.getPages();
    const lastPage = pages[pages.length - 1];
    const { width, height } = lastPage.getSize();

    const margin = 30;
    lastPage.drawImage(sigImage, {
      x: width - sigDims.width - margin,
      y: margin,
      width: sigDims.width,
      height: sigDims.height,
    });

    // Add a thin line above the signature
    lastPage.drawLine({
      start: { x: width - sigDims.width - margin, y: margin + sigDims.height + 4 },
      end:   { x: width - margin,                  y: margin + sigDims.height + 4 },
      thickness: 0.5,
      color: rgb(0.5, 0.5, 0.5),
    });

    // Add "Signed" label
    lastPage.drawText('Signed', {
      x: width - sigDims.width - margin,
      y: margin + sigDims.height + 8,
      size: 7,
      color: rgb(0.4, 0.4, 0.4),
    });

    const signedPdfBytes = await pdfDoc.save();

    // Upload signed PDF
    const blob = new Blob([signedPdfBytes], { type: 'application/pdf' });
    const file = new File([blob], 'signed-fax.pdf', { type: 'application/pdf' });
    const { file_url } = await base44.asServiceRole.integrations.Core.UploadFile({ file });

    return Response.json({ file_url });
  } catch (error) {
    console.error('stampSignatureOnPDF failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});