import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
// unpdf is a serverless-friendly PDF text extractor (pdf.js under the hood) that
// runs in Deno/edge — replaces the previous placeholder that stored "[Page N]"
// stubs, so searchPDFs can finally match real document content.
import { extractText, getDocumentProxy } from 'npm:unpdf@1.6.2';

// <<<BEGIN SHARED HELPER: protectedUserAuthz — generated, edit base44/_shared/backendHelpers.mjs>>>
const normalizeProtectedEmail = (value) => String(value || '').trim().toLowerCase();
const isProtectedAdmin = (user) => !!user && user.role === 'admin';
function isProtectedSuperAdmin(user) {
  const configuredEmail = normalizeProtectedEmail(Deno.env.get('SUPER_ADMIN_EMAIL'));
  return !!configuredEmail
    && isProtectedAdmin(user)
    && normalizeProtectedEmail(user.email) === configuredEmail;
}
// <<<END SHARED HELPER: protectedUserAuthz>>>

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
    const callerEmail = normalizeProtectedEmail(user.email);
    if (!callerEmail) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const {
      pdf_url, 
      document_name,
      document_type = 'other',
      patient_id
    } = body;

    if (typeof pdf_url !== 'string' || !pdf_url.trim() || pdf_url.trim().length > 4096) {
      return Response.json({ error: 'Invalid pdf_url' }, { status: 400 });
    }
    if (typeof document_name !== 'string'
      || !document_name.trim()
      || document_name.trim().length > 500) {
      return Response.json({ error: 'Invalid document_name' }, { status: 400 });
    }
    const allowedDocumentTypes = new Set([
      'consent',
      'assessment',
      'visit',
      'care_plan',
      'signature',
      'template',
      'other',
    ]);
    if (typeof document_type !== 'string' || !allowedDocumentTypes.has(document_type)) {
      return Response.json({ error: 'Invalid document_type' }, { status: 400 });
    }
    const hasPatientScope = patient_id != null && patient_id !== '';
    if (hasPatientScope
      && (typeof patient_id !== 'string' || !patient_id.trim() || patient_id.trim().length > 200)) {
      return Response.json({ error: 'Invalid patient_id' }, { status: 400 });
    }
    const scopedPdfUrl = pdf_url.trim();
    const scopedDocumentName = document_name.trim();
    const scopedPatientId = hasPatientScope ? patient_id.trim() : null;
    const callerIsSuperAdmin = isProtectedSuperAdmin(user);

    if (!isSafeFetchUrl(scopedPdfUrl)) {
      return Response.json({ error: 'Invalid or disallowed pdf_url' }, { status: 400 });
    }

    // A patient-bound index may be created or refreshed only by that Patient's
    // direct creator, an explicitly assigned nurse, or the configured protected
    // platform owner. Custom account and agency fields are self-mutable and are
    // never authorization. Re-check the exact row in memory in case the backend
    // ignores or regresses its service-role filter.
    if (scopedPatientId) {
      const patientRows = await base44.asServiceRole.entities.Patient
        .filter({ id: scopedPatientId }, '', 1).catch(() => []);
      const patient = (Array.isArray(patientRows) ? patientRows : [])
        .find((row) => String(row?.id || '').trim() === scopedPatientId);
      if (!patient) {
        return Response.json({ error: 'Patient not found' }, { status: 404 });
      }
      const isOwner = normalizeProtectedEmail(patient.created_by) === callerEmail;
      const isAssigned = Array.isArray(patient.assigned_nurses)
        && patient.assigned_nurses.some(
          (email) => normalizeProtectedEmail(email) === callerEmail,
        );
      if (!isOwner && !isAssigned && !callerIsSuperAdmin) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    // Scope lookup by the target relationship instead of selecting the first
    // global pdf_url match. This prevents one patient/user from overwriting a row
    // belonging to another scope when the same storage URL is reused. Treat a
    // duplicate within the exact target scope as ambiguous and fail closed.
    const existingFilter = { pdf_url: scopedPdfUrl };
    if (scopedPatientId) existingFilter.patient_id = scopedPatientId;
    else if (!callerIsSuperAdmin) existingFilter.created_by = callerEmail;
    const returnedIndexes = await base44.asServiceRole.entities.PDFIndex.filter(
      existingFilter,
      '-created_date',
      2,
    );
    const matchingIndexes = (Array.isArray(returnedIndexes) ? returnedIndexes : [])
      .filter((row) => {
        if (!row || typeof row !== 'object' || String(row.pdf_url || '').trim() !== scopedPdfUrl) {
          return false;
        }
        if (scopedPatientId) {
          return String(row.patient_id || '').trim() === scopedPatientId;
        }
        if (String(row.patient_id || '').trim()) return false;
        return callerIsSuperAdmin
          || normalizeProtectedEmail(row.created_by) === callerEmail;
      });
    if (matchingIndexes.length > 1) {
      return Response.json({ error: 'Ambiguous existing PDF index' }, { status: 409 });
    }
    const existingIndex = matchingIndexes[0] || null;

    // Fetch PDF (re-validating any redirect hop)
    const response = await safeFetchFollow(scopedPdfUrl);
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

    const indexData = {
      pdf_url: scopedPdfUrl,
      document_name: scopedDocumentName,
      document_type,
      ...(scopedPatientId ? { patient_id: scopedPatientId } : {}),
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
    if (existingIndex) {
      const existingId = typeof existingIndex.id === 'string' ? existingIndex.id.trim() : '';
      if (!existingId) {
        return Response.json({ error: 'Invalid existing PDF index' }, { status: 409 });
      }
      // Deliberately omit created_by on update: the immutable original owner must
      // never be reassigned by a refresh, including a protected-superadmin refresh.
      await base44.asServiceRole.entities.PDFIndex.update(existingId, indexData);
      indexId = existingId;
    } else {
      // Service-role creates otherwise receive a service identity. Explicitly
      // stamp Base44's immutable system ownership field with the authenticated
      // caller so owner-only RLS and unscoped search remain meaningful.
      const created = await base44.asServiceRole.entities.PDFIndex.create({
        ...indexData,
        created_by: callerEmail,
      });
      indexId = typeof created?.id === 'string' ? created.id.trim() : '';
      if (!indexId) throw new Error('PDFIndex create returned no id');
    }

    await base44.asServiceRole.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'pdf_indexed',
      entity_type: 'PDFIndex',
      entity_id: indexId,
      details: {
        page_count: pageCount,
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
