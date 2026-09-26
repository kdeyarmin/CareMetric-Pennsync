import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { SCHEMA } from '../../../tools-entity-schema-plan.mjs';
import { applyRecordMigrations } from './record-migrations.mjs';

/**
 * The five compliance read contracts.
 *
 * What earns the file is the divergence the migration's header calls D45's:
 * four of these five tables are policy-tenanted AGENCY-WIDE, so the policies
 * alone would let any colleague read anybody's licence numbers, anybody's
 * signatures and anybody's incident reports. Every ownership test below seeds
 * two rows in ONE agency, so the policies admit both to both callers and only
 * the contract's own predicate separates them — assert against a row the
 * policies already hide and the test passes for a reason that has nothing to
 * do with the thing being tested.
 *
 * The second group is the pair of readings recorded rather than fixed: a
 * chartless incident and a visitless audit are readable by nobody, and cannot
 * be written here either. Those two tests drive the INSERT rather than
 * asserting the migration's comment.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const RECORDS = 'services/authority-store/supabase/record-migrations/';
const READS_NAME = '20260920650000_contract_compliance_reads.sql';
// `chart_not_elsewhere`'s own file, read only for its text: the sabotage below
// restores the term from the migration that ships it rather than from a retyped
// copy. It is APPLIED by the directory walk, not by name.
const CHART_AGENCY = RECORDS + '20260920590000_chart_agency.sql';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const email = n => ['', 'admin-a', 'clinician-a', 'clinician-empty', 'admin-b', 'admin-both'][n]
  + '@example.invalid';
const ADMIN_A = 1; const CLINICIAN_A = 2; const CLINICIAN_EMPTY = 3; const ADMIN_B = 4;
// The shared fixtures give every identity exactly ONE membership, which is the
// one state in which a contract's own agency binding cannot be observed: the
// policies refuse the other agency's rows by themselves, so an assertion built
// on those callers alone passes with the binding deleted. Proved by deleting
// it — all fourteen tests stayed green. This fifth caller holds BOTH agencies
// as an `agency_admin`, so `caller_agencies()` admits agency B's rows to a
// request naming agency A and only the contract can keep them out.
const ADMIN_BOTH = 5;
const A = 'agency-a'; const B = 'agency-b';

const INCIDENTS = 'select "public"."pennsync_contract_incident_list"($1,$2,$3,$4,$5) as result';
const AUDITS = 'select "public"."pennsync_contract_compliance_audit_list"($1,$2,$3,$4,$5) as result';
const ADR = 'select "public"."pennsync_contract_adr_case_list"($1,$2,$3) as result';
const CREDENTIALS = 'select "public"."pennsync_contract_personnel_credential_list"'
  + '($1,$2,$3,$4,$5) as result';
const ACKS = 'select "public"."pennsync_contract_policy_acknowledgment_list"($1,$2,$3,$4) as result';
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  // The WHOLE record directory in apply order, through #316's helper, rather
  // than a hand-kept list of the files this contract happens to need.
  //
  // A list was written first and it named four: the record store, the broker
  // family, `20260920590000_chart_agency.sql` for the `chart_not_elsewhere`
  // term the ADR read below calls, and — because that file refuses to apply
  // without `contract_task_list`, which refuses without
  // `resolve_file_locator` — two more found by applying each alone and reading
  // the refusal it raised. Its comment argued that naming files was safer than
  // a glob, because a glob pulls in whatever a sibling branch lands next.
  //
  // That reasoning was backwards and #316 says why: the directory IS what a
  // deployment applies, so a sibling's forward migration reaching this suite is
  // the point rather than the hazard, and D88 makes a forward file the only
  // legal way to change a store that has already applied the original. The
  // helper fails closed on an empty listing, so this cannot quietly build a
  // store with no contracts in it and then pass every refusal.
  const applied = await applyRecordMigrations(db);
  assert.ok(applied.includes(READS_NAME), `${READS_NAME} was not applied`);
  assert.equal(applied.at(-1), READS_NAME,
    'this contract must sort last in the directory, or `planMigration` refuses '
    + 'MIGRATE_OUT_OF_ORDER once an earlier file has been applied to a store');
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));

  await db.exec(`insert into auth.users(id,email,email_confirmed_at)
      values ('${uid(ADMIN_BOTH)}','${email(ADMIN_BOTH)}',clock_timestamp());
    insert into auth.sessions(id,user_id,not_after)
      values ('${sid(ADMIN_BOTH)}','${uid(ADMIN_BOTH)}',clock_timestamp()+interval '1 hour');
    insert into pennsync_private.identity_map(app_id,auth_user_id,base44_user_id,
        expected_email,source_evidence_sha256,verified_at)
      values ('${APP}','${uid(ADMIN_BOTH)}','6aac00000000${uid(ADMIN_BOTH).slice(-12)}',
        '${email(ADMIN_BOTH)}',repeat('a',64),clock_timestamp());
    insert into pennsync_private.membership(app_id,id,agency_id,auth_user_id,
        base44_user_id,tenant_role,status)
      values ('${APP}','membership-5a','agency-a','${uid(ADMIN_BOTH)}',
          '6aac00000000${uid(ADMIN_BOTH).slice(-12)}','agency_admin','active'),
        ('${APP}','membership-5b','agency-b','${uid(ADMIN_BOTH)}',
          '6aac00000000${uid(ADMIN_BOTH).slice(-12)}','agency_admin','active')`);

  for (const [id, agency, first, last] of [
    ['patient-a1', A, 'Ada', 'Lovelace'],
    ['patient-a2', A, 'Grace', 'Hopper'],
    ['patient-b1', B, 'Katherine', 'Johnson'],
  ]) {
    await db.query(`insert into ${SCHEMA}."patient"
      ("source_app_id","id","agency_id","first_name","last_name") values ($1,$2,$3,$4,$5)`,
    [APP, id, agency, first, last]);
  }
  for (const [id, agency, patient] of [
    ['visit-a1', A, 'patient-a1'], ['visit-a2', A, 'patient-a2'], ['visit-b1', B, 'patient-b1'],
  ]) {
    await db.query(`insert into ${SCHEMA}."visit"
      ("source_app_id","id","agency_id","patient_id") values ($1,$2,$3,$4)`,
    [APP, id, agency, patient]);
  }

  // Incidents. `patient-a1` is the chart the clinician is assigned to;
  // `patient-a2` is one only an admin opens (D24).
  for (const [id, patient, creator, created, incidentDate, sample] of [
    ['inc-mine', 'patient-a1', email(CLINICIAN_A), '2026-09-01', '2026-09-20', false],
    ['inc-theirs', 'patient-a1', email(ADMIN_A), '2026-09-02', '2026-09-10', false],
    ['inc-sample', 'patient-a1', email(ADMIN_A), '2026-09-03', '2026-09-05', true],
    ['inc-other-chart', 'patient-a2', email(CLINICIAN_A), '2026-09-04', '2026-09-25', false],
    ['inc-elsewhere', 'patient-b1', email(CLINICIAN_A), '2026-09-05', '2026-09-26', false],
  ]) {
    await db.query(`insert into ${SCHEMA}."incident"
      ("source_app_id","id","patient_id","created_by","created_date","incident_date",
       "is_sample","client_request_id","photo_urls","state_reportable_pdf_url")
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [APP, id, patient, creator, `${created} 00:00:00+00`, incidentDate, sample, `req-${id}`,
      JSON.stringify(['https://base44.app/storage/photo.jpg']),
      'https://base44.app/storage/report.pdf']);
  }

  for (const [id, visit, patient, nurse, created, auditDate] of [
    ['aud-mine', 'visit-a1', 'patient-a1', email(CLINICIAN_A), '2026-09-01', '2026-09-21'],
    ['aud-theirs', 'visit-a1', 'patient-a1', email(ADMIN_A), '2026-09-02', '2026-09-11'],
    ['aud-elsewhere', 'visit-b1', 'patient-b1', email(CLINICIAN_A), '2026-09-03', '2026-09-12'],
  ]) {
    await db.query(`insert into ${SCHEMA}."compliance_audit"
      ("source_app_id","id","visit_id","patient_id","nurse_email","created_date","audit_date")
      values ($1,$2,$3,$4,$5,$6,$7)`,
    [APP, id, visit, patient, nurse, `${created} 00:00:00+00`, `${auditDate} 00:00:00+00`]);
  }

  for (const [id, agency, creator, created, chart = null] of [
    ['adr-mine', A, email(CLINICIAN_A), '2026-09-01'],
    ['adr-theirs', A, email(ADMIN_A), '2026-09-02'],
    ['adr-elsewhere', B, email(CLINICIAN_A), '2026-09-03'],
    // The CROSSED case: filed in agency A, by a caller who holds agency A,
    // naming a chart that lives in agency B. Every check on the way through
    // admits it — the row's own tenancy is agency A's and its creator matches —
    // so before `chart_not_elsewhere` this row handed agency B's patient name
    // and medicare number to agency A's administrator.
    ['adr-crossed', A, email(CLINICIAN_A), '2026-09-04', 'patient-b1'],
    // The control beside it: same shape, this agency's own chart.
    ['adr-own-chart', A, email(CLINICIAN_A), '2026-09-05', 'patient-a1'],
    // The term's third branch: a chart this store does not carry at all. It is
    // UNRESOLVABLE rather than proved crossed, so it stays — and it is seeded
    // here so a tightening that hid it would fail rather than read as tidy.
    ['adr-uncarried', A, email(CLINICIAN_A), '2026-09-06', 'patient-not-in-this-store'],
  ]) {
    await db.query(`insert into ${SCHEMA}."adr_audit_case"
      ("source_app_id","id","agency_id","created_by","created_date","case_name",
       "patient_id","patient_name",
       "medicare_number","letter_file_url","packet_file_url","final_packet_url",
       "packet_page_count")
      values ($1,$2,$3,$4,$5,$6,$7,$8,'1EG4TE5MK73','https://base44.app/l.pdf',
        'https://base44.app/p.pdf','https://base44.app/f.pdf',12)`,
    [APP, id, agency, creator, `${created} 00:00:00+00`, `Case ${id}`,
      chart, chart ? `Subject of ${chart}` : null]);
  }

  for (const [id, agency, user, created, expiration, status] of [
    ['cred-mine', A, email(CLINICIAN_A), '2026-09-01', '2027-01-01', 'approved'],
    ['cred-theirs', A, email(ADMIN_A), '2026-09-02', '2026-12-01', 'pending_approval'],
    ['cred-elsewhere', B, email(CLINICIAN_A), '2026-09-03', '2026-11-01', 'approved'],
  ]) {
    await db.query(`insert into ${SCHEMA}."personnel_credential"
      ("source_app_id","id","agency_id","user_id","created_date","updated_date",
       "expiration_date","status","credential_number","uploaded_file_url","uploaded_file_name")
      values ($1,$2,$3,$4,$5,$5,$6,$7,'RN-99','https://base44.app/c.pdf','licence.pdf')`,
    [APP, id, agency, user, `${created} 00:00:00+00`, expiration, status]);
  }

  for (const [id, agency, user, created] of [
    ['ack-mine', A, email(CLINICIAN_A), '2026-09-01'],
    ['ack-theirs', A, email(ADMIN_A), '2026-09-02'],
    ['ack-elsewhere', B, email(CLINICIAN_A), '2026-09-03'],
  ]) {
    await db.query(`insert into ${SCHEMA}."policy_acknowledgment"
      ("source_app_id","id","agency_id","user_id","created_date","policy_id","doc_url")
      values ($1,$2,$3,$4,$5,'policy-1','https://base44.app/policy.pdf')`,
    [APP, id, agency, user, `${created} 00:00:00+00`]);
  }
});
after(async () => db?.close());

async function as(n, sql, params = []) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(n), session_id: sid(n), role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role authenticated');
    const { rows } = await db.query(sql, params);
    await db.exec('rollback');
    return rows[0].result;
  } catch (error) { await db.exec('rollback'); throw error; }
}
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);
const ids = answer => answer.entries.map(row => row.id);

const incidents = (n, options = {}) => as(n, INCIDENTS, [options.agency ?? A,
  options.patient_id ?? null, options.client_request_id ?? null,
  options.order ?? null, options.limit ?? null]);
const audits = (n, options = {}) => as(n, AUDITS, [options.agency ?? A,
  options.patient_id ?? null, options.visit_id ?? null, options.order ?? null,
  options.limit ?? null]);
const adrCases = (n, options = {}) =>
  as(n, ADR, [options.agency ?? A, options.order ?? null, options.limit ?? null]);
const credentials = (n, options = {}) => as(n, CREDENTIALS, [options.agency ?? A,
  options.user_id ?? null, options.status ?? null, options.order ?? null, options.limit ?? null]);
const acks = (n, options = {}) => as(n, ACKS, [options.agency ?? A,
  options.user_id ?? null, options.order ?? null, options.limit ?? null]);

/* ------------------------------------------------- the agency is the fence */

