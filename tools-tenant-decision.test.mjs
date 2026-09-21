import test from 'node:test';
import assert from 'node:assert/strict';
import {
  brokerWritable, schemaAuthority,
  auditBrokerCeiling, auditDecision, checkDecisions, KINDS, readDecisions, STAMPED_KINDS,
} from './tools-tenant-decision.mjs';
import { readFileSync } from 'node:fs';
import { readEntity } from './tools-tenant-path.mjs';

const REPO = process.cwd();
const carried = new Map([['patient', 'Patient'], ['agency', 'Agency']]);
const audit = (decision, schema = {}, extra = []) =>
  auditDecision({ entity: 'Example', decision, schema, carried,
    ...(Array.isArray(extra) ? { locators: extra } : { locators: [], ...extra }) });
const reason = 'A stated reason long enough to be a real one.';

test('every entity without a derivable tenant path has a decision, and none has a spare', () => {
  const report = checkDecisions(REPO);
  assert.deepEqual(report.problems, []);
  // 87, not 86: `User` used to be exempt from needing a decision because every
  // kind available would have authorized through its own self-editable column.
  // D23 adds one that does not consult that column at all, so it is decided
  // like everything else.
  //
  // 99, not 87: D61 stopped counting a reference through an OPTIONAL column as
  // a tenant path, because a row with a null there is in no tenant and no
  // policy can admit it. Twelve entities moved into the blocking set and were
  // decided `agency`, which is how a reorder task, an ADR case filed before a
  // chart existed and a generic phrase template became readable at all.
  assert.equal(report.blocking, 99);
  assert.deepEqual(report.counts, { agency: 78, self: 10, shared: 2, global: 8, roster: 1 });
  // agency and shared both carry a tenant key, so both are stamped before load.
  assert.equal(report.stamped.length, 80);
});

