// Ported from base44/functions/searchPDFs.
//
// The split is D67's: **text arithmetic over caller-supplied input belongs
// here; every decision about what may be READ belongs in the contract.** BM25
// over a query somebody typed is arithmetic, and reproducing its `Math.log`,
// its token regex and its tie-breaking in SQL would be a transcription with
// nothing to gain — the same call D59 made for the CSV parser and D67 for the
// text anchors. Which rows enter the corpus, and whether their extracted text
// travels with them, is `contract_pdf_search_corpus`'s and is not restated.
//
// The scoring block below is the original's, function for function, because
// changing any constant in it changes which document a nurse finds first. Its
// parity test LIFTS the block out of `entry.ts` and runs it against this one
// over the same corpus, rather than asserting scores somebody retyped (D57).
import { fail } from './contracts.mjs';

const TOKEN_RE = /[a-z0-9]+/g;

/** The original's tokenizer. */
export function tokenize(text) {
  return String(text || '').toLowerCase().match(TOKEN_RE) || [];
}

/** The original's `buildBm25`, constants included. */
export function buildBm25(docs, k1 = 1.5, b = 0.75) {
  const N = docs.length;
  const docTokens = docs.map(doc => tokenize(doc.text));
  const docLen = docTokens.map(tokens => tokens.length);
  const avgdl = N ? docLen.reduce((total, length) => total + length, 0) / N : 0;
  const df = new Map();
  for (const tokens of docTokens) {
    for (const term of new Set(tokens)) df.set(term, (df.get(term) || 0) + 1);
  }
  const tf = docTokens.map(tokens => {
    const counts = new Map();
    for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
    return counts;
  });
  return { N, docLen, avgdl, df, tf, k1, b };
}

/** The original's `bm25Score`. */
export function bm25Score(model, index, queryTerms) {
  const { tf, docLen, avgdl, k1, b } = model;
  let score = 0;
  for (const term of queryTerms) {
    const f = tf[index]?.get(term) || 0;
    if (f === 0) continue;
    const n = model.df.get(term) || 0;
    const idf = Math.log(1 + (model.N - n + 0.5) / (n + 0.5));
    const denom = f + k1 * (1 - b + b * (docLen[index] / (avgdl || 1)));
    score += idf * (f * (k1 + 1)) / denom;
  }
  return score;
}

/** The original's `extractSnippet`, including the coercion its comment explains. */
export function extractSnippet(text, query, contextLength = 100) {
  // "A keywords-only index match can reach here with no extracted_text; coerce
  // so .toLowerCase() doesn't throw a TypeError and 500 the whole search."
  const source = String(text || '');
  const queryLower = String(query || '').toLowerCase();
  const textLower = source.toLowerCase();
  const index = textLower.indexOf(queryLower);
  if (index === -1) return `${source.substring(0, contextLength * 2)}...`;
  const start = Math.max(0, index - contextLength);
  const end = Math.min(source.length, index + query.length + contextLength);
  let snippet = source.substring(start, end);
  if (start > 0) snippet = `...${snippet}`;
  if (end < source.length) snippet = `${snippet}...`;
  return snippet;
}

/** The original's clamp, whose comment says what an unbounded value costs. */
export const searchLimit = raw =>
  Math.min(Math.max(Math.floor(Number(raw) || 50), 1), 200);

/**
 * Score one corpus against one query.
 *
 * Pure, so the parity test can drive it and the original's own block side by
 * side over the same documents.
 */