test('a caller who holds no membership in the agency is refused, not answered empty', async () => {
  // An empty list would say the agency exists and is empty, which is a claim
  // about an agency that is not theirs — `contract_roster_list`'s reason.
  await refusal(incidents(ADMIN_B), 'PENNSYNC_INCIDENT_READ_AGENCY_NOT_HELD');
  await refusal(audits(ADMIN_B), 'PENNSYNC_AUDIT_READ_AGENCY_NOT_HELD');
  await refusal(adrCases(ADMIN_B), 'PENNSYNC_ADR_READ_AGENCY_NOT_HELD');
  await refusal(credentials(ADMIN_B), 'PENNSYNC_CREDENTIAL_READ_AGENCY_NOT_HELD');
  await refusal(acks(ADMIN_B), 'PENNSYNC_POLICY_ACK_READ_AGENCY_NOT_HELD');
});

test('another agency\'s rows are absent from an administrator\'s whole-agency list', async () => {
  // Each `-elsewhere` row is in agency B and its creator holds agency A, so a
  // contract that trusted `caller_agencies()` alone would leak it into A's
  // list for that person. D51's trap.
  assert.ok(!ids(await incidents(ADMIN_A, { limit: 5000 })).includes('inc-elsewhere'));
  assert.ok(!ids(await audits(ADMIN_A, { limit: 5000 })).includes('aud-elsewhere'));
  assert.ok(!ids(await adrCases(ADMIN_A, { limit: 1000 })).includes('adr-elsewhere'));
  assert.ok(!ids(await credentials(ADMIN_A, { limit: 5000 })).includes('cred-elsewhere'));
  assert.ok(!ids(await acks(ADMIN_A, { limit: 2000 })).includes('ack-elsewhere'));
  // And the creator asking as themselves does not see it either.
  assert.ok(!ids(await adrCases(CLINICIAN_A)).includes('adr-elsewhere'));
  assert.ok(!ids(await credentials(CLINICIAN_A)).includes('cred-elsewhere'));
  assert.ok(!ids(await acks(CLINICIAN_A)).includes('ack-elsewhere'));
});

