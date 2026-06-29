import { describe, it, expect } from 'vitest';
import { tokenize, rankBm25, buildBm25, bm25Score, idf } from './bm25.js';

describe('bm25', () => {
  const corpus = [
    { id: 'a', text: 'wound dehiscence noted at the surgical site, wound care provided' },
    { id: 'b', text: 'patient ambulating independently, no wound concerns' },
    { id: 'c', text: 'routine visit, blood pressure stable, medication reconciliation done' },
    { id: 'd', text: 'wound '.repeat(200) + 'filler text to make this document very long' },
  ];

  it('tokenizes to lowercase alphanumerics', () => {
    expect(tokenize('Wound-Care, 2x!')).toEqual(['wound', 'care', '2x']);
  });

  it('ranks the most relevant document first for a rare term', () => {
    const ranked = rankBm25(corpus, 'dehiscence');
    expect(ranked[0].id).toBe('a'); // only doc with the rare term
    expect(ranked[0].score).toBeGreaterThan(0);
  });

  it('rewards term frequency but penalizes excessive document length', () => {
    // doc d repeats "wound" 200x but is mostly filler; doc a is concise and on-topic.
    const ranked = rankBm25(corpus, 'wound care');
    expect(ranked[0].id).toBe('a');
  });

  it('returns zero score and no matches when no query term is present', () => {
    const model = buildBm25(corpus);
    const idxC = 2;
    expect(bm25Score(model, idxC, ['dehiscence'])).toBe(0);
    const ranked = rankBm25(corpus, 'nonexistentterm');
    expect(ranked.every((r) => r.score === 0)).toBe(true);
  });

  it('rarer terms have higher IDF than common ones', () => {
    // "dehiscence" appears in 1 of 4 docs; "wound" in 3 of 4 — rarer = higher IDF.
    const model = buildBm25(corpus);
    expect(idf(model, 'dehiscence')).toBeGreaterThan(idf(model, 'wound'));
  });

  it('handles empty corpus / empty query without throwing', () => {
    expect(rankBm25([], 'x')).toEqual([]);
    expect(rankBm25(corpus, '')).toHaveLength(corpus.length);
  });
});