export function scoreCorpus(documents, { query, fuzzy, limit }) {
  const queryLower = query.toLowerCase();
  const terms = [...new Set(tokenize(query))];
  const model = buildBm25(documents.map(doc => ({ text: doc.extracted_text || '' })));
  return documents
    .map((doc, index) => {
      const bm = bm25Score(model, index, terms);
      const matched = terms.filter(term => (model.tf[index]?.get(term) || 0) > 0);
      const textLower = (doc.extracted_text || '').toLowerCase();
      const exactPhrase = Boolean(queryLower) && textLower.includes(queryLower);
      const keywordMatches = (Array.isArray(doc.keywords) ? doc.keywords : [])
        .map(keyword => String(keyword || '').toLowerCase())
        .filter(keyword => keyword
          && (keyword.includes(queryLower) || queryLower.includes(keyword)));
      const totalScore = bm + (exactPhrase ? 100 : 0) + keywordMatches.length * 5;
      const hasAnyMatch = bm > 0 || exactPhrase || keywordMatches.length > 0;
      const hasAllTerms = terms.length > 0 && matched.length === terms.length;
      if (!hasAnyMatch) return null;
      // Exact (non-fuzzy) mode requires the full phrase or every query term.
      if (!fuzzy && !exactPhrase && !hasAllTerms) return null;
      const pageMatches = (Array.isArray(doc.page_contents) ? doc.page_contents : [])
        .map(page => {
          const pageLower = (page?.text || '').toLowerCase();
          const phraseHit = Boolean(queryLower) && pageLower.includes(queryLower);
          const allTermsHit = terms.length > 0 && terms.every(term => pageLower.includes(term));
          if (!phraseHit && !allTermsHit) return null;
          return {
            page_number: page.page_number,
            score: phraseHit ? 100 : 60,
            snippet: extractSnippet(page.text, query),
          };
        })
        .filter(Boolean);
      return {
        ...doc,
        search_score: Math.round(totalScore * 100) / 100,
        matched_terms: [...new Set([...matched, ...keywordMatches])],
        page_matches: pageMatches,
        snippet: extractSnippet(doc.extracted_text, query),
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.search_score - left.search_score)
    .slice(0, limit);
}

/**
 * Search the indexed PDFs a caller may read.
 *
 * The authorization is the contract's. The original's unscoped search returns
 * only rows the caller CREATED, and its own comment says why: it "cannot
 * safely infer PDFIndex ownership from the mutable patient_id relationship".
 * D61 gave that table an `agency_id` and D24 gave it the chart rule, so the
 * relationship can be trusted now and the fallback is gone.
 */
export async function searchIndexedPdfs({ params, contract, audit }) {
  const countOnly = params.count_only === undefined ? false : params.count_only;
  const fuzzy = params.fuzzy === undefined ? true : params.fuzzy;
  if (typeof countOnly !== 'boolean') fail(400, 'PDF_SEARCH_COUNT_ONLY_INVALID');
  if (typeof fuzzy !== 'boolean') fail(400, 'PDF_SEARCH_FUZZY_INVALID');
  const query = typeof params.query === 'string' ? params.query.trim() : '';
  if (!countOnly && (query.length < 2 || query.length > 500)) {
    fail(400, 'PDF_SEARCH_QUERY_INVALID');
  }
  const limit = searchLimit(params.limit);
  // `document_type: 'all'` is the original's "no filter", and so is an absent
  // one; neither reaches the contract as a value.
  const documentType = params.document_type == null || params.document_type === 'all'
    ? undefined : params.document_type;
  const patientId = params.patient_id == null || params.patient_id === ''
    ? undefined : params.patient_id;
  if (patientId !== undefined && typeof patientId !== 'string') {
    fail(400, 'PDF_SEARCH_SUBJECT_INVALID');
  }

  const corpus = await contract('readPdfSearchCorpus', {
    ...(documentType === undefined ? {} : { document_type: documentType }),
    ...(patientId === undefined ? {} : { patient_id: patientId.trim() }),
    // `limit * 2` is the original's fetch cap: IDF needs a corpus wider than
    // the page it answers with.
    limit: limit * 2,
    count_only: countOnly,
  });
  if (countOnly) {
    return {
      success: true,
      accessible_index_count: corpus.accessible_index_count,
      count_is_capped: corpus.count_is_capped,
    };
  }

  const results = scoreCorpus(Array.isArray(corpus.documents) ? corpus.documents : [],
    { query, fuzzy, limit });
  // D25's trail, where the original wrote `UserActivity`. Its `user_name` has
  // no source — the carried `user` table has no name column (D38) — and the
  // trail stamps the actor itself, so neither is sent.
  let recorded = true;
  try {
    await audit('pdf_search', {
      detail: {
        results_count: results.length,
        document_type_filter_applied: documentType !== undefined,
        patient_filter_applied: patientId !== undefined,
      },
    });
  } catch { recorded = false; }
  return {
    success: true, query, results_count: results.length, results, audit_recorded: recorded,
  };
}
