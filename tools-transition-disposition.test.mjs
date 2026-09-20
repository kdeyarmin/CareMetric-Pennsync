import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACTIVE_DISPOSITIONS, ACTIVITY_TRAIL_MIGRATION, AUDITED_ENTITIES, DISPOSITIONS, FORMAT, FORMAT_VERSION,
  CHART_SCOPE_EVIDENCE, MUTATING, PORT_BLOCKERS, RETENTION_BASES, checkCoverage, classifyPortBlocker,
  discoverActivityTrail, discoverChartScope,
  discoverCapabilities, discoverEntityPolicies, discoverEvidence, discoverInertFunctions, discoverIntegrations,
  discoverPausedFunctions, discoverPolicylessEntities, discoverPortBlockers, discoverPortedFunctions,
  entitiesTouched, isInertFunction, isPausedFunction, main, parseManifest,
} from './tools-transition-disposition.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)));
const manifest = (patch = {}) => ({
  format: FORMAT, version: FORMAT_VERSION, review_state: 'proposed', retention: {},
  functions: { alpha: 'port' }, entities: { Beta: 'broker' },
  workflows: { 'Gamma.jsonc': 'preserved_paused' }, integrations: { InvokeLLM: 'port' },
  ...patch,
});
const retired = (patch = {}) => manifest({ entities: { Beta: 'retire' }, ...patch });
const capabilities = (patch = {}) => ({
  functions: ['alpha'], entities: ['Beta'], workflows: ['Gamma.jsonc'], integrations: ['InvokeLLM'], ...patch,
});

test('every repository capability carries exactly one disposition', () => {
  // The committed manifest is the gate: a new function, entity, workflow or
  // Core integration fails this test until it is classified.
  const raw = readFileSync(resolve(repository, 'tools-transition-disposition.json'), 'utf8');
  const report = checkCoverage(discoverCapabilities(repository), parseManifest(raw));
  assert.deepEqual(report.missing_disposition, []);
  assert.deepEqual(report.unknown_capability, []);
  assert.equal(report.coverage_complete, true);
  assert.ok(report.families.functions.capabilities > 250);
  assert.ok(report.families.entities.capabilities > 250);
});

test('no committed disposition contradicts the source it describes', () => {
  const raw = readFileSync(resolve(repository, 'tools-transition-disposition.json'), 'utf8');
  const report = checkCoverage(discoverCapabilities(repository), parseManifest(raw), discoverEvidence(repository));
  assert.deepEqual(report.contradicted_disposition, []);
  assert.equal(report.evidence_consistent, true);
  // The check must be looking at a real population, not an empty one.
  assert.ok(report.inert_functions > 25, `only ${report.inert_functions} inert functions found`);
});

test('every retirement says where its existing rows go', () => {
  const raw = readFileSync(resolve(repository, 'tools-transition-disposition.json'), 'utf8');
  const committed = parseManifest(raw);
  const report = checkCoverage(discoverCapabilities(repository), committed, discoverEvidence(repository));
  assert.deepEqual(report.retention_unspecified, [], 'a retired entity has no retention basis');
  assert.deepEqual(report.retention_unused, [], 'a retention basis names something that is not retired');
  assert.equal(report.retention_settled, true);
  // Retiring a table is a decision about the target store, never a deletion:
  // the access and security records keep the full HIPAA documentation period.
  for (const name of ['AuditTrail', 'SecurityLog', 'UserActivity', 'ArchivedRecord', 'SystemLog',
    'AnomalyAlert', 'TimeSavings']) {
    assert.equal(committed.entities[name], 'retire', `${name} should be retired`);
    assert.deepEqual(committed.retention[name], { basis: 'archive', years: 6 },
      `${name} must keep its rows for the full period`);
  }
  // A mirror of somebody else's record names the system that holds it.
  for (const name of ['Subscription', 'SubscriptionSettings']) {
    assert.equal(committed.retention[name].basis, 'external_system_of_record');
    assert.ok(committed.retention[name].system.trim().length > 0);
  }
});

test('a retirement with nowhere for its rows fails the gate', () => {
  const report = checkCoverage(capabilities(), retired(), { inertFunctions: [] });
  assert.deepEqual(report.retention_unspecified, ['entities:Beta']);
  assert.equal(report.retention_settled, false);
  assert.equal(report.census_ready, false);
  // Naming where they go settles it.
  const settled = checkCoverage(capabilities(), retired({ retention: { Beta: { basis: 'archive', years: 6 } } }));
  assert.deepEqual(settled.retention_unspecified, []);
  assert.equal(settled.retention_settled, true);
});

test('a retention basis for something that is not retired is reported', () => {
  const report = checkCoverage(capabilities(), manifest({ retention: { Beta: { basis: 'archive', years: 6 } } }));
  assert.deepEqual(report.retention_unused, ['entities:Beta']);
  assert.equal(report.retention_settled, false);
});

test('an unsettled retirement blocks the census even when owners accepted', () => {
  const report = checkCoverage(capabilities(), retired({ review_state: 'accepted' }), { inertFunctions: [] });
  assert.equal(report.coverage_complete, true);
  assert.equal(report.evidence_consistent, true);
  assert.equal(report.census_ready, false, 'retention must be settled before the census is usable');
  assert.equal(checkCoverage(capabilities(), retired({
    review_state: 'accepted', retention: { Beta: { basis: 'none', years: 0 } },
  })).census_ready, true);
});

test('the retention bases are the exact reviewed set', () => {
  assert.deepEqual([...RETENTION_BASES].sort(), ['archive', 'external_system_of_record', 'none']);
});

test('a fail-closed endpoint is never declared port, broker or hub', () => {
  // These are quarantined, paused or retired in the repository: each serves one
  // constant response and reaches nothing. Declaring any of them active would
  // send a reviewer to port an endpoint that has no behavior left to port.
  const declared = parseManifest(readFileSync(resolve(repository, 'tools-transition-disposition.json'), 'utf8')).functions;
  const inert = discoverInertFunctions(repository);
  for (const name of ['analyzeClinicalData', 'analyzeDocument', 'analyzeNursePerformance',
    'autoAssignNurseToPatient', 'generateDischargeSummary', 'generatePatientEducation',
    'getPatientContext', 'runSecurityAudit', 'getUserActivityLog']) {
    assert.ok(inert.includes(name), `${name} should be detected as inert`);
    assert.equal(ACTIVE_DISPOSITIONS.includes(declared[name]), false,
      `${name} is declared ${declared[name]} but performs no work`);
  }
  // The retired endpoint is retired, not merely paused.
  assert.equal(declared.getPatientContext, 'retire');
});