test('a self-editable profile claim can only be decided roster, and nothing else can be', () => {
  // The pairing is what keeps D23 from becoming a way to widen anything else.
  // `roster` does not read the row's tenant column at all, so on an entity
  // that HAS a usable one it would replace a key with "whoever shares an
  // agency with the caller" — wider, every time.
  const decided = readDecisions(REPO).entities;
  assert.equal(decided.User.kind, 'roster');
  assert.match(audit({ kind: 'roster', because: reason }, { properties: {} }, {}).join(' '),
    /roster is only for an entity whose own tenant key is a self-editable claim/);
  assert.deepEqual(audit({ kind: 'roster', because: reason }, { properties: {} }, { pathKind: 'profile_claim' }), []);
  for (const kind of ['agency', 'self', 'shared', 'global']) {
    assert.match(audit({ kind, because: reason, subject: 'user_id', platform_flag: 'shared' },
      { properties: { user_id: { type: 'string' }, shared: { type: 'boolean' } } },
      { pathKind: 'profile_claim' }).join(' '),
    new RegExp(`can only be decided roster, never ${kind}`), kind);
  }
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

const ceiling = (schema, { path = null, locators = [], exempt = [] } = {}) =>
  auditBrokerCeiling({ entity: 'Example', schema, path, locators, exempt });
const props = properties => ({ properties });

test('a broker table may not reach or name a clinical subject', () => {
  // D2 caps `broker` at "no PHI and no authority decision", and a broker table
  // is one a single generic RPC family serves. Reading names put free-text
  // clinical notes and extracted document text inside that ceiling.
  assert.deepEqual(ceiling(props({ note: { type: 'string' } }),
    { path: { kind: 'reference', target: 'Patient' } }),
  ['Example: reaches tenancy through Patient, so a generic broker would serve clinical rows']);
  assert.deepEqual(ceiling(props({ patient_id: { type: 'string' } })),
    ['Example: names a clinical subject in patient_id']);
  assert.deepEqual(ceiling(props({ visit_id: { type: 'string' } })),
    ['Example: names a clinical subject in visit_id']);
  // Nested too: a reference inside an array is still a reference.
  assert.deepEqual(ceiling(props({
    rows: { type: 'array', items: { type: 'object', properties: { document_id: { type: 'string' } } } },
  })), ['Example: names a clinical subject in rows[].document_id']);
  // Reaching tenancy through something that is not clinical is fine.
  assert.deepEqual(ceiling(props({ name: { type: 'string' } }),
    { path: { kind: 'reference', target: 'Agency' } }), []);
});

test('a code is a credential when it has a lifecycle and a classification when it does not', () => {
  // The distinction that matters: `VerificationCode.code` sits beside an expiry
  // and a verified flag, so reading it redeems somebody's second factor.
  assert.deepEqual(ceiling(props({
    code: { type: 'string' }, expires_at: { type: 'string' }, verified: { type: 'boolean' },
  })), ['Example: carries a credential in code']);
  // `ServiceCode.code` and `FeaturePackage.agency_code` have no lifecycle, and
  // matching on the name alone would have called both credentials.
  assert.deepEqual(ceiling(props({ code: { type: 'string' }, description: { type: 'string' } })), []);
  assert.deepEqual(ceiling(props({ agency_code: { type: 'string' } })), []);
  // Names that are credentials however they sit.
  assert.deepEqual(ceiling(props({ session_token: { type: 'string' } })),
    ['Example: carries a credential in session_token']);
  assert.deepEqual(ceiling(props({ config: { type: 'object', properties: { api_key: { type: 'string' } } } })),
    ['Example: carries a credential in config.api_key']);
});

test('a file a broker could hand out is refused unless the exemption names it', () => {
  assert.deepEqual(ceiling(props({ file_url: { type: 'string' } }), { locators: ['file_url'] }),
    ['Example: can hold a file in file_url']);
  assert.deepEqual(ceiling(props({ url: { type: 'string' } }), { locators: ['url'], exempt: ['url'] }), []);
  // A stale exemption is how a later field slips through under an old reason.
  assert.deepEqual(ceiling(props({ name: { type: 'string' } }), { exempt: ['gone'] }),
    ['Example: exemption for gone matches no field']);
});

test('every entity the manifest brokers is inside D2 ceiling', () => {
  const report = checkDecisions(REPO);
  assert.deepEqual(report.problems, []);
  const manifest = JSON.parse(readFileSync(`${REPO}/tools-transition-disposition.json`, 'utf8'));
  const brokered = Object.keys(manifest.entities).filter(name => manifest.entities[name] === 'broker');
  assert.equal(report.brokered, brokered.length);
  // Pinned exactly, and small on purpose. This asserted `>= 25` when a large
  // broker set was believed to be the healthy state; D22 says the opposite.
  // Every entity's schema carries an `rls` block, and 28 of the 31 declare an
  // authority decision — most denying direct access outright — which is
  // precisely what D2 forbids a generic family from serving.
  assert.deepEqual(brokered, ['Announcement', 'FacilityDocumentationRule', 'RegulatoryUpdate']);
  // The ones reading names had wrongly admitted, plus the ones reading fields
  // missed. Each now needs a reviewed per-contract handler rather than a
  // generic family.
  for (const entity of ['VerificationCode', 'PDFIndex', 'TeamNote', 'SessionTimeout', 'BIIntegration',
    'EmbedConfig', 'ScheduleFeedback', 'TermsAcceptanceAudit', 'PolicyLibrary', 'LibraryDocument',
    'AIKnowledgeBase', 'ServiceCode', 'OCRTrainingSession', 'ScheduledReport', 'ApprovalRequest',
    'TranscriptionLearning', 'LearnedFormatPattern']) {
    assert.equal(manifest.entities[entity], 'port', `${entity} exceeds the broker ceiling`);
  }
  // And every survivor plainly permits a read while conditioning its writes,
  // which is why the family serves them read-only.
  for (const entity of brokered) {
    const schema = readEntity(REPO, entity);
    assert.equal(schemaAuthority(schema).read, 'allow', `${entity} must permit a plain read`);
    assert.equal(brokerWritable(schema), false, `${entity} is writable; the family has no coverage for that`);
  }
  // Moving them changes who may serve the table, never whether it is carried.
  assert.ok(['port', 'broker'].includes(manifest.entities.VerificationCode));
});