test('a caller holding two agencies gets the one they named, not both', async () => {
  // The test above cannot fail while every caller holds one membership: the
  // policies hide the other agency's rows on their own, so it would pass with
  // every agency binding deleted — which was measured, not assumed. This is
  // the same assertion under a caller for whom the policies admit BOTH
  // agencies, so each contract's own `p_agency` predicate is the only thing
  // left. Delete any of the five and this fails.
  //
  // `ADMIN_BOTH` is an `agency_admin` in each, so `caller_opens_every_chart`
  // is true for both and D24 narrows nothing here. The two chart-tenanted
  // tables are the sharp case: `incident` and `compliance_audit` have no
  // `agency_id` of their own, so their binding is an EXISTS through the chart
  // rather than a column comparison, and a reader checking for a tenant
  // predicate by eye would not find one.
  const answers = [
    ['inc-elsewhere', ids(await incidents(ADMIN_BOTH, { limit: 5000 }))],
    ['aud-elsewhere', ids(await audits(ADMIN_BOTH, { limit: 5000 }))],
    ['adr-elsewhere', ids(await adrCases(ADMIN_BOTH, { limit: 1000 }))],
    ['cred-elsewhere', ids(await credentials(ADMIN_BOTH, { limit: 5000 }))],
    ['ack-elsewhere', ids(await acks(ADMIN_BOTH, { limit: 2000 }))],
  ];
  for (const [elsewhere, answer] of answers) {
    assert.ok(!answer.includes(elsewhere), `${elsewhere} leaked into agency A's list`);
  }
  // A positive control, because an assertion that something is absent passes
  // when the list is empty for an unrelated reason. This caller opens every
  // chart in agency A, so agency A's rows are all there.
  assert.ok(answers[0][1].includes('inc-mine') && answers[0][1].includes('inc-theirs'));
  assert.ok(answers[2][1].includes('adr-mine') && answers[2][1].includes('adr-theirs'));
  // And naming agency B gets agency B's row rather than nothing, so the
  // contract is binding to the argument rather than to agency A.
  assert.deepEqual(ids(await adrCases(ADMIN_BOTH, { agency: B, limit: 1000 })),
    ['adr-elsewhere']);
});