test('inertness is read from what the module can do, not from its wording', () => {
  const stub = "Deno.serve(() => Response.json({ error: 'paused' }, { status: 503 }));";
  assert.equal(isInertFunction(stub), true);
  // A constant 200 with no work is just as inert as a constant 503.
  assert.equal(isInertFunction("Deno.serve(async (_req) => Response.json({ success: true, skipped: 'disabled' }));"), true);
  // Anything that can reach a client, the network, the environment or a
  // promise is live, however paused its comment claims to be.
  assert.equal(isInertFunction("// paused\nimport { createClientFromRequest } from 'npm:@base44/sdk';\nDeno.serve(() => Response.json({}));"), false);
  assert.equal(isInertFunction('Deno.serve(async () => { await base44.entities.Patient.list(); });'), false);
  assert.equal(isInertFunction("Deno.serve(async () => { const r = await fetch('https://example.test'); return r; });"), false);
  assert.equal(isInertFunction("Deno.serve(() => Response.json({ key: Deno.env.get('X') }));"), false);
  // Branching on the method alone is still one constant answer per method.
  assert.equal(isInertFunction('Deno.serve((req) => (req.method === "POST" '
    + '? Response.json({ paused: true }, { status: 503 }) : Response.json({}, { status: 405 })));'), true);
  // Reading anything else from the request means the answer varies with the
  // caller, so a synchronous endpoint that needs no await is still live.
  assert.equal(isInertFunction('Deno.serve((req) => Response.json({ echo: new URL(req.url).searchParams.get("q") }));'), false);
  assert.equal(isInertFunction('Deno.serve((_req) => Response.json({ h: _req.headers.get("x") }));'), false);
  assert.equal(isInertFunction('Deno.serve((request) => Response.json({ u: request.url }));'), false);
  // Not an endpoint at all.
  assert.equal(isInertFunction('export const helper = () => 1;'), false);
  assert.equal(isInertFunction(null), false);
});

test('every function the detector calls inert serves one constant response', () => {
  // A false positive is the dangerous direction: it would push a live handler
  // out of port. Nothing currently detected reads its request beyond a method
  // check, so each really does answer every caller identically.
  for (const name of discoverInertFunctions(repository)) {
    const source = readFileSync(resolve(repository, 'base44/functions', name, 'entry.ts'), 'utf8');
    const reads = [...source.matchAll(/\b_?req(?:uest)?\s*\.\s*(\w+)/g)].map(match => match[1]);
    assert.deepEqual(reads.filter(property => property !== 'method'), [], `${name} reads its request`);
  }
});

test('an inert function declared active is reported and fails the gate', () => {
  const evidence = { inertFunctions: ['alpha'] };
  for (const value of ACTIVE_DISPOSITIONS) {
    const report = checkCoverage(capabilities(), manifest({ functions: { alpha: value } }), evidence);
    assert.equal(report.evidence_consistent, false);
    assert.equal(report.contradicted_disposition.length, 1);
    assert.match(report.contradicted_disposition[0], new RegExp(`^functions:alpha declared ${value} `));
    assert.equal(report.census_ready, false);
  }
  // Carrying it paused or retiring it are both consistent readings.
  for (const value of ['preserved_paused', 'retire', 'undecided']) {
    assert.deepEqual(checkCoverage(capabilities(), manifest({ functions: { alpha: value } }), evidence).contradicted_disposition, []);
  }
  // Only functions carry this evidence; a same-named entity is untouched.
  assert.deepEqual(checkCoverage(capabilities({ functions: [], entities: ['alpha'] }),
    manifest({ functions: {}, entities: { alpha: 'port' } }), evidence).contradicted_disposition, []);
});

test('a broker function is held to what the family can actually serve', () => {
  const reach = name => ({ entityReach: { alpha: name } });
  const entities = { entities: { Config: 'broker', Patient: 'port' } };
  const declare = extra => manifest({ functions: { alpha: 'broker' }, ...entities, ...extra });

  // Inside the family: every entity it touches is one the family serves.
  assert.deepEqual(checkCoverage(capabilities(), declare(),
    reach({ names: ['Config'], dynamic: false })).contradicted_disposition, []);

  // Outside it. This is the real shape of the finding: `getDashboardData` was
  // declared `broker` while reading every active patient.
  const outside = checkCoverage(capabilities(), declare(), reach({ names: ['Config', 'Patient'], dynamic: false }));
  assert.deepEqual(outside.contradicted_disposition,
    ['functions:alpha declared broker but reaches Patient, which the family does not serve']);
  assert.equal(outside.census_ready, false);

  // A computed key names a set nothing here can enumerate, so it can never be
  // shown to stay inside the family — and it is not excused by the names that
  // WERE found.
  assert.match(checkCoverage(capabilities(), declare(),
    reach({ names: ['Config'], dynamic: true })).contradicted_disposition[0], /indexes the entity namespace dynamically/);

  // The family serves entities. Touching none means something else is the
  // replacement, whatever it is.
  assert.deepEqual(checkCoverage(capabilities(), declare(), reach({ names: [], dynamic: false })).contradicted_disposition,
    ['functions:alpha declared broker but touches no entity the family could serve']);

  // Every other disposition is free of this: `port` is a reviewed contract per
  // capability, which is exactly what a function reaching a clinical table needs.
  for (const value of ['port', 'hub', 'preserved_paused', 'retire']) {
    assert.deepEqual(checkCoverage(capabilities(), manifest({ functions: { alpha: value }, ...entities }),
      reach({ names: ['Patient'], dynamic: false })).contradicted_disposition, []);
  }
  // A module nobody could read is skipped, as it is by the inert and paused checks.
  assert.deepEqual(checkCoverage(capabilities(), declare(), { entityReach: {} }).contradicted_disposition, []);
});

