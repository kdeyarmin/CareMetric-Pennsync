import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSnippet, searchIndexedPdfs, searchLimit, scoreCorpus } from './pdf-search.mjs';

/**
 * The search handler's own behaviour.
 *
 * `pennsyncApiOriginalParity` proves the scorer agrees with the original's own
 * block, run side by side over the same corpus. What is proved here is the
 * input arithmetic the contract deliberately does not do, the two modes, and
 * the trail entry — which carries three counts and no document.
 */
const CORPUS = [
  { id: 'pdf-1', document_name: 'a.pdf', document_type: 'consent', patient_id: 'p1',
    extracted_text: 'wound care consent signed by the patient today',
    keywords: ['wound'], page_contents: [{ page_number: 1, text: 'wound care consent' }] },
  { id: 'pdf-2', document_name: 'b.pdf', document_type: 'visit', patient_id: 'p1',
    extracted_text: 'nursing visit note ambulation improved',
    keywords: [], page_contents: [{ page_number: 3, text: 'ambulation improved' }] },
  { id: 'pdf-3', document_name: 'c.pdf', document_type: 'template', patient_id: null,
    extracted_text: '', keywords: ['wound', 'consent'], page_contents: null },
];
const harness = (overrides = {}) => {
  const asked = [];
  const audits = [];
  return {
    asked,
    audits,
    params: { query: 'wound', ...overrides.params },
    contract: async (name, args) => {
      asked.push({ name, args });
      if (overrides.contractThrows) throw overrides.contractThrows;
      return overrides.corpus ?? { count_only: false, documents: CORPUS };
    },
    audit: async (action, options) => {
      audits.push({ action, options });
      if (overrides.auditThrows) throw new Error('trail unavailable');
      return { audit_event_id: 'evt-1' };
    },
  };
};

test('the caller-supplied limit is clamped before it becomes a fetch cap', async () => {
  // The original's own comment: an unbounded value pulls the entire index,
  // with its extracted PHI, into memory per request.
  assert.equal(searchLimit(500000), 200);
  assert.equal(searchLimit(-4), 1);
  assert.equal(searchLimit(0), 50, 'falsy falls back to the default, as the original does');
  assert.equal(searchLimit(undefined), 50);
  assert.equal(searchLimit('25'), 25);
  assert.equal(searchLimit(25.9), 25);
  assert.equal(searchLimit('nonsense'), 50);
  const h = harness({ params: { limit: 500000 } });
  await searchIndexedPdfs(h);
  // `limit * 2`, because IDF needs a corpus wider than the page it answers
  // with — and the contract re-applies its own ceiling regardless.
  assert.equal(h.asked[0].args.limit, 400);
});

test('the two modes ask for different things and answer differently', async () => {
  const search = harness();
  const result = await searchIndexedPdfs(search);
  assert.equal(search.asked[0].name, 'readPdfSearchCorpus');
  assert.deepEqual(search.asked[0].args, { limit: 100, count_only: false });
  assert.equal(result.success, true);
  assert.equal(result.query, 'wound');
  assert.equal(result.results_count, result.results.length);
  assert.ok(result.results.length > 0);

  const counted = harness({ params: { count_only: true, query: undefined },
    corpus: { count_only: true, accessible_index_count: 42, count_is_capped: false } });
  const count = await searchIndexedPdfs(counted);
  assert.deepEqual(counted.asked[0].args, { limit: 100, count_only: true });
  assert.deepEqual(count, { success: true, accessible_index_count: 42, count_is_capped: false });
  // A count answers without a query and records nothing: it is a badge, not a
  // search somebody performed.
  assert.equal(counted.audits.length, 0);
});

test('a query is required for a search and not for a count', async () => {
  for (const query of [undefined, null, '', ' ', 'a', ' a ', 'x'.repeat(501), 42]) {
    const h = harness({ params: { query } });
    await assert.rejects(() => searchIndexedPdfs(h),
      error => error?.code === 'PDF_SEARCH_QUERY_INVALID', JSON.stringify(query));
    assert.equal(h.asked.length, 0, 'nothing was read');
  }
  assert.equal((await searchIndexedPdfs(harness({ params: { query: 'ab' } }))).query, 'ab');
  // The two flags are booleans, as the original requires.
  for (const params of [{ count_only: 'yes' }, { count_only: 1 }, { count_only: null }]) {
    await assert.rejects(() => searchIndexedPdfs(harness({ params })),
      error => error?.code === 'PDF_SEARCH_COUNT_ONLY_INVALID');
  }
  for (const params of [{ fuzzy: 'yes' }, { fuzzy: 0 }, { fuzzy: null }]) {
    await assert.rejects(() => searchIndexedPdfs(harness({ params })),
      error => error?.code === 'PDF_SEARCH_FUZZY_INVALID');
  }
});

