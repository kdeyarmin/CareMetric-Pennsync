import test from 'node:test';
import assert from 'node:assert/strict';
import { auditDecision, checkDecisions, EXCLUDED, KINDS, readDecisions, STAMPED_KINDS } from './tools-tenant-decision.mjs';

const REPO = process.cwd();
const carried = new Map([['patient', 'Patient'], ['agency', 'Agency']]);
const audit = (decision, schema = {}, locators = []) =>
  auditDecision({ entity: 'Example', decision, schema, carried, locators });
const reason = 'A stated reason long enough to be a real one.';

test('every entity without a derivable tenant path has a decision, and none has a spare', () => {
  const report = checkDecisions(REPO);
  assert.deepEqual(report.problems, []);
  assert.equal(report.blocking, 86);
  assert.deepEqual(report.counts, { agency: 66, self: 10, shared: 2, global: 8 });
  // agency and shared both carry a tenant key, so both are stamped before load.
  assert.equal(report.stamped.length, 68);
});

test('User is excluded from authorization rather than decided', () => {
  assert.ok(EXCLUDED.includes('User'));
  const decided = readDecisions(REPO).entities;
  assert.equal(decided.User, undefined, 'a self-editable profile claim can never be a predicate');
});

test('agency is the default, so it is the only kind that claims nothing extra', () => {
  assert.equal(KINDS[0], 'agency');
  assert.deepEqual(audit({ kind: 'agency', because: reason }), []);
  assert.deepEqual([...STAMPED_KINDS].sort(), ['agency', 'shared']);
});

test('a global table is refused every way tenant data could reach it', () => {
  // An actor column: the row records a person, and people belong to agencies.
  assert.match(
    audit({ kind: 'global', because: reason }, { properties: { created_by: { type: 'string' } } }).join(' '),
    /actor column created_by/,
  );
  // A reference to a carried entity drags that entity's tenancy in with it.
  assert.match(
    audit({ kind: 'global', because: reason }, { properties: { patient_id: { type: 'string' } } }).join(' '),
    /references carried entity Patient/,
  );
  // An undeclared locator is how an uploaded file becomes readable by everyone.
  assert.match(
    audit({ kind: 'global', because: reason }, {}, ['file_url']).join(' '),
    /can hold a file via file_url/,
  );
  // A reference buried in an object or an array becomes JSONB rather than a
  // column, so a top-level-only scan would wave it through and the global
  // policy would then read it out. The walk goes all the way down.
  const nested = { properties: { detail: { type: 'object', properties: { patient_id: { type: 'string' } } } } };
  assert.match(audit({ kind: 'global', because: reason }, nested).join(' '),
    /references carried entity Patient via detail\.patient_id/);
  const inArray = { properties: { rows: { type: 'array', items: { type: 'object', properties: { created_by: { type: 'string' } } } } } };
  assert.match(audit({ kind: 'global', because: reason }, inArray).join(' '),
    /actor column rows\[\]\.created_by/);
  // Declaring it is allowed, because reference data does cite outside sources.
  assert.deepEqual(audit({ kind: 'global', because: reason, external_locators: ['file_url'] }, {}, ['file_url']), []);
  // A declaration that no longer matches a locator is stale and fails loudly,
  // so an exemption cannot outlive the field it was written for.
  assert.match(
    audit({ kind: 'global', because: reason, external_locators: ['gone'] }, {}, []).join(' '),
    /external locator gone is not a locator/,
  );
});

test('a self subject must be the row own account, never who touched it', () => {
  const schema = { properties: { user_email: { type: 'string' }, created_by: { type: 'string' } } };
  assert.deepEqual(audit({ kind: 'self', subject: 'user_email', because: reason }, schema), []);
  assert.match(
    audit({ kind: 'self', subject: 'created_by', because: reason }, schema).join(' '),
    /provenance, not the row's own account/,
  );
  assert.match(
    audit({ kind: 'self', subject: 'absent', because: reason }, schema).join(' '),
    /is not a column/,
  );
});

test('a shared table must really carry the boolean it claims to split on', () => {
  const schema = { properties: { is_system_template: { type: 'boolean' }, name: { type: 'string' } } };
  assert.deepEqual(audit({ kind: 'shared', platform_flag: 'is_system_template', because: reason }, schema), []);
  assert.match(audit({ kind: 'shared', platform_flag: 'name', because: reason }, schema).join(' '), /is not a boolean/);
  assert.match(audit({ kind: 'shared', platform_flag: 'absent', because: reason }, schema).join(' '), /is not a column/);
});

test('a decision must state a reason, and must not claim a kind that does not exist', () => {
  assert.match(audit({ kind: 'agency', because: 'too short' }).join(' '), /needs a stated reason/);
  assert.match(audit({ kind: 'invented', because: reason }).join(' '), /kind must be one of/);
  // An exemption on a kind that cannot use it is a misreading, not a no-op.
  assert.match(
    audit({ kind: 'agency', because: reason, external_locators: ['x'] }).join(' '),
    /only applies to a global table/,
  );
});

test('nothing decided self is read unfiltered by the app that owns it', async () => {
  // A `self` predicate hides every other account's rows, so an entity the app
  // lists unfiltered is not self-owned however its schema reads: the listing
  // would come back empty and any write without the subject column would be
  // refused. AIConfiguration was decided `self` on its schema alone and failed
  // exactly this way — its admin screen lists it and writes rows carrying no
  // user_email — so the property is pinned rather than re-argued.
  const { readdirSync, readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const sources = [];
  const walk = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(js|jsx)$/.test(entry.name)) sources.push(readFileSync(path, 'utf8'));
    }
  };
  walk(join(REPO, 'src'));
  const corpus = sources.join('\n');
  const offenders = Object.entries(readDecisions(REPO).entities)
    .filter(([entity, decision]) => decision.kind === 'self'
      && new RegExp(`entities\\.${entity}\\.list\\(`).test(corpus))
    .map(([entity]) => entity);
  assert.deepEqual(offenders, [], 'these are listed unfiltered, so they are not the account\'s own');
});

test('every reason is specific enough to be worth reading', () => {
  for (const [entity, decision] of Object.entries(readDecisions(REPO).entities)) {
    assert.ok(decision.because.length >= 40, `${entity}: reason is too thin`);
    assert.ok(/[.]$/.test(decision.because), `${entity}: reason should read as a sentence`);
  }
});