test('the entity reach of a module is read through every access form it uses', () => {
  const known = new Set(['Patient', 'Visit', 'Agency', 'Config']);
  const reach = (source) => entitiesTouched(source, known);
  // The plain form, which a first version of this found on its own.
  assert.deepEqual(reach('await base44.entities.Patient.filter({})'),
    { names: ['Patient'], dynamic: false, writes: [] });
  assert.deepEqual(reach('base44.asServiceRole.entities.Visit.list()'),
    { names: ['Visit'], dynamic: false, writes: [] });
  // Destructuring, which it did not. Aliasing a destructured name too.
  assert.deepEqual(reach('const { Patient, Agency: A } = base44.entities;'),
    { names: ['Agency', 'Patient'], dynamic: false, writes: [] });
  // Aliasing the NAMESPACE, which is how `getDashboardData` reads every active
  // patient while containing no occurrence of `entities.Patient`. A scan that
  // misses this reported six functions as staying inside the family when the
  // real number was zero.
  assert.deepEqual(reach('const sr = base44.asServiceRole.entities;\nawait sr.Patient.filter({});\nsr.Visit.list();'),
    { names: ['Patient', 'Visit'], dynamic: false, writes: [] });
  assert.deepEqual(reach('const e = base44.entities\ne.Config.list()'),
    { names: ['Config'], dynamic: false, writes: [] });
  // Dynamic access, through either the namespace or an alias of it.
  assert.equal(reach('base44.entities[name].filter({})').dynamic, true);
  assert.equal(reach('const sr = base44.entities;\nsr[name].list()').dynamic, true);
  // Names that are not entities do not become findings, and a module that
  // touches nothing says so rather than throwing.
  assert.deepEqual(reach('const sr = base44.entities;\nsr.Promise.resolve()'),
    { names: [], dynamic: false, writes: [] });
  assert.deepEqual(reach('await base44.integrations.Core.SendEmail({})'),
    { names: [], dynamic: false, writes: [] });
  for (const value of [null, undefined, 42, {}]) {
    assert.deepEqual(entitiesTouched(value, known), { names: [], dynamic: false, writes: [] });
  }
});

test('which entities a module WRITES is read separately from which it touches', () => {
  // Reading a table and writing one stopped being the same question when a
  // table could be readable and unwritable at once: `User` under D23, and
  // every `global` reference table, which was always so and was never
  // reported.
  const known = new Set(['Patient', 'Visit', 'User']);
  const reach = (source) => entitiesTouched(source, known);
  for (const operation of MUTATING) {
    assert.deepEqual(reach(`base44.entities.Patient.${operation}({})`).writes, ['Patient'], operation);
  }
  // Reading is not writing, however many times it is read.
  for (const operation of ['filter', 'list', 'get', 'findOne', 'count']) {
    assert.deepEqual(reach(`base44.entities.Patient.${operation}({})`).writes, [], operation);
  }
  // The write is found through every access form the names are, because it is
  // the name that is matched rather than the expression that produced it.
  assert.deepEqual(reach('const { User } = base44.entities;\nawait User.update(id, {});').writes, ['User']);
  assert.deepEqual(reach('const sr = base44.asServiceRole.entities;\nsr.Visit.create({});').writes, ['Visit']);
  // One module, two entities, one of them written.
  const mixed = reach('await base44.entities.Patient.filter({});\nawait base44.entities.User.update(id, {});');
  assert.deepEqual(mixed, { names: ['Patient', 'User'], dynamic: false, writes: ['User'] });
  // A name that is not an entity cannot become a write, and neither can a
  // method that merely shares a word with one.
  assert.deepEqual(reach('const rows = [];\nrows.update();\nawait base44.entities.Patient.list()').writes, []);
});

test('what the record store permits per entity is read from the policies it emits', () => {
  // It used to be inferred from the tenant path — "kind is `profile_claim`"
  // standing in for "has no policy" — which was true only while a profile
  // claim was the one thing that produced a table with none. D23 ends that,
  // and an inference that could not tell "no policy" from "read-only" would
  // have reported all 43 of `User`'s readers unblocked along with the 8 that
  // write it.
  const permits = discoverEntityPolicies(repository);
  assert.equal(Object.keys(permits).length, 156, 'every carried entity is accounted for');
  assert.deepEqual(discoverPolicylessEntities(repository), [], 'nothing is unreadable any more');
  const readOnly = Object.keys(permits).filter(entity => permits[entity].read && !permits[entity].write).sort();
  // The eight platform reference tables, plus the roster.
  assert.deepEqual(readOnly, ['AIModelConfiguration', 'CitationLibrary', 'ComplianceRule', 'MedicareComplianceRule',
    'MedicareGuideline', 'NewFeature', 'ProviderSettings', 'ServiceCode', 'User']);
  assert.deepEqual(permits.User, { read: true, write: false });
  assert.deepEqual(permits.Patient, { read: true, write: true });
  // A tree with no record store says nothing rather than guessing, because an
  // empty answer here would read as "everything is permitted".
  assert.deepEqual(discoverEntityPolicies(resolve(repository, 'services')), {});
});

test('a module that writes a read-only table is still blocked; one that only reads it is not', () => {
  const declare = () => manifest({ functions: { alpha: 'port' }, entities: { Kept: 'port', Reference: 'port' } });
  const permits = { Kept: { read: true, write: true }, Reference: { read: true, write: false } };
  const queue = (evidence) => {
    const report = checkCoverage(capabilities(), declare(),
      { portBlockers: { alpha: 'records_schema' }, entityPolicies: permits, ...evidence });
    return Object.entries(report.port_blockers).filter(([, names]) => names.length).map(([key]) => key);
  };
  const touch = (names, writes) => ({ entityReach: { alpha: { names, dynamic: false, writes } } });
  assert.deepEqual(queue(touch(['Reference'], [])), ['records_schema'], 'reading a reference table is fine');
  assert.deepEqual(queue(touch(['Reference'], ['Reference'])), ['entity_authorization'], 'writing one is not');
  assert.deepEqual(queue(touch(['Kept'], ['Kept'])), ['records_schema'], 'writing a writable table is fine');
  // The read-only refusal applies per entity: a module writing the writable
  // one and reading the reference one is not held by either.
  assert.deepEqual(queue(touch(['Kept', 'Reference'], ['Kept'])), ['records_schema']);
  assert.deepEqual(queue(touch(['Kept', 'Reference'], ['Kept', 'Reference'])), ['entity_authorization']);
  // Absent evidence changes nothing rather than blocking everything: a tool
  // that cannot see the policies must not invent a refusal.
  assert.deepEqual(Object.entries(checkCoverage(capabilities(), declare(),
    { portBlockers: { alpha: 'records_schema' }, ...touch(['Reference'], ['Reference']) }).port_blockers)
    .filter(([, names]) => names.length).map(([key]) => key), ['records_schema']);
});

test('a contradiction blocks the census even when owners accepted', () => {
  const report = checkCoverage(capabilities(), manifest({ review_state: 'accepted' }), { inertFunctions: ['alpha'] });
  assert.equal(report.coverage_complete, true);
  assert.equal(report.census_ready, false);
});

