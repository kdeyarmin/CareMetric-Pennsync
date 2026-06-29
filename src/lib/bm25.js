/**
 * bm25 — Okapi BM25 relevance ranking over a small in-memory corpus.
 *
 * Reference implementation (tested here). The searchPDFs Deno function inlines the
 * same algorithm (it can't import from src/). BM25 ranks documents by term
 * frequency normalized for document length AND term rarity (IDF), so a rare
 * clinical term that appears several times in a short note outranks a common word
 * that appears once in a long one — a real improvement over the previous
 * exact-substring-or-fraction-of-words-matched scoring.
 */

const TOKEN_RE = /[a-z0-9]+/g;

export function tokenize(text) {
  return String(text || '').toLowerCase().match(TOKEN_RE) || [];
}

/** Build a BM25 model from a corpus of { id, text } documents. */
export function buildBm25(docs, { k1 = 1.5, b = 0.75 } = {}) {
  const corpus = Array.isArray(docs) ? docs : [];
  const N = corpus.length;
  const docTokens = corpus.map((d) => tokenize(d.text));
  const docLen = docTokens.map((t) => t.length);
  const avgdl = N ? docLen.reduce((a, c) => a + c, 0) / N : 0;

  const df = new Map(); // term -> # docs containing it
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

/** BM25 IDF (the +1 form, always non-negative). */
export function idf(model, term) {
  const n = model.df.get(term) || 0;
  return Math.log(1 + (model.N - n + 0.5) / (n + 0.5));
}

/** BM25 score of a single document (by index) against the query terms. */
export function bm25Score(model, docIndex, queryTerms) {
  const { tf, docLen, avgdl, k1, b } = model;
  let score = 0;
  for (const term of queryTerms) {
    const f = tf[docIndex]?.get(term) || 0;
    if (f === 0) continue;
    const numerator = f * (k1 + 1);
    const denominator = f + k1 * (1 - b + b * (docLen[docIndex] / (avgdl || 1)));
    score += idf(model, term) * (numerator / denominator);
  }
  return score;
}

/**
 * Rank a corpus of { id, text } by a query string.
 * Returns [{ index, id, score, matchedTerms }] sorted by descending score.
 */
export function rankBm25(docs, query, opts) {
  const corpus = Array.isArray(docs) ? docs : [];
  const model = buildBm25(corpus, opts);
  const qTerms = [...new Set(tokenize(query))];
  return corpus
    .map((d, i) => ({
      index: i,
      id: d.id,
      score: bm25Score(model, i, qTerms),
      matchedTerms: qTerms.filter((t) => (model.tf[i]?.get(t) || 0) > 0),
    }))
    .sort((a, b) => b.score - a.score);
}
