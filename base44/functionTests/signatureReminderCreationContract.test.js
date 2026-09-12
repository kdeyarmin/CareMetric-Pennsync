import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const source = await readFile(new URL('../functions/scheduleSignatureReminders/entry.ts', import.meta.url), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const matches = (row, query) => Object.entries(query).every(([key, value]) => {
  if (key === '$or') return value.some(part => matches(row, part));
  if (value && typeof value === 'object' && '$exists' in value) return (row[key] !== undefined) === value.$exists;
  return value == null ? row[key] == null : JSON.stringify(row[key]) === JSON.stringify(value);
});

function fixture(options = {}) {
  let revision = 0;
  const stamp = () => new Date(Date.now() + ++revision).toISOString();
  const signer = { signer_id: 'signer-1', email: 'signer@example.test', required: true, status: 'pending' };
  const db = {
    Agency: [{ id: 'agency-1', status: 'active' }],
    AgencyMembership: [{ id: 'membership-1', agency_id: 'agency-1', user_id: 'creator-1', membership_key: 'agency-1:creator-1',
      user_email_normalized: 'creator@example.test', status: 'active', version: 1, tenant_role: 'manager' }],
    Patient: [{ id: 'patient-1', agency_id: 'agency-1', is_archived: false, is_sample: false }],
    DocumentPackage: [{ id: 'package-1', agency_id: 'agency-1', patient_id: 'patient-1', status: 'pending', authority_version: 1,
      created_by_user_id: 'creator-1', created_by_user_email_normalized: 'creator@example.test', creator_membership_id: 'membership-1',
      creator_membership_version: 1, document_signatures: ['signature-1'], signer_id: signer.signer_id, signer_email: signer.email,
      expires_at: new Date(Date.now() + 86400_000).toISOString(), updated_date: stamp() }],
    DocumentSignature: [{ id: 'signature-1', agency_id: 'agency-1', patient_id: 'patient-1', document_id: 'document-1',
      created_by_user_id: 'creator-1', creator_membership_id: 'membership-1', creator_membership_version: 1, authority_version: 1,
      document_binding_id: 'binding-1', document_binding_version: 2, document_content_sha256: 'a'.repeat(64), signers: [signer] }],
    DocumentTenantBinding: [{ id: 'binding-1', document_id: 'document-1', agency_id: 'agency-1', patient_id: 'patient-1',
      storage_mode: 'private', version: 2, content_sha256: 'a'.repeat(64), file_uri: 'private/source.pdf' }],
    ScheduledSignatureReminder: [], SignatureAuditEvent: [],
  };
  const creates = {};
  const entities = Object.fromEntries(Object.entries(db).map(([name, rows]) => [name, {
    filter: async query => {
      await options.beforeFilter?.(name, db, query);
      return clone(rows.filter(row => matches(row, query)));
    },
    updateMany: async (query, change) => {
      await options.beforeUpdate?.(name, db, query, change);
      const targets = rows.filter(row => matches(row, query));
      for (const row of targets) Object.assign(row, clone(change.$set), { updated_date: stamp() });
      await options.afterUpdate?.(name, db, query, change);
      return { success: true, updated: targets.length, has_more: false };
    },
    create: async data => {
      creates[name] = (creates[name] || 0) + 1;
      await options.beforeCreate?.(name, db, data);
      const row = { ...clone(data), id: `${name}-${rows.length + 1}`, updated_date: stamp() };
      rows.push(row);
      await options.afterCreate?.(name, db, row);
      return clone(row);
    },
  }]));
  const client = { auth: { me: async () => ({ id: 'creator-1', role: 'user', email: 'creator@example.test' }) }, asServiceRole: { entities } };
  let handler;
  const code = source.replace(/import \{ createClientFromRequest \} from 'npm:[^']+';/, 'const createClientFromRequest = () => client;')
    .replace('const SIGNATURE_REMINDER_RELEASE_ENABLED = false;', 'const SIGNATURE_REMINDER_RELEASE_ENABLED = true;')
    .replace('const SIGNATURE_REMINDER_ATOMIC_UNIQUENESS_PROVEN = false;', 'const SIGNATURE_REMINDER_ATOMIC_UNIQUENESS_PROVEN = true;');
  runInNewContext(transpileTs(code).outputText, { client, crypto, Date, TextEncoder, Response, Request,
    Deno: { serve: candidate => { handler = candidate; }, env: { get: () => undefined } } });
  const request = { agency_id: 'agency-1', package_id: 'package-1', document_id: 'signature-1', signer_id: 'signer-1',
    client_request_id: 'request-1', send_at: new Date(Date.now() + 3600_000).toISOString() };
  const schedule = (overrides = {}) => handler(new Request('https://example.test/schedule', { method: 'POST', body: JSON.stringify({ ...request, ...overrides }) }));
  return { db, creates, schedule };
}

test('concurrent schedules create one reserved row and one audit, and exact replay succeeds', async () => {
  let arrivals = 0;
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const f = fixture({ beforeUpdate: async name => {
    if (name !== 'DocumentPackage') return;
    if (++arrivals === 3) release();
    await barrier;
  } });
  const responses = await Promise.all([f.schedule(), f.schedule(), f.schedule()]);
  assert.equal(responses.filter(response => response.status === 200).length, 1);
  assert.equal(f.creates.ScheduledSignatureReminder, 1);
  assert.equal(f.creates.SignatureAuditEvent, 1);
  const row = f.db.ScheduledSignatureReminder[0];
  assert.equal(row.status, 'pending');
  assert.equal(f.db.DocumentPackage[0].reminder_creation_claims[row.schedule_key], row.creation_claim_token);
  assert.ok(row.audit_write_operation_id);
  assert.equal((await f.schedule()).status, 200);
  assert.equal(f.creates.ScheduledSignatureReminder, 1);
});

test('lost create and audit acknowledgements reconcile without a second write', async () => {
  const f = fixture({ afterCreate: () => { throw new Error('lost acknowledgement'); } });
  assert.equal((await f.schedule()).status, 200);
  assert.equal((await f.schedule()).status, 200);
  assert.equal(f.creates.ScheduledSignatureReminder, 1);
  assert.equal(f.creates.SignatureAuditEvent, 1);
});

test('unknown reminder create remains reserved and never automatically creates another row', async () => {
  const f = fixture({ beforeCreate: name => { if (name === 'ScheduledSignatureReminder') throw new Error('unknown create'); } });
  assert.equal((await f.schedule()).status, 202);
  assert.equal((await f.schedule()).status, 202);
  assert.equal(f.creates.ScheduledSignatureReminder, 1);
  assert.equal(f.db.ScheduledSignatureReminder.length, 0);
  assert.equal(Object.keys(f.db.DocumentPackage[0].reminder_creation_claims).length, 1);
});

test('unknown audit create leaves a non-dispatchable row and never automatically retries the write', async () => {
  const f = fixture({ beforeCreate: name => { if (name === 'SignatureAuditEvent') throw new Error('unknown audit'); } });
  assert.equal((await f.schedule()).status, 500);
  assert.equal((await f.schedule()).status, 202);
  assert.equal(f.creates.SignatureAuditEvent, 1);
  assert.equal(f.db.ScheduledSignatureReminder[0].status, 'pending_audit');
});

test('a failed activation can be resumed concurrently with a single durable audit', async () => {
  let fail = true;
  const f = fixture({ beforeUpdate: (name, _db, _query, change) => {
    if (fail && name === 'ScheduledSignatureReminder' && change.$set.status === 'pending') throw new Error('activation rejected');
  } });
  assert.equal((await f.schedule()).status, 500);
  fail = false;
  const responses = await Promise.all([f.schedule(), f.schedule()]);
  assert.ok(responses.some(response => response.status === 200));
  assert.equal((await f.schedule()).status, 200);
  assert.equal(f.creates.SignatureAuditEvent, 1);
  assert.equal(f.db.ScheduledSignatureReminder[0].status, 'pending');
});

test('an audit operation claim with a lost acknowledgement resolves by owner readback', async () => {
  const f = fixture({ afterUpdate: (name, _db, _query, change) => {
    if (name === 'ScheduledSignatureReminder' && change.$set.audit_write_operation_id) throw new Error('lost claim acknowledgement');
  } });
  assert.equal((await f.schedule()).status, 200);
  assert.equal(f.creates.SignatureAuditEvent, 1);
});

test('changed request identity and creation provenance cannot replay', async () => {
  const f = fixture();
  assert.equal((await f.schedule()).status, 200);
  assert.equal((await f.schedule({ send_at: new Date(Date.now() + 7200_000).toISOString() })).status, 409);
  f.db.ScheduledSignatureReminder[0].creation_claim_token = 'foreign-claim';
  assert.equal((await f.schedule()).status, 409);
  assert.equal(f.creates.ScheduledSignatureReminder, 1);
});

test('membership revocation after audit prevents queue activation', async () => {
  const f = fixture({ afterCreate: (name, db) => { if (name === 'SignatureAuditEvent') db.AgencyMembership[0].status = 'revoked'; } });
  assert.equal((await f.schedule()).status, 403);
  assert.equal(f.db.ScheduledSignatureReminder[0].status, 'pending_audit');
});