test('the committed census is settled, and says only that', () => {
  assert.equal(main(['--summary'], { repository, log: () => {} }), 0);
  const raw = readFileSync(resolve(repository, 'tools-transition-disposition.json'), 'utf8');
  const report = checkCoverage(discoverCapabilities(repository), parseManifest(raw), discoverEvidence(repository));
  // Pinned so a new capability left undecided, or a retirement with nowhere for
  // its rows, takes the census down visibly instead of passing unnoticed.
  assert.equal(report.coverage_complete, true);
  assert.equal(report.evidence_consistent, true);
  assert.equal(report.retention_settled, true);
  assert.deepEqual(report.undecided, []);
  assert.equal(report.owner_review_complete, true);
  assert.equal(report.census_ready, true);
  // A settled census is not a migration. This tool reads the repository and has
  // never contacted a hosted app, so neither of these can become true here.
  assert.equal(report.hosted_inventory_reconciled, false);
  assert.equal(report.migration_authorized, false);
});

test('a capability without a disposition is reported as missing', () => {
  const report = checkCoverage(capabilities({ functions: ['alpha', 'delta'] }), manifest());
  assert.deepEqual(report.missing_disposition, ['functions:delta']);
  assert.equal(report.coverage_complete, false);
});

test('a manifest entry for a removed capability is reported as unknown', () => {
  const report = checkCoverage(capabilities({ entities: [] }), manifest());
  assert.deepEqual(report.unknown_capability, ['entities:Beta']);
  assert.equal(report.coverage_complete, false);
});

test('undecided entries block the census even when coverage is complete', () => {
  const report = checkCoverage(capabilities(), manifest({ functions: { alpha: 'undecided' } }));
  assert.equal(report.coverage_complete, true);
  assert.deepEqual(report.undecided, ['functions:alpha']);
  assert.equal(report.census_ready, false);
});

test('the census is ready only when owners accepted and nothing is undecided', () => {
  assert.equal(checkCoverage(capabilities(), manifest()).census_ready, false);
  assert.equal(checkCoverage(capabilities(), manifest({ review_state: 'accepted' })).census_ready, true);
  assert.equal(checkCoverage(capabilities(), manifest({
    review_state: 'accepted', entities: { Beta: 'undecided' },
  })).census_ready, false);
  // Repository coverage never implies hosted reconciliation or permission.
  const report = checkCoverage(capabilities(), manifest({ review_state: 'accepted' }));
  assert.equal(report.hosted_inventory_reconciled, false);
  assert.equal(report.migration_authorized, false);
});

for (const [name, raw] of Object.entries({
  malformed: '{',
  array: '[]',
  wrongFormat: JSON.stringify(manifest({ format: 'other' })),
  wrongVersion: JSON.stringify(manifest({ version: FORMAT_VERSION + 1 })),
  previousVersion: JSON.stringify(manifest({ version: FORMAT_VERSION - 1 })),
  unknownField: JSON.stringify({ ...manifest(), extra: true }),
  invalidReviewState: JSON.stringify(manifest({ review_state: 'signed' })),
  invalidDisposition: JSON.stringify(manifest({ functions: { alpha: 'maybe' } })),
  familyNotObject: JSON.stringify(manifest({ entities: [] })),
  retentionMissing: JSON.stringify((({ retention, ...rest }) => rest)(manifest())),
  retentionNotObject: JSON.stringify(manifest({ retention: [] })),
  retentionEntryNotObject: JSON.stringify(manifest({ retention: { Beta: 6 } })),
  retentionUnknownBasis: JSON.stringify(manifest({ retention: { Beta: { basis: 'forever', years: 6 } } })),
  retentionNegativeYears: JSON.stringify(manifest({ retention: { Beta: { basis: 'archive', years: -1 } } })),
  retentionFractionalYears: JSON.stringify(manifest({ retention: { Beta: { basis: 'archive', years: 6.5 } } })),
  retentionArchiveWithoutTime: JSON.stringify(manifest({ retention: { Beta: { basis: 'archive', years: 0 } } })),
  retentionYearsWithoutArchive: JSON.stringify(manifest({ retention: { Beta: { basis: 'none', years: 6 } } })),
  retentionExternalWithoutSystem: JSON.stringify(manifest({ retention: { Beta: { basis: 'external_system_of_record', years: 0 } } })),
  retentionExternalBlankSystem: JSON.stringify(manifest({ retention: { Beta: { basis: 'external_system_of_record', years: 0, system: '  ' } } })),
})) {
  test(`manifest rejects ${name}`, () => assert.throws(() => parseManifest(raw)));
}

test('what blocks a port is read from the module, not from a status note', () => {
  // Precedence runs from the most binding blocker to the least: a function that
  // both reads rows and renders a PDF cannot be written until the rows exist.
  assert.deepEqual([...PORT_BLOCKERS], ['entity_not_carried', 'entity_authorization', 'patient_access_model',
    'records_schema', 'files', 'ported_function', 'core_integration', 'pdf_rendering', 'external_secret', 'none']);
  // The first two are not properties of the module, so `classifyPortBlocker`
  // cannot see them: they depend on the dispositions of the entities it reads.
  // They are applied over its verdict in `checkCoverage`, and only ever over
  // `records_schema` — reaching a file or a Core integration stays true
  // whatever the rows turn out to be.
  assert.equal(classifyPortBlocker("await base44.entities.Patient.filter({})"), 'records_schema');
  assert.equal(classifyPortBlocker("base44.asServiceRole.entities.Visit.list()"), 'records_schema');
  // Dynamic access reads rows exactly as the dotted form does.
  assert.equal(classifyPortBlocker("await base44.entities[name].filter({})"), 'records_schema');
  // A Core integration is NOT a record blocker. This asserted 'records_schema'
  // until the functions were read: all twelve of them touch no entity at all,
  // so the queue was holding them behind a store they never use. Their blocker
  // is the integration runtime's brokered path, which is deployed and paused.
  assert.equal(classifyPortBlocker("await base44.integrations.Core.InvokeLLM({})"), 'core_integration');
  // A handler bound to the old file layer. The shared SSRF guard only admits
  // Base44's own storage hosts, so porting one verbatim would carry a Base44
  // dependency into the service the exit exists to remove.
  assert.equal(classifyPortBlocker("InvokeLLM({ file_urls: [fileUrl] })"), 'files');
  assert.equal(classifyPortBlocker("if (!isSafeFetchUrl(url)) return;"), 'files');
  assert.equal(classifyPortBlocker("await base44.integrations.Core.UploadFile({})"), 'files');
  // Precedence: a handler that reads rows AND a file waits on the store first.
  assert.equal(classifyPortBlocker("base44.entities.Patient.get(id)\nUploadFile({})"), 'records_schema');
  assert.equal(classifyPortBlocker("await base44.functions.manageAuthorizedReferral({})"), 'ported_function');
  // Precedence: reading a row outranks calling an integration.
  assert.equal(classifyPortBlocker("base44.entities.Patient.get(id)\nbase44.integrations.Core.InvokeLLM({})"),
    'records_schema');
  assert.equal(classifyPortBlocker("import { jsPDF } from 'npm:jspdf@2.5.2';"), 'pdf_rendering');
  assert.equal(classifyPortBlocker('const key = Deno.env.get("OPENAI_API_KEY");'), 'external_secret');
  assert.equal(classifyPortBlocker("const user = await base44.auth.me();"), 'none');
  // Precedence, stated as a case rather than left to reading order.
  assert.equal(classifyPortBlocker("import { jsPDF } from 'npm:jspdf@2.5.2';\nbase44.entities.Patient.get(id)"), 'records_schema');
  // Anything unreadable is treated as the most blocking, never as portable.
  assert.equal(classifyPortBlocker(null), 'records_schema');
});