test('an absent filter is absent rather than a value, and `all` is the original\'s absent', async () => {
  const none = harness();
  await searchIndexedPdfs(none);
  assert.equal(Object.hasOwn(none.asked[0].args, 'document_type'), false);
  assert.equal(Object.hasOwn(none.asked[0].args, 'patient_id'), false);
  for (const document_type of ['all', null, undefined]) {
    const h = harness({ params: { document_type } });
    await searchIndexedPdfs(h);
    assert.equal(Object.hasOwn(h.asked[0].args, 'document_type'), false, String(document_type));
  }
  const filtered = harness({ params: { document_type: 'consent', patient_id: '  p1  ' } });
  await searchIndexedPdfs(filtered);
  assert.equal(filtered.asked[0].args.document_type, 'consent');
  assert.equal(filtered.asked[0].args.patient_id, 'p1');
  // An empty patient id is the original's "no scope", not an invalid one.
  const empty = harness({ params: { patient_id: '' } });
  await searchIndexedPdfs(empty);
  assert.equal(Object.hasOwn(empty.asked[0].args, 'patient_id'), false);
  await assert.rejects(() => searchIndexedPdfs(harness({ params: { patient_id: 42 } })),
    error => error?.code === 'PDF_SEARCH_SUBJECT_INVALID');
});

test('the trail entry carries three counts and no document', async () => {
  const h = harness({ params: { document_type: 'consent', patient_id: 'p1' } });
  const result = await searchIndexedPdfs(h);
  assert.equal(h.audits.length, 1);
  assert.equal(h.audits[0].action, 'pdf_search');
  assert.deepEqual(h.audits[0].options, { detail: {
    results_count: result.results_count,
    document_type_filter_applied: true,
    patient_filter_applied: true } });
  const recorded = JSON.stringify(h.audits[0]);
  for (const leak of ['wound', 'pdf-1', 'a.pdf', 'signed by the patient']) {
    assert.equal(recorded.includes(leak), false, `the trail must not carry ${leak}`);
  }
  // The query itself is not recorded either: a search term over a clinical
  // index is as disclosing as the result.
  assert.equal(recorded.includes('query'), false);
  // And a failed append does not lose the results.
  const broken = harness({ auditThrows: true });
  const answer = await searchIndexedPdfs(broken);
  assert.equal(answer.success, true);
  assert.equal(answer.audit_recorded, false);
  assert.ok(answer.results.length > 0);
});

test('fuzzy and exact differ, and a keywords-only row still scores', async () => {
  const fuzzy = scoreCorpus(CORPUS, { query: 'wound consent', fuzzy: true, limit: 50 });
  const exact = scoreCorpus(CORPUS, { query: 'wound consent', fuzzy: false, limit: 50 });
  assert.ok(fuzzy.length >= exact.length);
  // `pdf-3` has NO extracted text and matches on keywords alone — the case the
  // original's snippet coercion exists for.
  const keywordsOnly = fuzzy.find(row => row.id === 'pdf-3');
  assert.ok(keywordsOnly, 'a keywords-only row scores');
  assert.equal(typeof keywordsOnly.snippet, 'string');
  assert.deepEqual(keywordsOnly.page_matches, []);
  // Exact mode requires the phrase or every term.
  assert.equal(exact.every(row => row.search_score > 0), true);
  // A page match carries the page number the original reports, not its index.
  const page = fuzzy.find(row => row.id === 'pdf-2')
    ?? scoreCorpus(CORPUS, { query: 'ambulation', fuzzy: true, limit: 50 })[0];
  assert.equal(page.page_matches[0].page_number, 3);
  // Newest-scoring first.
  const scores = fuzzy.map(row => row.search_score);
  assert.deepEqual(scores, [...scores].sort((left, right) => right - left));
  // And the limit is the answer's, not the corpus's.
  assert.equal(scoreCorpus(CORPUS, { query: 'wound', fuzzy: true, limit: 1 }).length, 1);
});

test('a snippet is the original\'s window, including its two ellipses', () => {
  const text = `${'a'.repeat(300)}NEEDLE${'b'.repeat(300)}`;
  const snippet = extractSnippet(text, 'NEEDLE');
  assert.ok(snippet.startsWith('...') && snippet.endsWith('...'));
  assert.ok(snippet.includes('NEEDLE'));
  assert.equal(snippet.length, 3 + 100 + 6 + 100 + 3);
  // No match is the head of the text with one trailing ellipsis.
  const head = extractSnippet(text, 'MISSING');
  assert.equal(head, `${text.substring(0, 200)}...`);
  // Null TEXT does not throw, which is the coercion the original explains: "a
  // keywords-only index match can reach here with no extracted_text".
  assert.equal(extractSnippet(null, 'x'), '...');
  assert.equal(extractSnippet(undefined, 'x'), '...');
  // An undefined QUERY throws in both, because the original coerces the query
  // for `toLowerCase` and then reads `query.length` raw. Kept rather than
  // fixed: it is unreachable — the handler refuses a query shorter than two
  // characters before anything is scored — and a divergence here would be a
  // different window for a real value.
  assert.throws(() => extractSnippet('text', undefined), TypeError);
});
