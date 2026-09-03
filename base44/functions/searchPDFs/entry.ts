import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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

// ---- BM25 relevance ranking (algorithm mirrors src/lib/bm25.js, tested there) ----
// BM25 weights term frequency by document length and term rarity (IDF), so a rare
// clinical term that recurs in a short note outranks a common word in a long one —
// a real improvement over the previous substring-or-fraction-of-words scoring.
const TOKEN_RE = /[a-z0-9]+/g;
function tokenize(text) {
  return String(text || '').toLowerCase().match(TOKEN_RE) || [];
}
function buildBm25(docs, k1 = 1.5, b = 0.75) {
  const N = docs.length;
  const docTokens = docs.map((d) => tokenize(d.text));
  const docLen = docTokens.map((t) => t.length);
  const avgdl = N ? docLen.reduce((a, c) => a + c, 0) / N : 0;
  const df = new Map();
  for (const tokens of docTokens) {
    for (const term of new Set(tokens)) df.set(term, (df.get(term) || 0) + 1);
  }
  const tf = docTokens.map((tokens) => {
    const m = new Map();
    for (const t of tokens) m.set(t, (m.get(t) || 0) + 1);
    return m;
  });
  return { N, docLen, avgdl, df, tf, k1, b };
}
function bm25Score(model, i, queryTerms) {
  const { tf, docLen, avgdl, k1, b } = model;
  let score = 0;
  for (const term of queryTerms) {
    const f = tf[i]?.get(term) || 0;
    if (f === 0) continue;
    const n = model.df.get(term) || 0;
    const idf = Math.log(1 + (model.N - n + 0.5) / (n + 0.5));
    const denom = f + k1 * (1 - b + b * (docLen[i] / (avgdl || 1)));
    score += idf * (f * (k1 + 1)) / denom;
  }
  return score;
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
      query,
      document_type,
      patient_id,
      fuzzy = true,
      count_only = false,
      limit: rawLimit = 50
    } = body;

    // Clamp the caller-supplied limit: it drives a `limit * 2` fetch cap, so an
    // unbounded value (e.g. 500000) would pull the entire PDFIndex — with its
    // extracted PHI text — into memory per request.
    const limit = Math.min(Math.max(Math.floor(Number(rawLimit) || 50), 1), 200);

    if (count_only !== true && count_only !== false) {
      return Response.json({ error: 'count_only must be boolean' }, { status: 400 });
    }
    if (!count_only
      && (typeof query !== 'string' || query.trim().length < 2 || query.trim().length > 500)) {
      return Response.json({ 
        error: 'Query must be between 2 and 500 characters'
      }, { status: 400 });
    }
    const searchQuery = count_only ? '' : query.trim();
    if (fuzzy !== true && fuzzy !== false) {
      return Response.json({ error: 'fuzzy must be boolean' }, { status: 400 });
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
    const scopedDocumentType = document_type == null || document_type === 'all'
      ? null
      : document_type;
    if (scopedDocumentType !== null
      && (typeof scopedDocumentType !== 'string' || !allowedDocumentTypes.has(scopedDocumentType))) {
      return Response.json({ error: 'Invalid document_type' }, { status: 400 });
    }

    const hasPatientScope = patient_id != null && patient_id !== '';
    if (hasPatientScope
      && (typeof patient_id !== 'string' || !patient_id.trim() || patient_id.trim().length > 200)) {
      return Response.json({ error: 'Invalid patient_id' }, { status: 400 });
    }
    const scopedPatientId = hasPatientScope ? patient_id.trim() : null;
    const callerIsSuperAdmin = isProtectedSuperAdmin(user);

    // Build a bounded service-role query. Patient-specific searches first prove
    // direct access to that exact Patient row. Unscoped searches cannot safely
    // infer PDFIndex ownership from the mutable patient_id relationship, so an
    // ordinary caller is restricted to Base44's immutable created_by field. The
    // configured protected platform owner is the only cross-owner search path.
    const filter = {};
    if (scopedDocumentType) {
      filter.document_type = scopedDocumentType;
    }
    if (scopedPatientId) {
      const patientRows = await base44.asServiceRole.entities.Patient
        .filter({ id: scopedPatientId }, '', 1).catch(() => []);
      const scopePatient = (Array.isArray(patientRows) ? patientRows : [])
        .find((patient) => String(patient?.id || '').trim() === scopedPatientId);
      if (!scopePatient) {
        return Response.json({ error: 'Patient not found' }, { status: 404 });
      }
      const isOwner = normalizeProtectedEmail(scopePatient.created_by) === callerEmail;
      const isAssigned = Array.isArray(scopePatient.assigned_nurses)
        && scopePatient.assigned_nurses.some(
          (email) => normalizeProtectedEmail(email) === callerEmail,
        );
      if (!isOwner && !isAssigned && !callerIsSuperAdmin) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
      filter.patient_id = scopedPatientId;
    } else if (!callerIsSuperAdmin) {
      filter.created_by = callerEmail;
    }

    // Count mode is a safe broker for the browser badge. It projects only the
    // ownership/scope fields needed for the in-memory boundary check, never the
    // extracted text or per-page PHI. Scan one extra row to make truncation clear.
    const countLimit = 1000;
    const returnedDocs = count_only
      ? await base44.asServiceRole.entities.PDFIndex.filter(
        filter,
        '-created_date',
        countLimit + 1,
        0,
        ['id', 'created_by', 'patient_id', 'document_type'],
      )
      : await base44.asServiceRole.entities.PDFIndex.filter(
        filter,
        '-created_date',
        limit * 2, // Fetch more to filter
      );
    // Treat the backend filter as an optimization, not an authorization boundary.
    // A regressed/ignored filter must not place another PDF's extracted PHI in the
    // BM25 corpus or response.
    const allDocs = (Array.isArray(returnedDocs) ? returnedDocs : []).filter((doc) => {
      if (!doc || typeof doc !== 'object') return false;
      if (scopedDocumentType && doc.document_type !== scopedDocumentType) return false;
      if (scopedPatientId) {
        return String(doc.patient_id || '').trim() === scopedPatientId;
      }
      if (!callerIsSuperAdmin) {
        return normalizeProtectedEmail(doc.created_by) === callerEmail;
      }
      return true;
    });

    if (count_only) {
      return Response.json({
        success: true,
        accessible_index_count: Math.min(allDocs.length, countLimit),
        count_is_capped: allDocs.length > countLimit,
      });
    }

    // Search and score results with BM25 over the fetched corpus (IDF needs the
    // whole set), plus exact-phrase and keyword boosts.
    const queryLower = searchQuery.toLowerCase();
    const qTerms = [...new Set(tokenize(searchQuery))];
    const model = buildBm25(allDocs.map((d) => ({ text: d.extracted_text || '' })));

    const results = allDocs
      .map((doc, i) => {
        const bm = bm25Score(model, i, qTerms);
        const matched = qTerms.filter((t) => (model.tf[i]?.get(t) || 0) > 0);
        const textLower = (doc.extracted_text || '').toLowerCase();
        const exactPhrase = Boolean(queryLower) && textLower.includes(queryLower);

        const keywordMatches = (Array.isArray(doc.keywords) ? doc.keywords : [])
          .map((keyword) => String(keyword || '').toLowerCase())
          .filter((keyword) => keyword
            && (keyword.includes(queryLower) || queryLower.includes(keyword)));

        // Composite relevance: BM25 + exact-phrase + keyword boosts.
        const totalScore = bm + (exactPhrase ? 100 : 0) + keywordMatches.length * 5;

        const hasAnyMatch = bm > 0 || exactPhrase || keywordMatches.length > 0;
        const hasAllTerms = qTerms.length > 0 && matched.length === qTerms.length;
        if (!hasAnyMatch) return null;
        // Exact (non-fuzzy) mode requires the full phrase or every query term.
        if (!fuzzy && !exactPhrase && !hasAllTerms) return null;

        // Find page matches (substring / all-terms-present per page).
        const pageMatches = doc.page_contents
          ?.map(page => {
            const pl = (page.text || '').toLowerCase();
            const phraseHit = Boolean(queryLower) && pl.includes(queryLower);
            const allTermsHit = qTerms.length > 0 && qTerms.every((t) => pl.includes(t));
            if (phraseHit || allTermsHit) {
              return {
                page_number: page.page_number,
                score: phraseHit ? 100 : 60,
                snippet: extractSnippet(page.text, searchQuery)
              };
            }
            return null;
          })
          .filter(Boolean) || [];

        return {
          ...doc,
          search_score: Math.round(totalScore * 100) / 100,
          matched_terms: [...new Set([...matched, ...keywordMatches])],
          page_matches: pageMatches,
          snippet: extractSnippet(doc.extracted_text, searchQuery)
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.search_score - a.search_score)
      .slice(0, limit);

    // Log search
    await base44.asServiceRole.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'pdf_search',
      details: {
        query: searchQuery,
        results_count: results.length,
        filters: { document_type: scopedDocumentType, patient_id: scopedPatientId }
      },
      page: 'pdf_search'
    });

    return Response.json({
      success: true,
      query: searchQuery,
      results_count: results.length,
      results
    });

  } catch (error) {
    console.error('PDF search error:', error);
    return Response.json({ 
      error: 'Search failed' 
    }, { status: 500 });
  }
});

function extractSnippet(text, query, contextLength = 100) {
  // A keywords-only index match can reach here with no extracted_text; coerce so
  // .toLowerCase() doesn't throw a TypeError and 500 the whole search.
  text = String(text || '');
  const queryLower = String(query || '').toLowerCase();
  const textLower = text.toLowerCase();
  const index = textLower.indexOf(queryLower);
  
  if (index === -1) {
    return text.substring(0, contextLength * 2) + '...';
  }
  
  const start = Math.max(0, index - contextLength);
  const end = Math.min(text.length, index + query.length + contextLength);
  
  let snippet = text.substring(start, end);
  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';
  
  return snippet;
}