test('a record blocker is refined by what the module actually reads', () => {
  const declare = extra => manifest({ functions: { alpha: 'port' },
    entities: { Kept: 'port', Gone: 'retire', Elsewhere: 'hub', Claim: 'port' }, ...extra });
  const queue = (evidence) => {
    const report = checkCoverage(capabilities(), declare(),
      { portBlockers: { alpha: 'records_schema' }, policylessEntities: ['Claim'], ...evidence });
    return Object.entries(report.port_blockers).filter(([, names]) => names.length).map(([key]) => key);
  };
  // An entity that gets no table here: the store arriving changes nothing.
  assert.deepEqual(queue({ entityReach: { alpha: { names: ['Kept', 'Gone'], dynamic: false } } }),
    ['entity_not_carried']);
  assert.deepEqual(queue({ entityReach: { alpha: { names: ['Elsewhere'], dynamic: false } } }),
    ['entity_not_carried']);
  // A carried entity with forced RLS and no policy — `User` in the real
  // manifest, which D14 left unreachable until a decision says how it is read.
  assert.deepEqual(queue({ entityReach: { alpha: { names: ['Kept', 'Claim'], dynamic: false } } }),
    ['entity_authorization']);
  // Not carried outranks unreadable: whether the capability survives at all
  // comes before how a table is read.
  assert.deepEqual(queue({ entityReach: { alpha: { names: ['Gone', 'Claim'], dynamic: false } } }),
    ['entity_not_carried']);
  // Everything carried and readable is still the store's to provide.
  assert.deepEqual(queue({ entityReach: { alpha: { names: ['Kept'], dynamic: false } } }), ['records_schema']);
  // A computed key names a set nothing can enumerate, so nothing is claimed
  // about it, and a module nobody read is left where the source put it.
  assert.deepEqual(queue({ entityReach: { alpha: { names: ['Gone'], dynamic: true } } }), ['records_schema']);
  assert.deepEqual(queue({ entityReach: {} }), ['records_schema']);

  // Only a `records_schema` verdict is ever refined. A handler that reads a
  // retired entity AND a file still waits on the file layer, because that stays
  // true whatever happens to the rows.
  for (const blocker of ['files', 'core_integration', 'external_secret', 'ported_function']) {
    const report = checkCoverage(capabilities(), declare(), {
      portBlockers: { alpha: blocker }, policylessEntities: ['Claim'],
      entityReach: { alpha: { names: ['Gone', 'Claim'], dynamic: false } },
    });
    assert.deepEqual(report.port_blockers[blocker], ['alpha'], `${blocker} must not be overridden`);
  }
});

test('a care-team dependency blocks until BOTH halves of D24 exist', () => {
  // D24 named two things and said neither is optional, and the reason is the
  // one that would not have been noticed: moving authority to
  // `pennsync_private.assignment` without carrying today's rows across means
  // every clinician loses access to their own patients at cutover. So the
  // queue asks for both, by looking at the files rather than asserting.
  const declare = () => manifest({ functions: { alpha: 'port' }, entities: { Kept: 'port' } });
  const queue = (chartScope) => {
    const report = checkCoverage(capabilities(), declare(),
      { portBlockers: { alpha: 'records_schema' }, careTeamDependents: ['alpha'], chartScope,
        entityReach: { alpha: { names: ['Kept'], dynamic: false, writes: [] } } });
    return Object.entries(report.port_blockers).filter(([, names]) => names.length).map(([key]) => key);
  };
  assert.deepEqual(queue(false), ['patient_access_model'], 'half of D24 is not D24');
  assert.deepEqual(queue(undefined), ['patient_access_model'], 'absent evidence is not a built prerequisite');
  assert.deepEqual(queue(true), ['records_schema'], 'with both, it is a port to write');
  // And the committed tree really has both, or the distribution above proves
  // nothing. Each is read from the file that provides it.
  assert.equal(discoverChartScope(repository), true);
  assert.equal(discoverChartScope(resolve(repository, 'services')), false);
  assert.match(readFileSync(resolve(repository, CHART_SCOPE_EVIDENCE.helper), 'utf8'),
    /caller_assigned_patients/);
  assert.match(readFileSync(resolve(repository, CHART_SCOPE_EVIDENCE.backfill), 'utf8'), /planBackfill/);
});