/* ------------------------------------------ a subset is a narrowing too */

test('every column of the five tables is projected, or exempt for a stated reason', async () => {
  // These five contracts succeed a raw `Entity.filter`, which returned the
  // whole row. So a projection that names a subset HIDES fields the screens
  // are entitled to, and it fails silently: a screen reading a column that
  // stopped arriving renders blank rather than erroring. The exemptions are
  // therefore enumerated with a reason each, read out of the store rather
  // than typed, so a column added to any of these tables fails this test
  // instead of quietly never reaching the app.
  const EXEMPT = {
    // D56 and D77: a carried `file_url` string points at Base44's storage and
    // the owned resolver fails closed on it, so projecting one would hand a
    // caller a URL it would then fetch. Reconnecting these is the file layer's
    // work. `uploaded_file_name` IS projected, so a screen can still say which
    // document was filed.
    incident: ['photo_urls', 'state_reportable_pdf_url'],
    adr_audit_case: ['final_packet_url', 'letter_file_url', 'packet_file_url'],
    personnel_credential: ['uploaded_file_url',
      // D50's sweep bookkeeping: the three reminder tiers' claim markers exist
      // so that one cron cannot consume another's tier. No screen reads them —
      // asserted below rather than assumed — and a claim marker in a list
      // answer is an invitation to drive the sweep from a client.
      'expiration_note_claimed_by', 'expiration_note_offsets_sent',
      'reminder_claimed_at', 'reminder_claimed_by', 'reminder_offsets_sent',
      'renewal_email_claimed_at', 'renewal_email_claimed_by',
      'renewal_email_offsets_sent'],
    policy_acknowledgment: ['doc_url'],
    compliance_audit: [],
  };
  const first = {
    incident: (await incidents(ADMIN_A)).entries,
    compliance_audit: (await audits(ADMIN_A)).entries,
    adr_audit_case: (await adrCases(ADMIN_A)).entries,
    personnel_credential: (await credentials(ADMIN_A)).entries,
    policy_acknowledgment: (await acks(ADMIN_A)).entries,
  };
  for (const [table, exempt] of Object.entries(EXEMPT)) {
    assert.ok(first[table].length > 0, `${table} seeded no row to read the projection off`);
    // The projection is taken from an ANSWER rather than from the migration's
    // text, so this measures what a caller receives.
    const projected = new Set(Object.keys(first[table][0]));
    const { rows } = await db.query(
      `select column_name from information_schema.columns
        where table_schema = $1 and table_name = $2 and column_name <> 'source_app_id'`,
      [SCHEMA.replace(/"/g, ''), table]);
    const missing = rows.map(row => row.column_name)
      .filter(column => !projected.has(column)).sort();
    assert.deepEqual(missing, [...exempt].sort(),
      `${table}: unprojected columns do not match the stated exemptions`);
  }
  // The sweep markers are exempt because nothing in the app reads them. That
  // is a claim about `src/`, so it is measured over the whole tree rather than
  // asserted in prose — naming one page would answer about that page only.
  const sources = readdirSync(resolve(repository, 'src'), { recursive: true })
    .filter(name => /\.(js|jsx)$/.test(String(name)))
    .map(name => readFileSync(resolve(repository, 'src', String(name)), 'utf8'))
    .join('\n');
  for (const marker of EXEMPT.personnel_credential.filter(name => name !== 'uploaded_file_url')) {
    assert.ok(!sources.includes(marker), `${marker} is read by a screen and cannot be exempt`);
  }
});

/* ------------------------------------------- D45: tenancy is not ownership */

test('an agency colleague reads their own rows and not a colleague\'s', async () => {
  // Every `-mine`/`-theirs` pair is in ONE agency, so the policies admit both
  // rows to both callers. Only the contract's predicate separates them.
  // The SET, not membership: the clinician filed four of agency A's ADR cases
  // and two come back. An `includes`-style assertion here would survive a term
  // that hid all four. The two that are gone are gone for DIFFERENT reasons,
  // which is why the set is pinned rather than the count: `adr-crossed` by
  // `chart_not_elsewhere`, and `adr-uncarried` by D24 — its chart is not in
  // `caller_assigned_patients(agency)` because it is in no agency's chart list
  // at all, and a clinician opens only the charts they are assigned to. The
  // administrator below sees that one, which is what separates the two causes.
  assert.deepEqual(ids(await adrCases(CLINICIAN_A)), ['adr-own-chart', 'adr-mine']);
  assert.deepEqual(ids(await credentials(CLINICIAN_A)), ['cred-mine']);
  assert.deepEqual(ids(await acks(CLINICIAN_A)), ['ack-mine']);
  const audit = ids(await audits(CLINICIAN_A));
  assert.ok(audit.includes('aud-mine') && !audit.includes('aud-theirs'));
  const incident = ids(await incidents(CLINICIAN_A));
  assert.ok(incident.includes('inc-mine') && !incident.includes('inc-theirs'));
});

test('D40: an agency_admin reads the whole agency', async () => {
  const adr = ids(await adrCases(ADMIN_A));
  assert.ok(adr.includes('adr-mine') && adr.includes('adr-theirs'));
  const cred = ids(await credentials(ADMIN_A));
  assert.ok(cred.includes('cred-mine') && cred.includes('cred-theirs'));
  const ack = ids(await acks(ADMIN_A));
  assert.ok(ack.includes('ack-mine') && ack.includes('ack-theirs'));
  const audit = ids(await audits(ADMIN_A));
  assert.ok(audit.includes('aud-mine') && audit.includes('aud-theirs'));
  const incident = ids(await incidents(ADMIN_A));
  assert.ok(incident.includes('inc-mine') && incident.includes('inc-theirs'));
});

test('the incident rls block\'s third term: a sample row is everybody\'s', async () => {
  // `{"data.is_sample": true}` is the original's own third disjunct, and it is
  // the one term of the five blocks that is neither ownership nor the admin
  // tier. A row nobody created still reaches the clinician.
  assert.ok(ids(await incidents(CLINICIAN_A)).includes('inc-sample'));
});

test('asking for a colleague by name is refused, not answered empty', async () => {
  // Divergence 3. An empty list is a claim about THEM; a refusal is a claim
  // about the caller.
  await refusal(credentials(CLINICIAN_A, { user_id: email(ADMIN_A) }),
    'PENNSYNC_CREDENTIAL_READ_SUBJECT_FORBIDDEN');
  await refusal(acks(CLINICIAN_A, { user_id: email(ADMIN_A) }),
    'PENNSYNC_POLICY_ACK_READ_SUBJECT_FORBIDDEN');
  // Asking for themselves is fine, and so is an administrator asking for
  // anybody in their agency.
  assert.deepEqual(ids(await credentials(CLINICIAN_A, { user_id: email(CLINICIAN_A) })),
    ['cred-mine']);
  assert.deepEqual(ids(await credentials(ADMIN_A, { user_id: email(CLINICIAN_A) })),
    ['cred-mine']);
  assert.deepEqual(ids(await acks(ADMIN_A, { user_id: email(CLINICIAN_A) })), ['ack-mine']);
});

test('D24 is under all of it: an unassigned clinician opens no chart', async () => {
  // `clinician-empty` holds agency A and is on no care team, so the chart
  // predicate on `incident_read` and `compliance_audit_read` empties both
  // lists regardless of ownership — the narrowing is not this contract's and
  // it is not removed by it either.
  assert.deepEqual(ids(await incidents(CLINICIAN_EMPTY)), []);
  assert.deepEqual(ids(await audits(CLINICIAN_EMPTY)), []);
  // `inc-other-chart` was filed by the clinician on a chart they are not on,
  // so ownership admits it and the chart policy does not.
  assert.ok(!ids(await incidents(CLINICIAN_A)).includes('inc-other-chart'));
  assert.ok(ids(await incidents(ADMIN_A)).includes('inc-other-chart'));
});

/* ------------------------------------------------ divergence 1: no locator */

test('no file locator is projected by any of the five', async () => {
  const projected = [
    ...(await incidents(ADMIN_A)).entries,
    ...(await audits(ADMIN_A)).entries,
    ...(await adrCases(ADMIN_A)).entries,
    ...(await credentials(ADMIN_A)).entries,
    ...(await acks(ADMIN_A)).entries,
  ];
  assert.ok(projected.length > 0, 'the assertion below is vacuous on an empty list');
  const locators = ['photo_urls', 'state_reportable_pdf_url', 'letter_file_url',
    'packet_file_url', 'final_packet_url', 'uploaded_file_url', 'doc_url'];
  for (const row of projected) {
    for (const field of locators) {
      assert.ok(!Object.hasOwn(row, field), `${field} is a Base44 storage locator (D56, D77)`);
    }
    for (const value of Object.values(row)) {
      assert.ok(!JSON.stringify(value ?? null).includes('base44.app'),
        'no projected value carries a Base44 storage URL');
    }
  }
  // The fields beside them that are NOT locators do come back, so the rule
  // above is a rule about locators rather than about everything near one.
  assert.equal((await credentials(ADMIN_A)).entries[0].uploaded_file_name, 'licence.pdf');
  assert.equal((await adrCases(ADMIN_A)).entries[0].packet_page_count, 12);
  assert.equal((await adrCases(ADMIN_A)).entries[0].medicare_number, '1EG4TE5MK73');
});

/* -------------------------------------------------- divergence 2: the order */

test('an order outside the capability\'s own set is refused, never replaced', async () => {
  await refusal(incidents(ADMIN_A, { order: 'audit_date' }),
    'PENNSYNC_INCIDENT_READ_ORDER_INVALID');
  await refusal(audits(ADMIN_A, { order: 'incident_date' }), 'PENNSYNC_AUDIT_READ_ORDER_INVALID');
  await refusal(adrCases(ADMIN_A, { order: 'updated_date' }), 'PENNSYNC_ADR_READ_ORDER_INVALID');
  await refusal(credentials(ADMIN_A, { order: 'audit_date' }),
    'PENNSYNC_CREDENTIAL_READ_ORDER_INVALID');
  await refusal(acks(ADMIN_A, { order: 'expiration_date' }),
    'PENNSYNC_POLICY_ACK_READ_ORDER_INVALID');
  // One capability's column is not another's: `expiration_date` is the
  // credential's and nobody else's, which is the reason the allowlist is a
  // parameter rather than a shared list (D50).
  assert.equal((await credentials(ADMIN_A, { order: 'expiration_date' })).order,
    'expiration_date');
});

test('the two orders a capability declares really order it differently', async () => {
  // `-created_date` and `-incident_date` disagree on these rows, so a contract
  // that accepted the order and ignored it would pass every other test here.
  assert.deepEqual(ids(await incidents(ADMIN_A, { order: 'created_date' }))
    .filter(id => id.startsWith('inc-')).slice(0, 3),
  ['inc-other-chart', 'inc-sample', 'inc-theirs']);
  assert.deepEqual(ids(await incidents(ADMIN_A, { order: 'incident_date' })).slice(0, 3),
    ['inc-other-chart', 'inc-mine', 'inc-theirs']);
  assert.deepEqual(ids(await audits(ADMIN_A, { order: 'created_date' })),
    ['aud-theirs', 'aud-mine']);
  assert.deepEqual(ids(await audits(ADMIN_A, { order: 'audit_date' })),
    ['aud-mine', 'aud-theirs']);
  assert.deepEqual(ids(await credentials(ADMIN_A, { order: 'created_date' })),
    ['cred-theirs', 'cred-mine']);
  assert.deepEqual(ids(await credentials(ADMIN_A, { order: 'expiration_date' })),
    ['cred-mine', 'cred-theirs']);
  // An absent order is the first of the set rather than an arbitrary one.
  assert.equal((await incidents(ADMIN_A)).order, 'created_date');
  assert.equal((await credentials(ADMIN_A)).order, 'created_date');
});

/* --------------------------------------------------- divergence 4: the limit */

test('the limit clamps rather than refusing, and the answer says to what', async () => {
  assert.equal((await incidents(ADMIN_A, { limit: 1 })).entries.length, 1);
  assert.equal((await incidents(ADMIN_A, { limit: 1 })).limit, 1);
  assert.equal((await incidents(ADMIN_A, { limit: 99999 })).limit, 5000);
  assert.equal((await incidents(ADMIN_A, { limit: 0 })).limit, 1);
  assert.equal((await adrCases(ADMIN_A, { limit: 99999 })).limit, 1000);
  assert.equal((await acks(ADMIN_A, { limit: 99999 })).limit, 2000);
  assert.equal((await credentials(ADMIN_A, { limit: 99999 })).limit, 5000);
  assert.equal((await audits(ADMIN_A, { limit: 99999 })).limit, 5000);
});

/* ----------------------------------------------------------- the filters */

test('the filters the frontend actually sends', async () => {
  assert.deepEqual(ids(await incidents(ADMIN_A, { patient_id: 'patient-a2' })),
    ['inc-other-chart']);
  assert.deepEqual(ids(await incidents(ADMIN_A, { client_request_id: 'req-inc-mine' })),
    ['inc-mine']);
  assert.deepEqual(ids(await audits(ADMIN_A, { patient_id: 'patient-a1' })),
    ['aud-theirs', 'aud-mine']);
  assert.deepEqual(ids(await audits(ADMIN_A, { visit_id: 'visit-a1' })),
    ['aud-theirs', 'aud-mine']);
  assert.deepEqual(ids(await credentials(ADMIN_A, { status: 'pending_approval' })),
    ['cred-theirs']);
  // A malformed subject is refused rather than matching nothing, so a caller
  // cannot tell "no such chart" from "not a chart of yours" by the shape of
  // the id they sent.
  await refusal(incidents(ADMIN_A, { patient_id: 'patient a1; drop' }),
    'PENNSYNC_INCIDENT_READ_SUBJECT_INVALID');
  await refusal(audits(ADMIN_A, { visit_id: '../visit' }), 'PENNSYNC_AUDIT_READ_VISIT_INVALID');
  await refusal(credentials(ADMIN_A, { status: 'approve' }),
    'PENNSYNC_CREDENTIAL_READ_STATUS_INVALID');
});

/* ------------------------------- the two readings recorded rather than fixed */

test('a chartless incident and a visitless audit cannot be written here', async () => {
  // The migration's header says both rows would be readable by nobody (D61).
  // Drive the INSERT rather than asserting the comment.
  //
  // The instrument needs saying. A plain `authenticated` insert dies on
  // `permission denied for function deployment_app` before a policy is
  // evaluated, and a bare `set role pennsync_records_owner` has no caller at
  // all — `caller_agencies()` comes back empty, so EVERY insert is refused and
  // the assertion passes for a reason unrelated to the null. So the probe is a
  // SECURITY DEFINER owned by the record owner, which is the context every
  // contract writes in, and each case carries its own positive control.
  await db.exec(`set role "pennsync_records_owner";
    create function ${SCHEMA}.zz_probe_insert(p_table text, p_column text, p_value text)
      returns boolean language plpgsql security definer set search_path = '' as $p$
    begin
      execute format('insert into %I.%I ("source_app_id","id",%I) values ($1,$2,$3)',
        'pennsync_records', p_table, p_column) using '${APP}', 'zz-probe-' || p_table, p_value;
      return true;
    end $p$;
    reset role`);
  const probe = (table, column, value) => as(ADMIN_A,
    `select ${SCHEMA}.zz_probe_insert($1,$2,$3) as result`, [table, column, value]);

  await refusal(probe('incident', 'patient_id', null), /row-level security/i.source);
  assert.equal(await probe('incident', 'patient_id', 'patient-a1'), true);
  await refusal(probe('compliance_audit', 'visit_id', null), /row-level security/i.source);
  assert.equal(await probe('compliance_audit', 'visit_id', 'visit-a1'), true);

  await db.exec(`set role "pennsync_records_owner";
    drop function ${SCHEMA}.zz_probe_insert(text,text,text); reset role`);
});

test('the two shared internals are the record owner\'s alone', async () => {
  // The contracts themselves are granted to `authenticated` like every other
  // one in the family. These two are not endpoints: they are the clamp and the
  // order check the five share, and a caller reaching them would be choosing
  // its own ceiling.
  await refusal(as(ADMIN_A, `select ${SCHEMA}.compliance_read_limit(1,1,1) as result`),
    'permission denied');
  await refusal(as(ADMIN_A,
    `select ${SCHEMA}.compliance_read_order('x',array['x'],'m') as result`), 'permission denied');
  // The control: the contract beside them IS reachable, so the refusals above
  // are about these two rather than about the caller.
  assert.ok(Array.isArray((await as(ADMIN_A,
    `select ${SCHEMA}.contract_incident_list($1,null,null,null,null) as result`, [A])).entries));
});

/* ------------------------------- the crossed chart, closed by #313's helper */

/** The term's own definition, out of the migration that ships it. */
function termDefinition() {
  const sql = readFileSync(resolve(repository, CHART_AGENCY), 'utf8');
  const open = sql.indexOf('create function "pennsync_records".chart_not_elsewhere(');
  assert.ok(open >= 0, 'chart_agency no longer declares chart_not_elsewhere');
  const close = sql.indexOf('$chart$;\n', open);
  assert.ok(close >= 0, 'unterminated chart_not_elsewhere');
  return `set role "pennsync_records_owner"; create or replace `
    + sql.slice(open + 'create '.length, close + '$chart$;\n'.length) + ' reset role;';
}

/**
 * Run `body` with the term answering true for every row, then put it back.
 *
 * The restore is the migration's own text rather than a retyped copy, so a
 * drift between this suite and the file it depends on cannot make the "after"
 * half pass against a definition this repository does not ship.
 */
async function withoutTheTerm(body) {
  await db.exec(`set role "pennsync_records_owner";
    create or replace function ${SCHEMA}.chart_not_elsewhere(
      p_patient_id text, p_agency text) returns boolean
      language sql stable set search_path = '' as $sabotage$ select true $sabotage$;
    reset role;`);
  try { return await body(); } finally { await db.exec(termDefinition()); }
}

test('an ADR case naming another agency\'s chart is reachable, then hidden', async () => {
  // THE PRECONDITION (D107). Without it the assertion below passes against a
  // fixture that never had the row, a caller who could not reach it, or a page
  // the limit had already cut — three ways to measure nothing. `adr-crossed`
  // is tenanted to agency A and filed by a caller who holds agency A, so
  // everything else on the way through admits it: this is the leak the term
  // closes, and before the term an agency-A administrator read agency B's
  // patient name and medicare number off it.
  const reachable = await withoutTheTerm(() => adrCases(ADMIN_A, { limit: 1000 }));
  assert.ok(ids(reachable).includes('adr-crossed'),
    'the crossed row must be returned with the term removed');

  // The EXACT surviving set rather than `!includes('adr-crossed')`: a weaker
  // assertion is satisfied by a second, different regression — a term that hid
  // every chart-naming row would pass it — and a refusal test a wrong answer
  // can satisfy is the vacuous case one assertion away.
  assert.deepEqual(ids(await adrCases(ADMIN_A, { limit: 1000 })),
    ['adr-uncarried', 'adr-own-chart', 'adr-theirs', 'adr-mine'],
    'the term must remove the crossed row and nothing else');
});

test('the other two branches keep their rows', async () => {
  // Decisions rather than fallbacks. `adr-uncarried` names a chart this store
  // does not hold, which is UNRESOLVABLE rather than proved crossed — hiding
  // it would lose a row from its own agency for a reason nobody can see (D61)
  // — and `adr-theirs` names no chart at all, which is agency-scoped and not
  // yet anybody's chart. Without both cases a tightening that deleted the two
  // `is null` branches would pass every other test here.
  const page = ids(await adrCases(ADMIN_BOTH, { limit: 1000 }));
  assert.ok(page.includes('adr-uncarried') && page.includes('adr-theirs'));
  assert.ok(page.includes('adr-own-chart'), 'this agency\'s own chart must stay');
});

test('the two chart-tenanted reads need no term, and adding one would widen them',
  async () => {
    // `incident` and `compliance_audit` carry no `agency_id`, so their tenancy
    // is an `exists` through the chart — a POSITIVE check, which under the same
    // definer blindness fails CLOSED: a chart the definer cannot resolve
    // produces no row and the incident is dropped. So they are already safe
    // from the crossed case, and `chart_not_elsewhere` would make them LESS so,
    // because its first branch keeps a row whose `patient_id` is null.
    //
    // Proved by sabotaging the term, which these two do not call: their answers
    // must not move at all. If either ever adopts it this test fails, which is
    // the reminder to read the direction before copying the guard across.
    const before = [ids(await incidents(ADMIN_A, { limit: 5000 })),
      ids(await audits(ADMIN_A, { limit: 5000 }))];
    const during = await withoutTheTerm(async () => [
      ids(await incidents(ADMIN_A, { limit: 5000 })),
      ids(await audits(ADMIN_A, { limit: 5000 }))]);
    assert.deepEqual(during, before,
      'one of these reads calls chart_not_elsewhere; check whether it widens it');
    // And the positive control: the crossed-chart case for these two is
    // `inc-elsewhere`, whose chart is agency B's, and it is absent either way.
    assert.ok(before[0].includes('inc-mine') && !before[0].includes('inc-elsewhere'));
  });
