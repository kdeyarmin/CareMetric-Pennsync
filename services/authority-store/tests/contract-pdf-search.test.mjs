import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { RECORD_MIGRATION_FILE, SCHEMA } from '../../../tools-entity-schema-plan.mjs';
import { BROKER_MIGRATION_FILE } from '../../../tools-record-brokers.mjs';

/**
 * The PDF search's corpus.
 *
 * Two things are its own and are proved here. The SCOPE: the original's
 * unscoped search returns only rows the caller CREATED, and its own comment
 * says that exists because `patient_id` could not be trusted — D61 gave the
 * table an `agency_id` and D24 gave it the chart rule, so it can be. And the
 * COUNT MODE, which projects no extracted text at all, because the corpus is
 * the extracted PHI of every indexed document.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const MIGRATIONS = 'services/authority-store/supabase/record-migrations/';
const SEARCH = `${MIGRATIONS}20260920490000_contract_pdf_search.sql`;
const ORIGINAL = 'base44/functions/searchPDFs/entry.ts';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN_A = 1; const CLINICIAN_A = 2; const OFFICE_A = 3; const ADMIN_B = 4;
const CORPUS = 'select "public"."pennsync_contract_pdf_search_corpus"($1,$2,$3,$4,$5) as result';
const A = 'agency-a'; const B = 'agency-b';
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE, SEARCH]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  await db.exec(`update pennsync_private.membership set tenant_role = 'office_staff'
    where id = 'membership-3'`);
  for (const [id, agency] of [['patient-a1', A], ['patient-a2', A], ['patient-b1', B]]) {
    await db.query(`insert into ${SCHEMA}."patient"("source_app_id","id","agency_id",
      "first_name","last_name","status") values ($1,$2,$3,'P','Q','active')`, [APP, id, agency]);
  }
  // Every row is CREATED BY somebody with no membership here, which is the
  // original's only scope for an unscoped search. Nothing below would be
  // visible to anyone if `created_by` still decided.
  for (const [id, agency, patient, type, text] of [
    ['pdf-a1', A, 'patient-a1', 'consent', 'wound care consent signed by patient'],
    ['pdf-a2', A, 'patient-a1', 'visit', 'nursing visit note wound dressing changed'],
    ['pdf-a3', A, 'patient-a2', 'assessment', 'initial assessment of ambulation'],
    ['pdf-a4', A, null, 'template', 'agency wide consent template'],
    ['pdf-b1', B, 'patient-b1', 'consent', 'other tenant consent'],
  ]) {
    await db.query(`insert into ${SCHEMA}."pdf_index"("source_app_id","id","agency_id",
      "patient_id","document_type","extracted_text","document_name","created_by",
      "pdf_url","keywords","page_contents","created_date")
      values ($1,$2,$3,$4,$5,$6,$7,'nobody@example.invalid',
        'https://base44.example/storage/x.pdf',$8,$9,clock_timestamp())`,
    [APP, id, agency, patient, type, text, `${id}.pdf`,
      JSON.stringify(['wound']), JSON.stringify([{ page_number: 1, text }])]);
  }
});
after(async () => db?.close());

async function as(n, sql, params = []) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(n), session_id: sid(n), role: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role authenticated');
    const { rows } = await db.query(sql, params);
    await db.exec('commit');
    return rows[0].result;
  } catch (error) { await db.exec('rollback'); throw error; }
}
const corpus = (n, options = {}) => as(n, CORPUS, [options.agency ?? A,
  options.document_type ?? null, options.patient_id ?? null,
  options.limit ?? 100, options.count_only ?? false]);
const ids = answer => answer.documents.map(doc => doc.id).sort();
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
});

test('an unscoped search is the agency and the charts the caller opens', async () => {
  // The original would return NOTHING here for any of them: every row's
  // `created_by` is somebody with no membership.
  const source = readFileSync(resolve(repository, ORIGINAL), 'utf8');
  assert.match(source, /filter\.created_by = callerEmail;/);
  // The comment wraps in the original, so the phrase is matched across the
  // line break rather than on one line.
  assert.match(source.replace(/\n\s*\/\/ /g, ' '),
    /cannot safely infer PDFIndex ownership from the mutable patient_id relationship/);
  // An agency_admin opens every chart, so every row in the agency.
  assert.deepEqual(ids(await corpus(ADMIN_A)), ['pdf-a1', 'pdf-a2', 'pdf-a3', 'pdf-a4']);
  // A clinician opens patient-a1 and no other chart; a row naming no patient
  // is agency-scoped and reaches them too.
  assert.deepEqual(ids(await corpus(CLINICIAN_A)), ['pdf-a1', 'pdf-a2', 'pdf-a4']);
  // `office_staff` opens no chart, so only the row that names none.
  assert.deepEqual(ids(await corpus(OFFICE_A)), ['pdf-a4']);
  // And no tenant reaches another's index.
  assert.deepEqual(ids(await corpus(ADMIN_B, { agency: B })), ['pdf-b1']);
  await refusal(corpus(ADMIN_B, { agency: A }), 'PENNSYNC_PDF_SEARCH_AGENCY_NOT_HELD');
});

test('a named chart is proved before the corpus is read', async () => {
  assert.deepEqual(ids(await corpus(CLINICIAN_A, { patient_id: 'patient-a1' })),
    ['pdf-a1', 'pdf-a2']);
  // "Not yours" and "no documents" are different answers, and the original
  // makes the same distinction.
  await refusal(corpus(CLINICIAN_A, { patient_id: 'patient-a2' }),
    'PENNSYNC_PDF_SEARCH_PATIENT_NOT_VISIBLE');
  await refusal(corpus(OFFICE_A, { patient_id: 'patient-a1' }),
    'PENNSYNC_PDF_SEARCH_PATIENT_NOT_VISIBLE');
  await refusal(corpus(ADMIN_A, { patient_id: 'patient-b1' }),
    'PENNSYNC_PDF_SEARCH_PATIENT_NOT_VISIBLE');
  await refusal(corpus(ADMIN_A, { patient_id: 'patient-nowhere' }),
    'PENNSYNC_PDF_SEARCH_PATIENT_NOT_VISIBLE');
  // An admin's own chart with no documents is an empty corpus rather than a
  // refusal, which is the distinction working.
  await db.query(`insert into ${SCHEMA}."patient"("source_app_id","id","agency_id",
    "first_name","last_name","status") values ($1,'patient-a9',$2,'R','S','active')`, [APP, A]);
  assert.deepEqual((await corpus(ADMIN_A, { patient_id: 'patient-a9' })).documents, []);
  for (const patient_id of ['', 'x'.repeat(201)]) {
    await refusal(corpus(ADMIN_A, { patient_id }), 'PENNSYNC_PDF_SEARCH_SUBJECT_INVALID');
  }
});

test('the count mode carries no extracted text, which is what it is for', async () => {
  const counted = await corpus(ADMIN_A, { count_only: true });
  assert.deepEqual(Object.keys(counted).sort(),
    ['accessible_index_count', 'count_is_capped', 'count_only']);
  assert.equal(counted.accessible_index_count, 4);
  assert.equal(counted.count_is_capped, false);
  // Not a projection that omits the text — no row travels at all.
  const serialized = JSON.stringify(counted);
  for (const leak of ['wound', 'consent', 'nursing visit', 'pdf-a1', 'base44.example']) {
    assert.equal(serialized.includes(leak), false, `the count must not carry ${leak}`);
  }
  // It is scoped exactly as the search is.
  assert.equal((await corpus(OFFICE_A, { count_only: true })).accessible_index_count, 1);
  assert.equal((await corpus(CLINICIAN_A, { count_only: true })).accessible_index_count, 3);
  assert.equal((await corpus(ADMIN_A, { count_only: true, document_type: 'consent' }))
    .accessible_index_count, 1);
});

test('the corpus projects what the scorer reads and not the storage locator', async () => {
  const answer = await corpus(ADMIN_A);
  for (const doc of answer.documents) {
    assert.deepEqual(Object.keys(doc).sort(), ['created_date', 'document_name',
      'document_type', 'extracted_text', 'id', 'keywords', 'metadata',
      'page_contents', 'patient_id']);
    // `pdf_url` is a locator into Base44's storage, which is why `PDFIndex` is
    // outside the generic family (D16). The original spreads the whole row.
    assert.equal(Object.hasOwn(doc, 'pdf_url'), false);
    assert.equal(Object.hasOwn(doc, 'created_by'), false);
    assert.equal(Object.hasOwn(doc, 'agency_id'), false);
    // `metadata` is projected NARROWED to the one key the search page reads.
    // This assertion previously required it to be ABSENT — encoding the defect
    // as intended behaviour, which is why the suite stayed green while every
    // document rendered `0 pages`.
    assert.deepEqual(Object.keys(doc.metadata), ['page_count']);
  }
  assert.match(readFileSync(resolve(repository, ORIGINAL), 'utf8'), /\.\.\.doc,/);
});

test('the type filter is the original\'s list, and the fetch cap cannot be raised', async () => {
  assert.deepEqual(ids(await corpus(ADMIN_A, { document_type: 'consent' })), ['pdf-a1']);
  assert.deepEqual(ids(await corpus(ADMIN_A, { document_type: 'signature' })), []);
  await refusal(corpus(ADMIN_A, { document_type: 'invented' }),
    'PENNSYNC_PDF_SEARCH_DOCUMENT_TYPE_INVALID');
  // Read from the original rather than retyped.
  const source = readFileSync(resolve(repository, ORIGINAL), 'utf8');
  const start = source.indexOf('const allowedDocumentTypes = new Set([');
  const declared = [...source.slice(start, source.indexOf('])', start))
    .matchAll(/'([a-z_]+)'/g)].map(match => match[1]).sort();
  const sql = readFileSync(resolve(repository, SEARCH), 'utf8');
  const emitted = [...sql.slice(sql.indexOf('pdf_search_document_type(p_type text)'),
    sql.indexOf('$types$;')).matchAll(/'([a-z_]+)'/g)].map(match => match[1]).sort();
  assert.deepEqual(emitted, declared);
  // A caller asking for the whole index gets the ceiling, not the index.
  assert.equal((await corpus(ADMIN_A, { limit: 500000 })).documents.length, 4);
  assert.equal((await corpus(ADMIN_A, { limit: 1 })).documents.length, 1);
  assert.equal((await corpus(ADMIN_A, { limit: 0 })).documents.length, 1);
  assert.equal((await corpus(ADMIN_A, { limit: null })).documents.length, 4);
});

test('a result carries the page count the search page renders, and nothing else of metadata', async () => {
  /*
   * D72's rule, arriving as a defect Codex found: `PDFSearchInterface.jsx`
   * reads `result.metadata?.page_count || 0` to render "N pages", and the
   * projection omitted `metadata` entirely — so every indexed document showed
   * `0 pages` under this backend while this suite passed.
   *
   * Narrowed to that one key on purpose. `metadata` is an unconstrained jsonb
   * column, and D64's naming discipline applies to a response as much as to a
   * prompt.
   */
  const id = 'pdf-meta-1';
  await db.query(`insert into ${SCHEMA}."pdf_index"("source_app_id","id","agency_id",
    "patient_id","document_type","extracted_text","document_name","created_by",
    "pdf_url","keywords","page_contents","created_date","metadata")
    values ($1,$2,$3,$4,'assessment','wound care notes','Wound.pdf','nobody@example.invalid',
      'https://base44.example/storage/m.pdf','{}','{}',clock_timestamp(),$5)`,
  [APP, id, A, 'patient-a1', JSON.stringify({ page_count: 7, extracted_by: 'ocr-v2', pdf_url: 'leak' })]);

  const answer = await as(ADMIN_A, CORPUS, [A, null, 'patient-a1', 50, false]);
  const row = answer.documents.find(entry => entry.id === id);
  assert.ok(row, 'the seeded row is in the corpus');
  assert.equal(row.metadata.page_count, 7);
  // Only that key. The column also held `extracted_by` and a `pdf_url`, and a
  // swept-in blob would have carried both — the second being the exact column
  // this contract refuses to project.
  assert.deepEqual(Object.keys(row.metadata), ['page_count']);
  assert.equal(Object.hasOwn(row, 'pdf_url'), false);
});

test('a row with no metadata still answers an object the page can read', async () => {
  // `result.metadata?.page_count || 0` needs `metadata` to be an object or
  // absent, never a null that an optional chain then reads through.
  const id = 'pdf-meta-none';
  await db.query(`insert into ${SCHEMA}."pdf_index"("source_app_id","id","agency_id",
    "patient_id","document_type","extracted_text","document_name","created_by",
    "pdf_url","keywords","page_contents","created_date")
    values ($1,$2,$3,$4,'assessment','dressing change','Dressing.pdf','nobody@example.invalid',
      'https://base44.example/storage/n.pdf','{}','{}',clock_timestamp())`,
  [APP, id, A, 'patient-a1']);
  const answer = await as(ADMIN_A, CORPUS, [A, null, 'patient-a1', 50, false]);
  const row = answer.documents.find(entry => entry.id === id);
  assert.ok(row);
  assert.deepEqual(row.metadata, { page_count: null });
});