test('a retired log table blocks until there is somewhere to audit to', () => {
  // D25. The three log tables are dispositioned `retire`, which decided where
  // their EXISTING rows go and never whether the product keeps auditing. Read
  // the first way, a capability that writes one waits forever on a table that
  // is not coming; read the second, it is an ordinary port. This is the whole
  // difference, and the tool answers it by looking for the migration rather
  // than by asserting it.
  const declare = () => manifest({ functions: { alpha: 'port' },
    entities: { Kept: 'port', UserActivity: 'retire', SecurityLog: 'retire', SystemLog: 'retire', Gone: 'retire' } });
  const queue = (evidence) => {
    const report = checkCoverage(capabilities(), declare(),
      { portBlockers: { alpha: 'records_schema' }, ...evidence });
    return Object.entries(report.port_blockers).filter(([, names]) => names.length).map(([key]) => key);
  };
  for (const entity of AUDITED_ENTITIES) {
    assert.deepEqual(queue({ activityTrail: true, entityReach: { alpha: { names: ['Kept', entity], dynamic: false } } }),
      ['records_schema'], `${entity} has a successor`);
    assert.deepEqual(queue({ activityTrail: false, entityReach: { alpha: { names: ['Kept', entity], dynamic: false } } }),
      ['entity_not_carried'], `${entity} has nowhere to go without the trail`);
  }
  // Absent evidence is the same as no trail: a tool that assumed one would
  // report the queue as shorter than the tree it is reading can support.
  assert.deepEqual(queue({ entityReach: { alpha: { names: ['UserActivity'], dynamic: false } } }),
    ['entity_not_carried']);
  // The exemption is per entity, not per capability. A module that writes an
  // audit row AND reads a retired domain table still has nowhere to read from.
  assert.deepEqual(queue({ activityTrail: true,
    entityReach: { alpha: { names: ['UserActivity', 'Gone'], dynamic: false } } }), ['entity_not_carried']);
  // And it is tied to `retire`, not to the name. An entity going to the hub has
  // a different destination and a paused one has none, so neither is answered
  // by this table existing even under one of the three names.
  for (const disposition of ['hub', 'preserved_paused']) {
    const report = checkCoverage(capabilities(), manifest({ functions: { alpha: 'port' },
      entities: { Kept: 'port', UserActivity: disposition } }),
    { portBlockers: { alpha: 'records_schema' }, activityTrail: true,
      entityReach: { alpha: { names: ['UserActivity'], dynamic: false } } });
    assert.deepEqual(report.port_blockers.entity_not_carried, ['alpha'], `${disposition} is not the trail`);
  }
  // The committed manifest does disposition all three `retire`, which is what
  // makes the exemption above apply to anything at all.
  const committed = parseManifest(readFileSync(resolve(repository, 'tools-transition-disposition.json'), 'utf8'));
  for (const entity of AUDITED_ENTITIES) assert.equal(committed.entities[entity], 'retire', entity);
  // And it is the repository that answers it. The committed tree has the
  // migration; a tree without it gets the stricter verdict from the same code.
  assert.equal(discoverActivityTrail(repository), true);
  assert.equal(discoverActivityTrail(resolve(repository, 'services')), false);
  assert.ok(readFileSync(resolve(repository, ACTIVITY_TRAIL_MIGRATION), 'utf8').includes('activity_audit'));
});

test('a capability is held by the care-team question whatever its entities are', () => {
  const declare = () => manifest({ functions: { alpha: 'port' }, entities: { Kept: 'port', Gone: 'retire' } });
  // `chartScope: false` is the tree D24 was decided in and not yet built in.
  // With both halves present the bucket empties, which the case below proves
  // separately; here it stays false so the ranking is what is under test.
  const queue = (evidence) => {
    const report = checkCoverage(capabilities(), declare(),
      { portBlockers: { alpha: 'records_schema' }, careTeamDependents: ['alpha'], ...evidence });
    return Object.entries(report.port_blockers).filter(([, names]) => names.length).map(([key]) => key);
  };
  assert.deepEqual(queue({ entityReach: { alpha: { names: ['Kept'], dynamic: false } } }), ['patient_access_model']);
  // Unlike the two entity-disposition refinements, this one survives a computed
  // key: it is read from the source text, not from the entity set.
  assert.deepEqual(queue({ entityReach: { alpha: { names: ['Kept'], dynamic: true } } }), ['patient_access_model']);
  assert.deepEqual(queue({ entityReach: {} }), ['patient_access_model']);
  // An entity that gets no table still outranks it: whether the capability
  // survives comes before who may read a patient.
  assert.deepEqual(queue({ entityReach: { alpha: { names: ['Gone'], dynamic: false } } }), ['entity_not_carried']);
  // And a capability with no care-team dependency is untouched by it.
  const clean = checkCoverage(capabilities(), declare(),
    { portBlockers: { alpha: 'records_schema' }, careTeamDependents: [],
      entityReach: { alpha: { names: ['Kept'], dynamic: false } } });
  assert.deepEqual(clean.port_blockers.records_schema, ['alpha']);
});

