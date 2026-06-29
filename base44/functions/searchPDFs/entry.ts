import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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

    const { 
      query,
      document_type,
      patient_id,
      fuzzy = true,
      limit = 50
    } = await req.json();

    if (!query || query.trim().length < 2) {
      return Response.json({ 
        error: 'Query must be at least 2 characters' 
      }, { status: 400 });
    }

    // Build filter
    const filter = {};
    if (document_type && document_type !== 'all') {
      filter.document_type = document_type;
    }
    // Authorize the patient scope. Non-admins may only search PDFs for patients
    // they are assigned to; without this, omitting patient_id returned EVERY
    // indexed PDF's extracted PHI agency-wide. Mirrors getScopedPatientAlerts.
    const isAdmin = user.role === 'admin';
    if (isAdmin) {
      if (patient_id) filter.patient_id = patient_id;
    } else if (patient_id) {
      const [scopePatient] = await base44.asServiceRole.entities.Patient.filter({ id: patient_id });
      // Mirror the Patient RLS: assigned nurse OR creator OR admin.
      const allowed = scopePatient?.created_by === user.email
        || (Array.isArray(scopePatient?.assigned_nurses) && scopePatient.assigned_nurses.includes(user.email));
      if (!allowed) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
      filter.patient_id = patient_id;
    } else {
      // All accessible patients: those assigned to the caller OR created by them
      // (the Patient RLS grants both), de-duplicated by id.
      const [assignedPatients, createdPatients] = await Promise.all([
        base44.asServiceRole.entities.Patient.filter({ assigned_nurses: user.email }, '-created_date', 1000).catch(() => []),
        base44.asServiceRole.entities.Patient.filter({ created_by: user.email }, '-created_date', 1000).catch(() => []),
      ]);
      const allowedIds = [...new Set(
        [...(assignedPatients || []), ...(createdPatients || [])].map((p) => p.id).filter(Boolean)
      )];
      if (allowedIds.length === 0) return Response.json({ results: [], total: 0 });
      filter.patient_id = { $in: allowedIds };
    }

    // Fetch all indexed documents
    const allDocs = await base44.asServiceRole.entities.PDFIndex.filter(
      filter,
      '-created_date',
      limit * 2 // Fetch more to filter
    );

    // Search and score results with BM25 over the fetched corpus (IDF needs the
    // whole set), plus exact-phrase and keyword boosts.
    const queryLower = query.toLowerCase();
    const qTerms = [...new Set(tokenize(query))];
    const model = buildBm25(allDocs.map((d) => ({ text: d.extracted_text || '' })));

    const results = allDocs
      .map((doc, i) => {
        const bm = bm25Score(model, i, qTerms);
        const matched = qTerms.filter((t) => (model.tf[i]?.get(t) || 0) > 0);
        const textLower = (doc.extracted_text || '').toLowerCase();
        const exactPhrase = Boolean(queryLower) && textLower.includes(queryLower);

        const keywordMatches = doc.keywords?.filter((k) =>
          k.includes(queryLower) || queryLower.includes(k)
        ) || [];

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
                snippet: extractSnippet(page.text, query)
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
          snippet: extractSnippet(doc.extracted_text, query)
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
        query,
        results_count: results.length,
        filters: { document_type, patient_id }
      },
      page: 'pdf_search'
    });

    return Response.json({
      success: true,
      query,
      results_count: results.length,
      results
    });

  } catch (error) {
    console.error('PDF search error:', error);
    return Response.json({ 
      error: error.message || 'Search failed' 
    }, { status: 500 });
  }
});

function extractSnippet(text, query, contextLength = 100) {
  const queryLower = query.toLowerCase();
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