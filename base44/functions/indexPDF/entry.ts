import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
// unpdf is a serverless-friendly PDF text extractor (pdf.js under the hood) that
// runs in Deno/edge — replaces the previous placeholder that stored "[Page N]"
// stubs, so searchPDFs can finally match real document content.
import { extractText, getDocumentProxy } from 'npm:unpdf@1.6.2';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


// <<<BEGIN SHARED HELPER: isSafeFetchUrl — generated, edit base44/_shared/backendHelpers.mjs>>>
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
// <<<END SHARED HELPER: isSafeFetchUrl>>>

// Fetch that re-validates every redirect hop against isSafeFetchUrl. With the
// default redirect:'follow' the guard only checks the FIRST URL, so an
// allowlisted host that 3xx-redirects to an internal/metadata IP would still be
// fetched (SSRF). Returns null if a hop resolves to a disallowed host.
// Mirrors importProvidersCsv.
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

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    const { 
      pdf_url, 
      document_name,
      document_type = 'other',
      patient_id
    } = await req.json();

    if (!pdf_url || !document_name) {
      return Response.json({
        error: 'Missing required fields: pdf_url, document_name'
      }, { status: 400 });
    }

    // Authorization: a PDFIndex row is access-controlled by its patient_id
    // (searchPDFs scopes results on it). Without a check here a non-admin could
    // index a PDF holding another patient's PHI under a patient THEY can read —
    // surfacing it in their scope — and the pdf_url-keyed update branch below
    // could clobber an index belonging to a scope they can't access. Mirror
    // searchPDFs' patient-scope check for both the target and the existing row.
    const isSuperAdmin = user.account_type === 'super_admin';
    const isAgencyScopedAdmin =
      user.account_type === 'agency_admin'
      || (user.role === 'admin' && !!user.agency_name && !isSuperAdmin);
    const isPlatformAdmin = isSuperAdmin || (user.role === 'admin' && !user.agency_name);
    const assertPatientAccess = async (pid) => {
      if (!pid) return true;
      const [p] = await base44.asServiceRole.entities.Patient.filter({ id: pid }, undefined, 5000).catch(() => []);
      if (!p) return false;
      if (isPlatformAdmin) return true;
      if (p.created_by === user.email
        || (Array.isArray(p.assigned_nurses) && p.assigned_nurses.includes(user.email))) {
        return true;
      }
      if (isAgencyScopedAdmin && user.agency_name) {
        const agencyUsers = await base44.asServiceRole.entities.User.list('-created_date', 5000).catch(() => []);
        const agencyEmails = new Set(
          (agencyUsers || [])
            .filter((u) => u.agency_name === user.agency_name && u.email)
            .map((u) => u.email),
        );
        return !!(p.created_by && agencyEmails.has(p.created_by))
          || (Array.isArray(p.assigned_nurses) && p.assigned_nurses.some((e) => agencyEmails.has(e)));
      }
      return false;
    };
    if (!(await assertPatientAccess(patient_id))) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!isSafeFetchUrl(pdf_url)) {
      return Response.json({ error: 'Invalid or disallowed pdf_url' }, { status: 400 });
    }
    // Fetch PDF (re-validating any redirect hop)
    const response = await safeFetchFollow(pdf_url);
    if (!response) {
      return Response.json({ error: 'Redirect to a disallowed host blocked' }, { status: 400 });
    }
    if (!response.ok) {
      throw new Error('Failed to fetch PDF');
    }
    
    const pdfBytes = await response.arrayBuffer();

    // Extract real, per-page text. mergePages:false returns one string per page.
    const pdf = await getDocumentProxy(new Uint8Array(pdfBytes));
    const { totalPages, text: perPageText } = await extractText(pdf, { mergePages: false });
    const pageCount = totalPages || (Array.isArray(perPageText) ? perPageText.length : 0);
    const pages = Array.isArray(perPageText) ? perPageText : [perPageText];

    const pageContents = [];
    let fullText = '';
    for (let i = 0; i < pageCount; i++) {
      // Collapse the whitespace pdf.js emits between text runs.
      const textContent = String(pages[i] || '').replace(/\s+/g, ' ').trim();
      pageContents.push({ page_number: i + 1, text: textContent });
      fullText += textContent + '\n';
    }

    // Extract keywords (simple word frequency analysis)
    const words = fullText.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3);
    
    const wordFreq = {};
    words.forEach(word => {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    });
    
    const keywords = Object.entries(wordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word]) => word);

    // Create or update index
    const existingIndex = await base44.asServiceRole.entities.PDFIndex.filter({
      pdf_url
    }, undefined, 5000);

    const indexData = {
      pdf_url,
      document_name,
      document_type,
      patient_id,
      extracted_text: fullText,
      page_contents: pageContents,
      metadata: {
        page_count: pageCount,
        file_size: pdfBytes.byteLength,
        indexed_at: new Date().toISOString()
      },
      keywords
    };

    let indexId;
    if (existingIndex.length > 0) {
      // Don't let a caller overwrite an index scoped to a patient they can't access.
      if (!(await assertPatientAccess(existingIndex[0].patient_id))) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
      await base44.asServiceRole.entities.PDFIndex.update(existingIndex[0].id, indexData);
      indexId = existingIndex[0].id;
    } else {
      const created = await base44.asServiceRole.entities.PDFIndex.create(indexData);
      indexId = created.id;
    }

    await base44.asServiceRole.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'pdf_indexed',
      details: {
        pdf_url,
        document_name,
        page_count: pageCount,
        index_id: indexId
      },
      page: 'pdf_indexer'
    });

    return Response.json({
      success: true,
      index_id: indexId,
      page_count: pageCount,
      text_length: fullText.length,
      keywords_count: keywords.length
    });

  } catch (error) {
    console.error('PDF indexing error:', error);
    return Response.json({ 
      error: 'Failed to index PDF' 
    }, { status: 500 });
  }
});