test('the port queue is work that cannot start yet, and says why', () => {
  // Reading the census as "86 ports awaiting review" would send someone to work
  // nothing in the repository can support. Exactly one of them was writable
  // without something the transition has not built, and it has been written.
  //
  // `records_schema` moves by work now rather than by reclassification: D26
  // ported `listAuthorizedPatients` and `getAuthorizedPatient`, the first two
  // capabilities that read clinical rows, and the visit and document pairs
  // followed on the same machinery. Then D28 found what only a WRITE could
  // show and `createAuthorizedPatient` followed it.
  // Then `updateAuthorizedPatient`, the first ported MUTATION, on the same
  // fenced-declaration machinery the reads use, the visit pair after it, and
  // the scoped alert pair — the first capabilities whose OWN authorization was
  // the `assigned_nurses` representation D21 and D24 threw out.
  // 76 → 74 → 72 → 70 → 69 → 68 → 67 → 66 → 64, and 11 → 23 written.
  const report = checkCoverage(
    discoverCapabilities(repository),
    parseManifest(readFileSync(resolve(repository, 'tools-transition-disposition.json'), 'utf8')),
    discoverEvidence(repository),
  );
  const counts = Object.fromEntries(Object.entries(report.port_blockers).map(([key, names]) => [key, names.length]));
  assert.deepEqual(counts, { entity_not_carried: 7, entity_authorization: 10, patient_access_model: 0,
    records_schema: 64, files: 4, ported_function: 1, core_integration: 1, pdf_rendering: 0,
    external_secret: 1, none: 23 });
  // The correction this distribution records: `records_schema` had come to mean
  // "touches an entity", and only 25 of those 94 were ever waiting on the
  // record store. Thirty-four read an entity that gets no table here at all,
  // and thirty-four read `User`, which carries forced RLS and no policy because
  // D14 deliberately left how it may be read undecided. Neither is helped by
  // the store existing.
  //
  // Then D25 halved the first of those. Of the 34, twenty-seven were held by a
  // retired log table and nothing else, and `retire` had decided where those
  // rows GO, never whether the product keeps auditing. With a trail to write
  // to they redistribute across the three buckets behind them, which is why
  // those grew while the total did not move. Seven remain, and each reads a
  // table from a domain that is actually going away rather than a log.
  assert.deepEqual(report.port_blockers.entity_not_carried,
    ['analyzeNurseDeficits', 'analyzeRealTimePerformance', 'distributePolicyAcknowledgment', 'generateAIReport',
      'getCommsDashboard', 'offboardUser', 'sendExpirationNotifications'],
    'only a capability reading a domain table that is going away belongs here');
  // `acceptAiContentAgreement` writes `UserActivity` and reads nothing else
  // uncarried. It sat here for exactly as long as retiring the table was read
  // as retiring the obligation.
  assert.ok(!report.port_blockers.entity_not_carried.includes('acceptAiContentAgreement'));
  // D23 then emptied most of `entity_authorization` the same way. The bucket
  // meant "reads `User`, which has forced RLS and no policy"; the store now
  // gives `User` a read policy keyed on the authority store's roster, so what
  // is left is only what a read policy does not help:
  //
  // - the 8 that UPDATE a profile, which D23 deliberately leaves open. The
  //   roster policy is read-only, so nothing decided that question by
  //   accident;
  // - two that write `MedicareGuideline`, a `global` reference table no tenant
  //   surface may write. That was always true and was never reported, because
  //   the classifier could not tell reading a table from writing one.
  assert.deepEqual(report.port_blockers.entity_authorization,
    ['autoApproveInvitedUser', 'autoEndDutyDay', 'calculateDataQualityScores', 'enforceDataCompleteness',
      'enforceStaffRoleIntegrity', 'fetchMedicareGuideline', 'scheduledGuidelineSync', 'setNurseDutyStatus',
      'userManagement', 'userManagementV2']);
  // Sixty-four. That is how many of the hundred can be written today, and the
  // number is still the point: `records_schema=94` said the record store was
  // what stood in front of the queue, and everything since has been finding
  // out what actually did. Nothing in the queue waits on a decision now, and
  // nothing waits on a shared prerequisite either — so from here the bucket
  // only falls by ports being written, which is what took it off 76.
  assert.equal(report.port_blockers.records_schema.length, 64);
  // The twelve that left it are the ported capabilities that touch clinical rows
  // — D26's patient pair, then the visit and document pairs on the same
  // machinery, then the patient write and mutation, then the visit pair that
  // carries the SmartNote save — so they are also the proof that the D19
  // pattern carries PHI and not only configuration. `updateAuthorizedVisit`
  // is the first that is only PARTLY ported: four of its nine actions, with
  // the other five refused by name and reason. The
  // document pair additionally shows that `files` was never the blocker there:
  // no purpose discloses a locator.
  for (const name of ['listAuthorizedPatients', 'getAuthorizedPatient',
    'listAuthorizedVisits', 'getAuthorizedVisit',
    'listAuthorizedDocuments', 'getAuthorizedDocument', 'createAuthorizedPatient',
    'updateAuthorizedPatient', 'createAuthorizedVisit', 'updateAuthorizedVisit',
    'getScopedPatientAlerts', 'updateScopedPatientAlert']) {
    assert.ok(report.port_blockers.none.includes(name), `${name} is ported`);
    assert.ok(!report.port_blockers.records_schema.includes(name), name);
  }
  // D24's bucket is empty because both halves exist — not because the
  // dependency went away. The capabilities that authorize on care-team
  // membership are answerable now, and two of them have since been written:
  // the scoped alert pair, whose OWN authorization was the `assigned_nurses`
  // representation D21 and D24 threw out. `appendPatientNoteHistory` is the
  // same shape and is still waiting.
  assert.deepEqual(report.port_blockers.patient_access_model, []);
  assert.ok(report.port_blockers.records_schema.includes('appendPatientNoteHistory'));
  for (const name of ['getScopedPatientAlerts', 'updateScopedPatientAlert']) {
    assert.ok(report.port_blockers.none.includes(name), `${name} is ported`);
  }
  // Twelve functions were counted against the record store until they were
  // read. Every one calls a Core integration and touches no entity row, so what
  // they waited on was the integration runtime's brokered path — already
  // deployed, and paused — not a store that does not exist. All twelve left:
  // five by being written, two by being reclassified paused, four by being
  // file-bound, and `generateUserGuidePDF` by being ported.
  //
  // The one here now arrived from the other direction. `sendWelcomeEmail` was
  // dispositioned `broker` and touches no entity at all — it sends mail through
  // `Core.SendEmail`, which no entity family can be the replacement for. The
  // function-side ceiling caught that, and `SendEmail` is not in the runtime's
  // brokered set, so it is a real blocker rather than a bookkeeping artefact.
  assert.deepEqual(report.port_blockers.core_integration, ['sendWelcomeEmail']);
  // Named, because porting one of these verbatim would carry Base44's storage
  // host into the service, and the `cmfile:` handles that replace those URLs do
  // not exist yet. They wait on the file layer, not on the runtime.
  assert.deepEqual(report.port_blockers.files, ['extractClinicalDocument', 'extractPatientDataFromDocument',
    'generateDynamicCoverSheet', 'splitReferralPDF']);
  assert.deepEqual(report.port_blockers.none,
    ['analyzeReferral', 'analyzeReferralIntake', 'analyzeReferralPriority',
      'createAuthorizedPatient', 'createAuthorizedVisit', 'generateBagTechniquePDF',
      'generateReferralTasks', 'generateSmartNoteGuide',
      'generateUserGuidePDF', 'generateUserManual',
      'getAuthorizedDocument', 'getAuthorizedPatient', 'getAuthorizedVisit',
      'getScopedPatientAlerts',
      'listAuthorizedDocuments', 'listAuthorizedPatients', 'listAuthorizedVisits',
      'listPolicyLibrary', 'matchPatientWithAI', 'updateAuthorizedPatient',
      'updateAuthorizedVisit', 'updateScopedPatientAlert', 'validatePatientData'],
    'the set of written ports changed');
  // `listPolicyLibrary` is the first of these to read an entity row. Everything
  // before it either computed an answer, rendered a document or asked a model,
  // so the records bucket had never moved by a port being written — only by a
  // function being reclassified. It moves now.
  assert.ok(report.port_blockers.none.includes('listPolicyLibrary'));
  assert.deepEqual(report.port_blockers.ported_function, ['extractReferralDataForSmartNote']);
  // All three emptied this bucket once the service adopted a PDF library and a
  // call-sequence parity test; nothing is waiting on a rendering decision now.
  assert.deepEqual(report.port_blockers.pdf_rendering, []);
  assert.deepEqual(report.port_blockers.external_secret, ['transcribeAndGenerateSOAPNote']);
  // The sum is every function dispositioned `port`, so nothing falls out of the
  // queue by being unclassifiable.
  assert.equal(Object.values(counts).reduce((total, value) => total + value, 0), report.families.functions.counts.port);
});

test('what counts as already ported is read from the service, not maintained here', async () => {
  // The parse would be worth nothing if it could silently stop matching the
  // registry it reads, so it is checked against the module's own export.
  const { HANDLER_NAMES } = await import('./services/pennsync-api/handlers.mjs');
  const parsed = discoverPortedFunctions(repository);
  assert.deepEqual(parsed, [...HANDLER_NAMES].sort(), 'the registry parse drifted from the registry');
  assert.ok(parsed.length >= 2, 'the ported registry should not be empty');
  // A missing service is not an error: the classifier just reports everything
  // as blocked, which is the safe direction.
  assert.deepEqual(discoverPortedFunctions(resolve(repository, 'src')), []);
});

test('the port queue never decides the census', () => {
  // A port becoming possible, or being written, must not fail the gate. It moves
  // a count here and the plan's prose with it, nothing else.
  const evidence = { inertFunctions: [], portBlockers: { alpha: 'none' } };
  const ready = checkCoverage(capabilities(), manifest({ review_state: 'accepted' }), evidence);
  assert.equal(ready.census_ready, true);
  assert.deepEqual(ready.port_blockers.none, ['alpha']);
  const blocked = checkCoverage(capabilities(), manifest({ review_state: 'accepted' }),
    { inertFunctions: [], portBlockers: { alpha: 'records_schema' } });
  assert.equal(blocked.census_ready, true);
  assert.deepEqual(blocked.port_blockers.records_schema, ['alpha']);
  // Having been written outranks whatever its Base44 original still imports:
  // nothing blocks a port that has happened.
  const written = checkCoverage(capabilities(), manifest({ review_state: 'accepted' }),
    { inertFunctions: [], portBlockers: { alpha: 'records_schema' }, portedFunctions: ['alpha'] });
  assert.deepEqual(written.port_blockers.none, ['alpha']);
  assert.deepEqual(written.port_blockers.records_schema, []);
  // A function the evidence says nothing about is queued as the most blocking
  // rather than silently counted as ready to write.
  const unknown = checkCoverage(capabilities(), manifest({ review_state: 'accepted' }), { inertFunctions: [] });
  assert.deepEqual(unknown.port_blockers.records_schema, ['alpha']);
  // And only `port` is queued: a brokered or paused function is not waiting on this.
  const brokered = checkCoverage(capabilities(), manifest({ functions: { alpha: 'broker' } }), evidence);
  assert.deepEqual(Object.values(brokered.port_blockers).flat(), []);
});

test('every function the classifier calls portable really needs nothing but authority', () => {
  const blockers = discoverPortBlockers(repository);
  for (const [name, blocker] of Object.entries(blockers)) {
    if (blocker !== 'none') continue;
    const source = readFileSync(resolve(repository, 'base44/functions', name, 'entry.ts'), 'utf8');
    assert.doesNotMatch(source, /\.\s*entities\s*\.|asServiceRole|\.\s*integrations\s*\.|\bbase44\s*\.\s*functions\b/,
      `${name} reaches data but is queued as portable`);
    assert.doesNotMatch(source, /\bDeno\s*\.\s*env\s*\.\s*get\b/, `${name} reads a secret but is queued as portable`);
  }
});

test('accepted dispositions are the exact reviewed set', () => {
  assert.deepEqual([...DISPOSITIONS].sort(), ['broker', 'hub', 'port', 'preserved_paused', 'retire', 'undecided']);
  for (const value of DISPOSITIONS) assert.doesNotThrow(() => parseManifest(JSON.stringify(manifest({ functions: { alpha: value } }))));
});

test('discovered integrations include every adapter the external runtime implements', () => {
  const discovered = discoverIntegrations(repository);
  for (const operation of ['InvokeLLM', 'ExtractDataFromUploadedFile', 'SendEmail',
    'UploadFile', 'UploadPrivateFile', 'CreateFileSignedUrl']) {
    assert.ok(discovered.includes(operation), `missing ${operation}`);
  }
  // Discovered from source, not a hand-kept list.
  assert.ok(discovered.includes('GenerateImage'));
});

test('the command line refuses unknown arguments and an unavailable manifest', () => {
  const lines = [];
  assert.equal(main(['--apply'], { repository, log: value => lines.push(value) }), 2);
  assert.equal(JSON.parse(lines[0]).error, 'INVALID_ARGUMENTS');
  lines.length = 0;
  assert.equal(main([], { repository: resolve(repository, 'src'), log: value => lines.push(value) }), 2);
  assert.ok(JSON.parse(lines[0]).error);
});

test('a capability switched off at source cannot be carried as portable work', () => {
  const paused = `import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
const FEATURE_ENABLED = false;
Deno.serve(async (req) => {
  if (!FEATURE_ENABLED) {
    return Response.json({ success: false, available: false, reason: 'feature_paused' }, { status: 409 });
  }
  const base44 = createClientFromRequest(req);
  return Response.json(await base44.entities.Patient.list());
});`;
  assert.equal(isPausedFunction(paused), true);
  // The flag is a const pinned false, so `if (!FLAG)` is always taken. That is
  // why this needs no heuristic: proving the branch returns proves every caller
  // is refused.
  assert.equal(isPausedFunction(paused.replace('= false', '= true')), false);
  // A guard that does not answer leaves the handler live.
  assert.equal(isPausedFunction(paused.replace(/return Response\.json\([^;]*;/, 'console.warn("paused");')), false);
  // A flag nothing branches on is not a pause.
  assert.equal(isPausedFunction("const FEATURE_ENABLED = false;\nDeno.serve(() => Response.json({}));"), false);
  assert.equal(isPausedFunction(null), false);

  // Separate from the inert check on purpose: a paused module still imports and
  // awaits, it simply never reaches any of it. Seven paused capabilities sat in
  // the port queue as writable work because the inert check could not see them.
  assert.equal(isInertFunction(paused), false);
});

test('every capability paused at source is carried paused rather than queued', () => {
  const pausedNames = discoverPausedFunctions(repository);
  const declared = parseManifest(readFileSync(resolve(repository, 'tools-transition-disposition.json'), 'utf8')).functions;
  assert.ok(pausedNames.length >= 18, `expected the paused set to be substantial, saw ${pausedNames.length}`);
  const carried = pausedNames.filter(name => ACTIVE_DISPOSITIONS.includes(declared[name]));
  assert.deepEqual(carried, [],
    'a paused handler declared port, broker or hub claims work that cannot be written');
});

test('the contradiction is reported rather than tolerated', () => {
  const manifest = parseManifest(readFileSync(resolve(repository, 'tools-transition-disposition.json'), 'utf8'));
  const [victim] = discoverPausedFunctions(repository);
  const drifted = { ...manifest, functions: { ...manifest.functions, [victim]: 'port' } };
  const report = checkCoverage(discoverCapabilities(repository), drifted, discoverEvidence(repository));
  assert.ok(report.contradicted_disposition.some(entry => entry.includes(victim) && entry.includes('paused at source')),
    `${victim} declared port should be contradicted`);
});
