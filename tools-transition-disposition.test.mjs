import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACTIVE_DISPOSITIONS, ACTIVITY_TRAIL_MIGRATION, AUDITED_ENTITIES, DISPOSITIONS, FORMAT, FORMAT_VERSION,
  CHART_SCOPE_EVIDENCE, MUTATING, PORT_BLOCKERS, RETENTION_BASES, checkCoverage, classifyPortBlocker,
  discoverActivityTrail, discoverChartScope,
  discoverCapabilities, discoverEntityPolicies, discoverEvidence, discoverInertFunctions, discoverIntegrations,
  discoverPausedFunctions, discoverPolicylessEntities, discoverPortBlockers, discoverPortedFunctions,
  classifyWithoutEntities, discoverEntityFreeBlockers,
  entitiesTouched, isInertFunction, isPausedFunction, isRefusingHandler, main, parseManifest,
  discoverClaimsOnlyFunctions, TRUSTED_CLAIMS_FENCE,
  invokedFunctions, classifyWithoutInvocations, discoverInvocationFreeBlockers,
  portQueueLine,
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

test('a handler that refuses from its first statement is paused, whatever gates it', () => {
  // The second pause shape, and the reason it needed finding: the flag check
  // looks for `const FLAG = false`, and nine modules here pause with no flag
  // at all — the refusal is simply the first statement of the handler, with
  // the real body unreachable below it. Six of them were carried `port` and
  // counted as writable work until this was measured.
  const paused = "Deno.serve(async (req) => {\n"
    + "  // SECURITY CONTAINMENT: keep the legacy bulk Patient writer unreachable.\n"
    + "  return Response.json({ error: 'paused' }, { status: 503 });\n"
    + "  try { const base44 = createClientFromRequest(req); } catch {}\n});";
  assert.equal(isRefusingHandler(paused), true);
  // A block comment says why just as often as a line comment does.
  assert.equal(isRefusingHandler('Deno.serve(async (req) => {\n/* paused */\nreturn x;\n});'), true);
  // And everything else is live. A guard, an assignment or an await FIRST
  // means some caller gets through, so the shape errs toward calling a module
  // live exactly as the flag check does.
  assert.equal(isRefusingHandler('Deno.serve(async (req) => { if (!ok) return deny; return run(); });'), false);
  assert.equal(isRefusingHandler('Deno.serve(async (req) => { const body = await req.json(); return run(body); });'), false);
  assert.equal(isRefusingHandler('Deno.serve(async (req) => { await audit(req); return deny; });'), false);
  // An expression-bodied handler has no first statement to inspect; that is
  // `isInertFunction`'s question, not this one's.
  assert.equal(isRefusingHandler('Deno.serve(req => handle(req, client));'), false);
  assert.equal(isRefusingHandler(null), false);
  // The six this found are carried paused now, and the gate refuses any of
  // them being called active again.
  const declared = parseManifest(readFileSync(
    resolve(repository, 'tools-transition-disposition.json'), 'utf8')).functions;
  const paused_names = discoverPausedFunctions(repository);
  for (const name of ['calculateDataQualityScores', 'enforceDataCompleteness',
    'monitorClinicalDataForCarePlanUpdates', 'predictPatientRisks',
    'predictiveRiskAnalysis', 'processDischargeReport']) {
    assert.ok(paused_names.includes(name), `${name} should be detected as paused`);
    assert.equal(ACTIVE_DISPOSITIONS.includes(declared[name]), false,
      `${name} is declared ${declared[name]} but refuses every caller`);
  }
});

test('a module whose only entity is the retired trail is re-classified by what else it needs', () => {
  // `classifyPortBlocker` answers with the first thing it finds and entities
  // come first, which is right while the record store is the question. It
  // stops being right for a module whose only entity is one of D25's three
  // retired log tables: the trail IS that module's record half, already built.
  const withFile = "base44.asServiceRole.entities.UserActivity.create({});\nUploadFile({ file });";
  assert.equal(classifyPortBlocker(withFile), 'records_schema');
  assert.equal(classifyWithoutEntities(withFile), 'files');
  const withKey = "await base44.asServiceRole.entities.UserActivity.create({});\n"
    + "const k = Deno.env.get('OPENAI_API_KEY');";
  assert.equal(classifyWithoutEntities(withKey), 'external_secret');
  // Masking is not reordering. A module that reads a CHART and uploads a file
  // waits on the chart first, and this leaves that untouched — the refinement
  // only consults the entity-free verdict when every entity is an audited one.
  const withChart = "base44.entities.Patient.get(id);\nUploadFile({ file });";
  assert.equal(classifyPortBlocker(withChart), 'records_schema');
  // A module with nothing else to wait on stays where it was.
  assert.equal(classifyWithoutEntities('base44.entities.UserActivity.create({})'), 'none');
  assert.equal(classifyWithoutEntities(null), 'records_schema');
  // The discovery reads every module, so the evidence and the classifier
  // cannot drift apart.
  const entityFree = discoverEntityFreeBlockers(repository);
  assert.equal(entityFree.transcribeAudioWithWhisper, 'external_secret');
  assert.equal(entityFree.mergePDFs, 'files');
  // The verdict is about the MODULE, so it still reads the handout's send.
  // What took the handout out of that bucket is D81's port, not a change here:
  // a written capability is `none` whatever its original reaches.
  assert.equal(entityFree.generatePatientHandout, 'core_integration');
  // And the four it actually found are in the buckets that describe them.
  const report = checkCoverage(
    discoverCapabilities(repository),
    parseManifest(readFileSync(resolve(repository, 'tools-transition-disposition.json'), 'utf8')),
    discoverEvidence(repository),
  );
  for (const [name, blocker] of [['mergePDFs', 'files'], ['reorderDeletePDFPages', 'files'],
    ['generatePatientHandout', 'none'],
    ['transcribeAudioWithWhisper', 'external_secret']]) {
    assert.ok(report.port_blockers[blocker].includes(name),
      `${name} should wait on ${blocker}`);
    assert.equal(report.port_blockers.records_schema.includes(name), false);
  }
});

test('the pages carrying the port queue carry what the tool measures', () => {
  // D79 fixed two stale bucket descriptions with assertions rather than better
  // prose, and the prose about the buckets then went stale the same way: the
  // page said "the `none` bucket has nothing startable left: it is 73" while
  // D84 had deliberately moved three capabilities into `records_schema`, and
  // its parenthetical still listed `entity_not_carried` 7 and
  // `core_integration` 2, both of which are 0. Nothing failed, because nothing
  // compared the page with the tool. A reader acting on that sentence would
  // have concluded the queue was exhausted while three ports waited.
  const report = checkCoverage(
    discoverCapabilities(repository),
    parseManifest(readFileSync(resolve(repository, 'tools-transition-disposition.json'), 'utf8')),
    discoverEvidence(repository),
  );
  const line = portQueueLine(report);

  // The go-live plan restates this queue for a reader deciding where the
  // finish line is, and #250 pinned AGENTS.md while leaving that page
  // unguarded: on 2026-09-23 it still read `records_schema=3 ... none=75`
  // against a measured `none=78` with `records_schema` empty, so it told a
  // reader three ports were waiting that had all been written. Both pages are
  // held to the one line now.
  for (const path of ['AGENTS.md', 'docs/RAILWAY_GO_LIVE_PLAN_2026-09-21.md']) {
    const page = readFileSync(resolve(repository, path), 'utf8');
    assert.ok(page.includes(line),
      `${path} does not carry the measured port queue.\n  measured: ${line}\n`
      + '  Update the port-queue line there, and the decisions doc\'s ledger line,\n'
      + '  in the SAME change as whatever moved the queue.');
  }
  const page = readFileSync(resolve(repository, 'AGENTS.md'), 'utf8');

  // The counts alone would pass a swap — one capability into a bucket and one
  // out leaves every number where it was — so the startable set is pinned by
  // NAME as well. It is EMPTY at D91, which is the state this test exists to
  // stop anybody asserting in prose: D79 wrote "nothing startable left" into
  // AGENTS.md, D84 then moved three capabilities back in, and nothing failed.
  // With the bucket at zero the guard is the measured line above, which carries
  // `records_schema=0` and changes the moment a decision puts work back.
  assert.deepEqual(report.port_blockers.records_schema, [],
    'the startable set changed; re-read what each entry now waits on and move AGENTS.md with it');
  for (const name of report.port_blockers.records_schema) {
    assert.ok(page.includes(name), `AGENTS.md should name ${name} as startable`);
  }
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
    { names: ['Patient'], dynamic: false, writes: [], writeColumns: {} });
  assert.deepEqual(reach('base44.asServiceRole.entities.Visit.list()'),
    { names: ['Visit'], dynamic: false, writes: [], writeColumns: {} });
  // Destructuring, which it did not. Aliasing a destructured name too.
  assert.deepEqual(reach('const { Patient, Agency: A } = base44.entities;'),
    { names: ['Agency', 'Patient'], dynamic: false, writes: [], writeColumns: {} });
  // Aliasing the NAMESPACE, which is how `getDashboardData` reads every active
  // patient while containing no occurrence of `entities.Patient`. A scan that
  // misses this reported six functions as staying inside the family when the
  // real number was zero.
  assert.deepEqual(reach('const sr = base44.asServiceRole.entities;\nawait sr.Patient.filter({});\nsr.Visit.list();'),
    { names: ['Patient', 'Visit'], dynamic: false, writes: [], writeColumns: {} });
  assert.deepEqual(reach('const e = base44.entities\ne.Config.list()'),
    { names: ['Config'], dynamic: false, writes: [], writeColumns: {} });
  // Dynamic access, through either the namespace or an alias of it.
  assert.equal(reach('base44.entities[name].filter({})').dynamic, true);
  assert.equal(reach('const sr = base44.entities;\nsr[name].list()').dynamic, true);
  // Names that are not entities do not become findings, and a module that
  // touches nothing says so rather than throwing.
  assert.deepEqual(reach('const sr = base44.entities;\nsr.Promise.resolve()'),
    { names: [], dynamic: false, writes: [], writeColumns: {} });
  assert.deepEqual(reach('await base44.integrations.Core.SendEmail({})'),
    { names: [], dynamic: false, writes: [], writeColumns: {} });
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
  assert.deepEqual(mixed,
    { names: ['Patient', 'User'], dynamic: false, writes: ['User'], writeColumns: { User: [] } });
  // WHICH columns, which became a question when D82 made `user` writable in
  // part. Top-level keys of an object literal, and nothing deeper: a nested
  // object is one column holding JSON, so its keys are not columns of this
  // table and a scan that walked into them would report `duty_status` as
  // written by a module that only logged it.
  assert.deepEqual(
    reach("base44.entities.User.update(id, { duty_status: 'off_duty', duty_on_since: null })").writeColumns,
    { User: ['duty_on_since', 'duty_status'] });
  assert.deepEqual(
    reach('base44.entities.User.create({ role: 1, details: { duty_status: 2, nested: { role: 3 } } })').writeColumns,
    { User: ['details', 'role'] });
  // A shorthand key names its column as plainly as a written one does.
  assert.deepEqual(reach('base44.entities.User.update(id, { phone })').writeColumns, { User: ['phone'] });
  // Unknown is not empty, and the two shapes that produce it both occur here:
  // a payload assembled elsewhere, and a conditional spread.
  assert.equal(reach('await base44.entities.User.update(id, updates);').writeColumns.User, null,
    'a payload assembled elsewhere cannot be read');
  assert.equal(reach("base44.entities.User.update(id, { role: 'user', ...(x && { phone: y }) })").writeColumns.User,
    null, 'a spread hides whatever it carries');
  // Two calls on one entity are one answer, and either of them being opaque
  // makes the whole answer opaque.
  assert.deepEqual(reach('base44.entities.User.update(a, { phone: 1 });\nbase44.entities.User.update(b, { role: 2 });')
    .writeColumns, { User: ['phone', 'role'] });
  assert.equal(reach('base44.entities.User.update(a, { phone: 1 });\nbase44.entities.User.update(b, payload);')
    .writeColumns.User, null);
  // A name that is not an entity cannot become a write, and neither can a
  // method that merely shares a word with one.
  assert.deepEqual(reach('const rows = [];\nrows.update();\nawait base44.entities.Patient.list()').writes, []);
});

test('what the record store permits per entity is read from the policies it emits', () => {
  // It used to be inferred from the tenant path — "kind is `profile_claim`"
  // standing in for "has no policy" — which was true only while a profile
  // claim was the one thing that produced a table with none. D23 ends that,
  // and an inference that could not tell "no policy" from "read-only" would
  // have reported all 39 of `User`'s `port` readers unblocked along with the 7
  // that write it.
  const permits = discoverEntityPolicies(repository);
  assert.equal(Object.keys(permits).length, 156, 'every carried entity is accounted for');
  assert.deepEqual(discoverPolicylessEntities(repository), [], 'nothing is unreadable any more');
  const readOnly = Object.keys(permits).filter(entity => permits[entity].read && !permits[entity].write).sort();
  // The eight platform reference tables. `User` left this list with D82: the
  // roster is now writable, and `discoverColumnNarrowing` is what says how far.
  assert.deepEqual(readOnly, ['AIModelConfiguration', 'CitationLibrary', 'ComplianceRule', 'MedicareComplianceRule',
    'MedicareGuideline', 'NewFeature', 'ProviderSettings', 'ServiceCode']);
  assert.deepEqual(permits.User, { read: true, write: true });
  assert.deepEqual(permits.Patient, { read: true, write: true });
  // A tree with no record store says nothing rather than guessing, because an
  // empty answer here would read as "everything is permitted".
  assert.deepEqual(discoverEntityPolicies(resolve(repository, 'services')), {});
});

test('D84: a settled leg excuses that leg and cannot outlive it', () => {
  // The entry is not a note. It changes what the queue reports, so the thing
  // that matters about it is what happens when it stops being true — which is
  // the shape this repository has now got wrong nine times, always the same
  // way: nothing fails, so nothing surfaces it.
  const legs = (entry) => ({ Going: { ...entry } });
  const declare = (over = {}) => manifest({
    functions: { alpha: 'port' },
    entities: { Kept: 'port', Going: 'hub' },
    ...over,
  });
  const reach = { entityReach: { alpha: { names: ['Kept', 'Going'], dynamic: false, writes: [] } } };
  const run = (over) => checkCoverage(capabilities(), declare(over),
    { portBlockers: { alpha: 'records_schema' }, ...reach });
  const bucket = (report) =>
    Object.entries(report.port_blockers).filter(([, names]) => names.length).map(([key]) => key);
  const settled = {
    alpha: { entities: ['Going'], served_by: 'somewhere that exists', because: 'a'.repeat(40) },
  };

  // Without an entry, one leg into a leaving domain holds the whole capability.
  assert.deepEqual(bucket(run()), ['entity_not_carried']);
  // With one, only that leg is excused, and what is left is the port itself.
  assert.deepEqual(bucket(run({ uncarried_legs: settled })), ['records_schema']);
  assert.deepEqual(run({ uncarried_legs: settled }).uncarried_legs_unused, []);

  // And the four ways it can stop being true, each of which must fail rather
  // than go on excusing something.
  const stale = (over) => run({ uncarried_legs: over }).uncarried_legs_unused;
  assert.deepEqual(stale({ alpha: { ...settled.alpha, entities: ['Kept'] } }), ['functions:alpha'],
    'an entity that is carried after all is not a leg to settle');
  assert.deepEqual(stale({ alpha: { ...settled.alpha, entities: ['Going', 'Absent'] } }), ['functions:alpha'],
    'an entity the module does not reach is a leg that moved');
  assert.deepEqual(stale({ beta: settled.alpha }), ['functions:beta'],
    'an entry for a capability that is not a port here');
  // A capability whose own disposition changed takes its entry with it.
  const retired = checkCoverage(capabilities(),
    manifest({ functions: { alpha: 'retire' }, entities: { Kept: 'port', Going: 'hub' },
      uncarried_legs: settled, retention: {} }),
    { portBlockers: { alpha: 'records_schema' }, ...reach });
  assert.deepEqual(retired.uncarried_legs_unused, ['functions:alpha']);
  // A stale entry blocks the census, the way an unspecified retention does.
  assert.equal(run({ uncarried_legs: { beta: settled.alpha } }).census_ready, false);
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
  // D84's block, under the same discipline `broker_ceiling` is under: a
  // settled leg that cannot name its entities, what serves them, or why, is
  // not a settled leg. The floor on `because` is the load-bearing one — a
  // reason nobody had to write is a reason nobody wrote.
  legsNotObject: JSON.stringify(manifest({ uncarried_legs: [] })),
  legsEntryNotObject: JSON.stringify(manifest({ uncarried_legs: { alpha: 'fine' } })),
  legsNoEntities: JSON.stringify(manifest({ uncarried_legs: { alpha: { entities: [], served_by: 'x', because: 'a'.repeat(30) } } })),
  legsEntityNotString: JSON.stringify(manifest({ uncarried_legs: { alpha: { entities: [7], served_by: 'x', because: 'a'.repeat(30) } } })),
  legsNoServedBy: JSON.stringify(manifest({ uncarried_legs: { alpha: { entities: ['Beta'], because: 'a'.repeat(30) } } })),
  legsBlankServedBy: JSON.stringify(manifest({ uncarried_legs: { alpha: { entities: ['Beta'], served_by: '  ', because: 'a'.repeat(30) } } })),
  legsNoReason: JSON.stringify(manifest({ uncarried_legs: { alpha: { entities: ['Beta'], served_by: 'x' } } })),
  legsShortReason: JSON.stringify(manifest({ uncarried_legs: { alpha: { entities: ['Beta'], served_by: 'x', because: 'because' } } })),
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

test('the port queue is work that cannot start yet, and says why', async () => {
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
  // the `assigned_nurses` representation D21 and D24 threw out — and the note
  // history pair, whose table D32 made genuinely append-only first. Then
  // `managePatientCareTeamAssignment`, the one capability whose original is
  // PAUSED AT SOURCE: D33 re-enables its four mutations because the owned store
  // meets the three conditions the pause names, and it is the port that makes
  // D24 operable — until it, nothing could take a clinician off a care team.
  // Then the tenant-context pair, the first whose originals read nothing the
  // record store owns at all — `AgencyMembership` and `Agency` are the
  // authority store's own model, so what they needed was a contract over
  // `pennsync_private.membership` rather than a table in `pennsync_records`.
  // Then `manageAgencyMembership`, the write half of the same model and the
  // SECOND partial port: five of its six actions, with `provision` refused by
  // name because its own guard reserves it to the platform owner D14 and D22
  // removed.
  // Then `policyAcknowledgment`, the THIRD partial port: `acknowledge` is
  // served and `list` is not, because its gate is the Base44 built-in admin
  // that D31 already found has no performer left.
  // Then the AI content agreement pair, the FIRST port to write D25's
  // activity trail — every capability ported before it audited nothing.
  // Then the whole time-off domain in one change, which is four capabilities
  // that each answered the same authorization question a different way by
  // reading the carried `User` row D23 says decides nothing.
  // 76 → 74 → 72 → 70 → 69 → 68 → 67 → 66 → 64 → 62 → 61 → 59 → 58 → 57 →
  // Then `submitPersonnelCredential` ALONE — its sibling
  // `reviewPersonnelCredential` is the first WHOLE capability with no
  // performer left, so it stays in the queue until somebody decides who may
  // approve a credential.
  // Then `reviewPersonnelCredential`, the first port made under D40 — the
  // owner's decision that an `agency_admin` is the built-in admin's
  // successor, and the first deliberate WIDENING in the whole migration.
  // Then the invitation pair, which is ONE contract for two capabilities —
  // `resendInvitation` and `resendInvitationV2` are byte-identical apart
  // from a comment naming the second the production replacement.
  // Then the two agency configuration upserts, whose originals each rebuilt
  // their own SCOPE in JavaScript and each record a bug from it.
  // Then the incident pair, where D40's widening puts a REPORTER and a
  // REVIEWER in the same person for the first time — so the contract adds the
  // self-review refusal the platform tier used to make unnecessary.
  // Then `manageMyNotifications`, whose port found the defect in the one
  // before it: the incident fan-out stamped three of the six authority columns
  // this reader filters on, so its alerts were addressed to nobody.
  // Then `manageVehicleMaintenance`, TWO of whose eight actions needed no SQL
  // at all: `context` is D34's tenant memberships and `staff` is D22's roster.
  // Then a CORRECTION rather than a port: six capabilities carried `port` and
  // counted here refuse every caller from the first statement of their own
  // handler. The paused-at-source check could not see them because it looks
  // for a `const FLAG = false`, and these use no flag — the same failure that
  // check was written to fix, in a shape nobody re-measured.
  // Then `createNotification`, the writer half of the notification pair, which
  // moves the authority envelope into one facility both it and the incident
  // fan-out call — so there is one place left to get it wrong.
  // Then `checkExpiredInvitations`, whose HUMAN gate D40 answers and whose
  // MACHINE gate — a shared secret over every tenant — has no successor,
  // because nothing in this store is cross-tenant.
  // Then the two credential sweeps, which are TWO contracts rather than one
  // because the renewal original records why they must be: three crons once
  // shared a marker column with different tier sets, and whichever fired a
  // shared tier first consumed it for the others.
  // Then `checkAdrDeadlines`, the last of D49's four and the only one with
  // nothing paused — its reminder is a row rather than an email — which also
  // makes it the evidence for `notification_mint`: the original stamps none of
  // the six authority columns its own reader filters on.
  // Then the timesheet pair, the largest port so far, where almost nothing
  // the caller sends decides what they are paid.
  // Then `triageReferralWithAI`, the first port to sequence a brokered model
  // call and a write — the pattern the eleven model-backed ports left in this
  // bucket all need.
  // 55 → 51 → 50 → 49 → 48 → 46 → 44 → 42 → 41 → 40 → 36 → 35 → 34 → 32 → 31
  // Then `syncCMSRegulations`, the first whose write is a RECORD contract
  // rather than a trail append — and the first to check a MODEL's answers
  // against the columns' own constraints before storing them.
  // Then a SECOND correction rather than a port: four capabilities whose ONLY
  // entity is one of D25's three retired log tables were counted against the
  // record store, when the trail IS their record half and what they actually
  // wait on is the file layer, `Core.SendEmail` or a third-party key.
  // → 29 → 28 → 27 → 23, and 11 → 56 written.
  // Then D75 took the record bucket to ZERO on a correction, and D76 emptied
  // `ported_function` the same way: the queue reported the wait for sixty-eight
  // ports after D68 wrote the thing being waited for, because the rule reads
  // the SHAPE of the call and never asked who the callee was. Unlike the five
  // corrections before it, this one moved a capability from blocked to
  // startable rather than renaming its bucket — and it was written the same
  // day. → 71 → 72 written.
  // Then D81, the one D79 found startable while writing itself: the handout's
  // send sits behind the module's own release gate, so its document action
  // waited on nothing. `core_integration` 3 → 2, and 73 written. D86 wrote the
  // last two and `core_integration` is 0: both are capabilities whose entire
  // body is one send, so both ship as the caller gate plus the original's own
  // paused answer, and a bucket that was a release gate is now a released
  // decision with the gate inside the handler.
  const report = checkCoverage(
    discoverCapabilities(repository),
    parseManifest(readFileSync(resolve(repository, 'tools-transition-disposition.json'), 'utf8')),
    discoverEvidence(repository),
  );
  const counts = Object.fromEntries(Object.entries(report.port_blockers).map(([key, names]) => [key, names.length]));
  assert.deepEqual(counts, { entity_not_carried: 0, entity_authorization: 7, patient_access_model: 0,
    records_schema: 0, files: 12, ported_function: 0, core_integration: 0, pdf_rendering: 0,
    external_secret: 2, none: 78 });
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
  //
  // D84 empties it, and by two different findings rather than one. Three of
  // the seven were in the wrong place entirely: `analyzeNurseDeficits` and
  // `analyzeRealTimePerformance` read training telemetry and nothing else, so
  // they follow D8 to the Hub, and `getCommsDashboard` was the last `port`
  // among twenty-seven SMS, fax and voice handlers — the read side of a domain
  // D7 carries paused. The other four are carried capabilities with one
  // uncarried LEG, each settled in the manifest with what serves it instead,
  // so the bucket stops reporting a whole capability as blocked on a schema
  // because two figures of one PDF come from a table that is leaving.
  assert.deepEqual(report.port_blockers.entity_not_carried, [],
    'a capability is held here only by a leg nobody has settled');
  // `acceptAiContentAgreement` writes `UserActivity` and reads nothing else
  // uncarried. It sat here for exactly as long as retiring the table was read
  // as retiring the obligation.
  assert.ok(!report.port_blockers.entity_not_carried.includes('acceptAiContentAgreement'));
  // D23 then emptied most of `entity_authorization` the same way. The bucket
  // meant "reads `User`, which has forced RLS and no policy"; the store now
  // gives `User` a read policy keyed on the authority store's roster, so what
  // is left is only what a read policy does not help:
  //
  // - the 6 that UPDATE a profile, which D23 deliberately leaves open. The
  //   roster policy is read-only, so nothing decided that question by
  //   accident. A seventh profile writer, `offboardUser`, reaches a table that
  //   gets no row here at all and is held by `entity_not_carried` first;
  // - two that write `MedicareGuideline`, a `global` reference table no tenant
  //   surface may write. That was always true and was never reported, because
  //   the classifier could not tell reading a table from writing one.
  //
  // Two of these left it by being MEASURED rather than decided:
  // `calculateDataQualityScores` and `enforceDataCompleteness` refuse every
  // caller from the first statement of their handler, so what blocked them was
  // never a profile write.
  //
  // D82 and D83 then corrected both halves of that paragraph, in opposite
  // directions. The two `MedicareGuideline` writers left by being
  // re-dispositioned: D83 says a `global` reference table is written by
  // migration and never at runtime, so neither is a caller-facing handler to
  // write. The six profile writers stayed although `user` became writable,
  // because D82 permits the caller's OWN row and a named column set, and every
  // one of them writes somebody else's row, a column outside that set, or a
  // payload nothing can read. `offboardUser` joined them: it was held by
  // `entity_not_carried` first, and D84 settled that leg.
  assert.deepEqual(report.port_blockers.entity_authorization,
    ['autoApproveInvitedUser', 'autoEndDutyDay', 'enforceStaffRoleIntegrity', 'offboardUser',
      'setNurseDutyStatus', 'userManagement', 'userManagementV2']);
  // ZERO. That is how many of the hundred are still waiting on the record
  // store, and it reached zero on a CORRECTION rather than on a port: D75
  // found that the last entry, `processCompletedVisit`, pauses at source with
  // a flag pinned `true` — the polarity this check did not know — so it
  // refuses every caller and was never startable. and the
  // number is still the point: `records_schema=94` said the record store was
  // what stood in front of the queue, and everything since has been finding
  // out what actually did. Nothing in the queue waits on a decision now, and
  // nothing waits on a shared prerequisite either — so from here the bucket
  // only falls by ports being written, which is what took it off 76.
  //
  // It went to 3 and is 0, and BOTH directions are the queue reading
  // correctly: D84 moved three capabilities OUT of `entity_not_carried` by
  // settling their one uncarried leg, and D89, D90 and D91 then wrote all
  // three. A bucket that only ever falls is a bucket nobody can move work
  // into, and one that never falls is a queue nobody is clearing. D75 took it
  // to zero on a CORRECTION; this is the first time it reaches zero with every
  // capability in it written.
  assert.deepEqual(report.port_blockers.records_schema, []);
  // The thirty-eight that left it are the ported capabilities that touch clinical rows
  // — D26's patient pair, then the visit and document pairs on the same
  // machinery, then the patient write and mutation, then the visit pair that
  // carries the SmartNote save — so they are also the proof that the D19
  // pattern carries PHI and not only configuration. `updateAuthorizedVisit`
  // is the first that is only PARTLY ported: four of its nine actions, with
  // the other five refused by name and reason. The
  // document pair additionally shows that `files` was never the blocker there:
  // no purpose discloses a locator. `managePatientCareTeamAssignment` is the
  // last of them and the odd one: its four mutations were refused at module
  // scope in the original, so porting it RE-ENABLES rather than reproduces.
  // The tenant-context pair is the counter-example to the bucket's own name:
  // `records_schema` had come to mean "touches an entity", and these two touch
  // only entities the AUTHORITY store already models natively.
  for (const name of ['listAuthorizedPatients', 'getAuthorizedPatient',
    'listAuthorizedVisits', 'getAuthorizedVisit',
    'listAuthorizedDocuments', 'getAuthorizedDocument', 'createAuthorizedPatient',
    'updateAuthorizedPatient', 'createAuthorizedVisit', 'updateAuthorizedVisit',
    'getScopedPatientAlerts', 'updateScopedPatientAlert',
    'appendPatientNoteHistory', 'getAuthorizedPatientNoteHistory',
    'managePatientCareTeamAssignment', 'getMyTenantContext', 'listMyTenantMemberships',
    'manageAgencyMembership', 'policyAcknowledgment',
    'acceptAiContentAgreement', 'getAiContentAgreementStatus',
    'submitTimeOffRequest', 'cancelTimeOffRequest', 'reviewTimeOffRequest',
    'getApprovedTimeOff', 'submitPersonnelCredential', 'reviewPersonnelCredential',
    'auditDataQuality', 'resendInvitation', 'resendInvitationV2',
    'saveVisitPointConfig', 'savePayrollProfile', 'predictSupplyNeeds',
    'analyzeVisitForSupplyUsage', 'importProvidersCsv', 'expandClinicalPhrase',
    'generateFollowUpTasks', 'analyzeClinicalEvents', 'analyzeClinicalTrends',
    'analyzeAndGenerateClinicalTasks', 'extractClinicalEvents']) {
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
  for (const name of ['getScopedPatientAlerts', 'updateScopedPatientAlert',
    'appendPatientNoteHistory', 'getAuthorizedPatientNoteHistory']) {
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
  // `generatePatientHandout` joined it by the refinement above — its only
  // entity is `SystemLog` — and left it by being written (D81): the send was
  // one action of two, refused by the module's own gate, so the document half
  // never waited on the runtime at all.
  //
  // The last two left it the same way (D86), and the bucket is empty. What
  // made them writable was not the runtime brokering `SendEmail` — it still
  // does not — but noticing that a capability whose whole body is a send has a
  // refusal to ship, and that refusing it here is stronger than refusing it in
  // Base44: the port cannot send even if someone released the gate, because
  // `BROKERED_OPERATIONS` does not carry the operation. An empty bucket here
  // does NOT mean D56 was decided; it means nothing is waiting on that
  // decision to be written.
  assert.deepEqual(report.port_blockers.core_integration, []);
  for (const name of ['sendAccountReadyEmail', 'sendWelcomeEmail']) {
    assert.ok(report.port_blockers.none.includes(name), `${name} is written`);
  }
  // Named, because porting one of these verbatim would carry Base44's storage
  // host into the service, and the `cmfile:` handles that replace those URLs do
  // not exist yet. They wait on the file layer, not on the runtime.
  // `mergePDFs` and `reorderDeletePDFPages` join them by the refinement: each
  // touches `UserActivity` and nothing else, so the record store is not what
  // either is waiting for.
  // D65 moved six here from `records_schema`. The classifier returned the
  // record store first for a module that touches entities AND reaches the file
  // layer, which was right while the store was the question; it is built now,
  // with sixty-three ports over it, while the file layer is still a data
  // migration and thirty-one call sites. `records_schema` reads as "startable
  // today", and for these six it was not true.
  assert.deepEqual(report.port_blockers.files, ['createAuthorizedDocument',
    'extractClinicalDocument', 'extractPatientDataFromDocument', 'generateAdrPacket',
    'generateDynamicCoverSheet', 'generateNoteFromRecording', 'indexPDF', 'mergePDFs',
    'preparePDFWithPatientInfo', 'processPatientFileUpdate', 'reorderDeletePDFPages',
    'splitReferralPDF']);
  assert.deepEqual(report.port_blockers.none,
    ['acceptAiContentAgreement', 'analyzeAndGenerateClinicalTasks',
      'analyzeClinicalEvents', 'analyzeClinicalTrends',
      'analyzeReferral', 'analyzeReferralIntake',
      'analyzeReferralPriority', 'analyzeVisitForSupplyUsage',
      'appendPatientNoteHistory', 'auditDataQuality', 'cancelTimeOffRequest',
      'checkAdrDeadlines', 'checkExpiredInvitations',
      'createAuthorizedPatient', 'createAuthorizedVisit', 'createNotification',
      'distributePolicyAcknowledgment',
      'expandClinicalPhrase',
      'extractClinicalEvents',
      'extractReferralDataForSmartNote',
      'generateAIReport', 'generateBagTechniquePDF', 'generateFollowUpTasks',
      'generatePatientChartPDF', 'generatePatientHandout', 'generateReferralTasks',
      'generateSmartNoteGuide',
      'generateUserGuidePDF', 'generateUserManual', 'generateUserRosterPDF',
      'getAiContentAgreementStatus', 'getApprovedTimeOff',
      'getAuthorizedDocument', 'getAuthorizedPatient',
      'getAuthorizedPatientNoteHistory', 'getAuthorizedVisit', 'getDashboardData',
      'getMyTenantContext', 'getScopedPatientAlerts', 'importProvidersCsv',
      'listAuthorizedDocuments', 'listAuthorizedPatients', 'listAuthorizedVisits',
      'listMyTenantMemberships', 'listPolicyLibrary', 'manageAgencyMembership',
      'manageAuthorizedReferral', 'manageMyNotifications',
      'managePatientCareTeamAssignment', 'manageVehicleMaintenance',
      'matchPatientWithAI', 'policyAcknowledgment',
      'predictSupplyNeeds', 'resendInvitation', 'resendInvitationV2',
      'reviewPersonnelCredential', 'reviewTimeOffRequest', 'reviewTimesheet',
      'savePayrollProfile', 'saveVisitPointConfig', 'searchPDFs',
      'sendAccountReadyEmail', 'sendCredentialRenewalReminders',
      'sendExpirationNotifications', 'sendPersonnelExpirationNotifications',
    'sendWelcomeEmail',
      'submitIncidentReport',
      'submitPersonnelCredential', 'submitStateReportableIncident',
      'submitTimeOffRequest', 'submitTimesheet',
      'syncCMSRegulations', 'triageReferralWithAI',
      'updateAuthorizedPatient',
      'updateAuthorizedVisit', 'updateIncident', 'updateScopedPatientAlert',
      'validatePatientData'],
    'the set of written ports changed');
  // `listPolicyLibrary` is the first of these to read an entity row. Everything
  // before it either computed an answer, rendered a document or asked a model,
  // so the records bucket had never moved by a port being written — only by a
  // function being reclassified. It moves now.
  assert.ok(report.port_blockers.none.includes('listPolicyLibrary'));
  // D76. This read `['extractReferralDataForSmartNote']` for sixty-eight ports,
  // because `ported_function` answers on the SHAPE of the call and never asked
  // who the callee was. D68 wrote the callee.
  assert.deepEqual(report.port_blockers.ported_function, []);
  assert.ok(report.port_blockers.none.includes('extractReferralDataForSmartNote'));
  // All three emptied this bucket once the service adopted a PDF library and a
  // call-sequence parity test; nothing is waiting on a rendering decision now.
  assert.deepEqual(report.port_blockers.pdf_rendering, []);
  // `transcribeAudioWithWhisper` joins it the same way: its only entity is
  // `UserActivity`, and it reads `OPENAI_API_KEY` and calls the provider
  // directly rather than through the brokered runtime.
  assert.deepEqual(report.port_blockers.external_secret,
    ['transcribeAndGenerateSOAPNote', 'transcribeAudioWithWhisper']);
  // D87 measures what `external_secret` is standing on for these two, because
  // "a key from the environment" reads as one missing credential and is three
  // separate walls. The bucket name has been wrong here before, so each is an
  // assertion rather than a sentence:
  //
  // 1. There is no audio operation to broker. `OPERATIONS` is the runtime's
  //    whole vocabulary and a request for anything outside it is refused.
  // 2. The runtime holds no key for the provider either function calls, so
  //    even a brokered operation would have nothing to call with.
  // 3. The owned bucket admits no audio type, so the bytes could not be
  //    carried there whatever the reader model decided.
  //
  // The first two are what D87 designs around and the third is why the design
  // stops where it does. Any one of them falling away leaves the other two.
  const { MIME, OPERATIONS } = await import('./services/integration-runtime/contracts.mjs');
  assert.ok(!OPERATIONS.some(operation => /audio|transcri|speech/i.test(operation)),
    'no brokered operation carries audio');
  const runtimeSource = readFileSync(resolve(repository, 'services/integration-runtime/runtime.mjs'), 'utf8');
  assert.ok(!runtimeSource.includes('OPENAI_API_KEY'), 'the runtime holds no key for the transcription provider');
  assert.ok(![...MIME].some(type => type.startsWith('audio/')), 'the owned bucket admits no audio type');
  // The sum is every function dispositioned `port`, so nothing falls out of the
  // queue by being unclassifiable.
  assert.equal(Object.values(counts).reduce((total, value) => total + value, 0), report.families.functions.counts.port);
});

test('what holds each member of `entity_authorization` is measured, not described', async () => {
  // The bucket described itself by a rule it had stopped using. Its paragraph
  // said "reads a carried entity that has forced RLS and no policy. That is
  // `User`" and that what it counted was "a roster read waiting on that RPC" —
  // and by then `User` had a read policy, `discoverPolicylessEntities` was
  // empty, and the RPC had shipped as `contract_roster` with two handlers over
  // it. The sixth correction of that shape (D74) and the seventh (D75) each
  // found the same thing, so what stops the eighth is not better prose: it is
  // asserting which entity holds each member, so a rewrite that gets the
  // reason wrong fails here rather than being read and believed.
  const declared = parseManifest(readFileSync(resolve(repository, 'tools-transition-disposition.json'), 'utf8'));
  const evidence = discoverEvidence(repository);
  const report = checkCoverage(discoverCapabilities(repository), declared, evidence);
  const permits = evidence.entityPolicies;
  const narrowing = evidence.columnNarrowing;
  const scheduled = new Set(evidence.schedulerAuthFunctions);
  // A write the store will not take, measured two ways, because after D82 there
  // are two ways for a store to refuse one.
  //
  // `readOnly` is the original: forced RLS with a read policy and no write
  // policy, which is every `global` reference table and was `User` until D82.
  //
  // `outsideNarrowing` is the one D82 adds, and it is the reason this test was
  // rewritten rather than deleted. `user` is writable now, so a rule asking
  // only "may this table be written" would have reported all seven of its
  // writers unblocked on the day the policy landed — the ninth instance of
  // exactly the defect this file exists to catch, arriving from the other
  // direction. The narrowing is the caller's OWN row and a named column set, so
  // a write is covered only where the payload can be read, every column of it
  // is named, and there is a caller at all.
  const readOnly = (entity) => permits[entity] && permits[entity].read && !permits[entity].write;
  const outsideNarrowing = (name, entity, reach) => {
    const allowed = narrowing[entity];
    if (!allowed) return false;
    if (scheduled.has(name)) return true;
    const uses = (reach.writeColumns || {})[entity];
    return !Array.isArray(uses) || uses.some(column => !allowed.includes(column));
  };
  // Which entities a `port` capability writes and the store refuses, from the tree.
  const held = {};
  for (const [name, reach] of Object.entries(evidence.entityReach)) {
    if (declared.functions[name] !== 'port' || reach.dynamic) continue;
    const written = (reach.writes || [])
      .filter(entity => readOnly(entity) || outsideNarrowing(name, entity, reach)).sort();
    if (written.length) held[name] = written;
  }
  // One population now, where there were two. `MedicareGuideline` left when
  // D83 re-dispositioned its two writers: a `global` reference table is
  // written by migration and never at runtime, so neither
  // `fetchMedicareGuideline` nor `scheduledGuidelineSync` is a caller-facing
  // handler somebody has yet to write — and a blocked port and a capability
  // that is not being carried are not the same thing, however alike they look
  // in a count.
  assert.deepEqual([...new Set(Object.values(held).flat())].sort(), ['User']);
  const declaredNow = declared.functions;
  for (const name of ['fetchMedicareGuideline', 'scheduledGuidelineSync']) {
    assert.equal(declaredNow[name], 'retire', `${name} is not carried (D83)`);
  }
  // All seven are in the bucket now. `offboardUser` was held by
  // `entity_not_carried` first until D84 settled that leg, so it arrives here
  // where the measurement always said it belonged.
  assert.deepEqual(Object.keys(held).filter(name => held[name].includes('User')).sort(),
    ['autoApproveInvitedUser', 'autoEndDutyDay', 'enforceStaffRoleIntegrity', 'offboardUser',
      'setNurseDutyStatus', 'userManagement', 'userManagementV2'],
    'the administrative write path D82 leaves open');
  assert.equal(Object.keys(held).filter(name => held[name].includes('User')).length, 7);
  assert.deepEqual(report.port_blockers.entity_authorization.filter(name => !held[name]), [],
    'every member is held by a write this measured');
  // And what holds each of the seven, named, so a later widening of the
  // allowlist has to come past this list rather than past a count.
  //
  // `autoEndDutyDay` is the one worth reading twice: both columns it writes
  // ARE in D82's allowlist, and it stays blocked because it has no caller —
  // `schedulerAuth` admits a shared secret, and "the caller's own row" admits a
  // shared secret to nothing. A rule written over columns alone would have
  // reported a nightly sweep of every on-duty person in the deployment as a
  // self-service profile edit.
  assert.deepEqual(evidence.entityReach.autoEndDutyDay.writeColumns.User, ['duty_on_since', 'duty_status']);
  assert.ok(scheduled.has('autoEndDutyDay') && !scheduled.has('setNurseDutyStatus'));
  assert.deepEqual(evidence.entityReach.enforceStaffRoleIntegrity.writeColumns.User, ['staff_role'],
    'a column nobody may assert about themselves');
  for (const opaque of ['autoApproveInvitedUser', 'setNurseDutyStatus', 'userManagement', 'userManagementV2']) {
    assert.equal(evidence.entityReach[opaque].writeColumns.User, null,
      `${opaque} assembles its payload, so what it sets cannot be read here`);
  }
  assert.ok(report.port_blockers.entity_authorization.includes('offboardUser'));
  assert.deepEqual(report.port_blockers.entity_not_carried, []);
  // The other half of the corrected paragraph: the read rule is a guard that
  // fires on nothing, and the RPC it said these were waiting for exists.
  assert.deepEqual(discoverPolicylessEntities(repository), []);
  const { HANDLER_NAMES } = await import('./services/pennsync-api/handlers.mjs');
  for (const handler of ['listAgencyRoster', 'getAgencyRosterMember']) {
    assert.ok(HANDLER_NAMES.includes(handler), `${handler} is the roster RPC the bucket said it was waiting for`);
  }
});

test('what `core_integration` blocks is measured per module, not assumed from the reach', () => {
  // The rule is `/\.\s*integrations\s*\./` and answers on the SHAPE of the
  // call — D76's defect, in the family next door. It never asks whether the
  // call sits on a path the module itself already refuses, and for one of the
  // three it does.
  //
  // The discriminator is D74's own words about `sendAccountReadyEmail`, whose
  // "whole body is one `Core.SendEmail`": does the module have a SUCCESS
  // answer that is not the integration's result? Where every success path goes
  // through the send, the send is the capability and the runtime is what it
  // waits on. Where one does not, the capability is a PARTIAL port — the shape
  // D42, D49, D50, D52, D54 and D73 already ship six times, with the delivery
  // paused and REPORTED as paused.
  const read = (name) => readFileSync(resolve(repository, 'base44/functions', name, 'entry.ts'), 'utf8');
  const coreReaches = (source) =>
    [...source.matchAll(/integrations\s*\.\s*Core\s*\.\s*([A-Za-z]+)/g)].map(match => match[1]);
  for (const name of ['generatePatientHandout', 'sendAccountReadyEmail', 'sendWelcomeEmail']) {
    assert.deepEqual([...new Set(coreReaches(read(name)))], ['SendEmail'],
      `${name} reaches a Core operation other than the send`);
  }
  // The two the bucket is right about: every success answer they can give is
  // the send's own confirmation.
  for (const name of ['sendAccountReadyEmail', 'sendWelcomeEmail']) {
    const successes = [...read(name).matchAll(/return Response\.json\(\{\s*success: true[^\n]*/g)].map(m => m[0]);
    assert.equal(successes.length, 1, `${name} has more than one success answer`);
    assert.match(successes[0], /email sent/, `${name}'s success answer is not the send's`);
  }
  // The one it is wrong about. Its single reach is inside an `action ===
  // 'email'` branch that the module's OWN gate refuses before any work is
  // done, and two success answers carry a rendered PDF instead.
  const handout = read('generatePatientHandout');
  const lines = handout.split('\n');
  const sendLine = lines.findIndex(line => /integrations\s*\.\s*Core\s*\.\s*SendEmail/.test(line));
  const guardLine = lines.findIndex(line => /if \(action === 'email' && !outboundDeliveryReleased\(\)\)/.test(line));
  const branchLine = lines.findLastIndex((line, index) =>
    index < sendLine && /if \(action === 'email'/.test(line));
  assert.ok(guardLine > 0 && guardLine < sendLine, 'the release gate no longer precedes the send');
  assert.ok(branchLine > guardLine, 'the send is no longer inside an action branch');
  assert.match(lines[guardLine + 1], /outboundDeliveryPausedResponse\('email'\)/,
    'the gate no longer refuses the email action');
  const pdfAnswers = [...handout.matchAll(/return Response\.json\(\{[^)]*\bpdf:/g)];
  assert.equal(pdfAnswers.length, 2, 'the document action no longer answers with a PDF');
  // So the document action waited on nothing: six sibling capabilities
  // already rendered a PDF in the ported service, its only entity is a retired
  // log table D25 gives a successor, and the email action is the owner
  // decision the six paused-delivery ports already record as paused. It was
  // WORK, not a decision — which is what `core_integration: 3` read as
  // denying — and D81 did it: the port serves the document and refuses the
  // send with the answer this gate gives.
  for (const sibling of ['generateBagTechniquePDF', 'generateUserRosterPDF', 'generatePatientChartPDF',
    'generateUserManual', 'generateSmartNoteGuide', 'generateUserGuidePDF', 'generatePatientHandout']) {
    assert.ok(discoverPortedFunctions(repository).includes(sibling), `${sibling} is a ported PDF`);
  }
});

test('nothing in the queue is startable and unwritten', async () => {
  // The milestone the counts do not state. `none` means "portable today", and
  // a reader takes a non-empty one as work available now — so the thing worth
  // asserting is that it is not: all 73 are written, and every capability left
  // is behind a decision or a phase rather than behind somebody's time.
  //
  // It runs in ONE direction only, and the first draft of this test claimed
  // two. A capability in `none` with no handler is startable work the queue
  // stopped surfacing, and that is checkable — sabotaging the registry path
  // fails this. The converse is not: `checkCoverage` sends a ported capability
  // to `none` without consulting `refine` at all, so "blocked, yet written"
  // cannot occur however wrong a blocker is, and an assertion against it
  // passes for a reason that has nothing to do with the queue being right.
  // That override has its own test ("nothing blocks a port that has
  // happened"); this one would only have looked like a second.
  const report = checkCoverage(
    discoverCapabilities(repository),
    parseManifest(readFileSync(resolve(repository, 'tools-transition-disposition.json'), 'utf8')),
    discoverEvidence(repository),
  );
  const { HANDLER_NAMES } = await import('./services/pennsync-api/handlers.mjs');
  const shipped = new Set(HANDLER_NAMES);
  assert.deepEqual(report.port_blockers.none.filter(name => !shipped.has(name)), [],
    'a capability the queue calls portable today has no handler');
  // The handlers over and above the queue are facilities rather than Base44
  // capabilities — they are not in `base44/functions`, so the queue never
  // counted them, and the list only grows as the frontend's own reads are
  // served. Two are the roster contract's (D22). One is the broker family's
  // only caller: the family serves the entities whose own schema plainly
  // permits a read, which is a disposition rather than a capability.
  //
  // Batch A's seven reference reads (D101), batch C's fourteen clinical
  // library, patient education and configuration capabilities, and batch E's
  // ten screen records are the same kind of thing for the same reason, and
  // they are why this list needs stating rather than deriving. The SPA called
  // `base44.entities.Physician.list(...)` and the rest straight through the
  // platform SDK, so there is no Base44 function to be the port of — what was
  // ported is the CALL, and what it succeeds is each entity's own `rls` block
  // rather than a module. The queue measures `base44/functions`, so it can
  // never count them and their absence from it is not a gap — which is exactly
  // why they are enumerated here, where a name arriving without a reviewed
  // contract has to come past this list.
  const facilities = [...shipped].filter(name => !report.port_blockers.none.includes(name)).sort();
  // The list is STATED, for the reason above. This only adds the half that is
  // checkable: a name with a Base44 function of its own is a port and belongs
  // in the queue, so it cannot reach this list by somebody forgetting which
  // kind it was.
  for (const name of facilities) {
    assert.ok(!existsSync(resolve(repository, 'base44/functions', name)),
      `${name} has a Base44 function, so it is a port and belongs in the queue`);
  }
  assert.deepEqual(facilities, [
    'getAgencyRosterMember', 'getMyNotificationPreferences', 'listAgencyRoster',
    'listBrokeredRecords', 'listChartClinicalEvents', 'listChartRecommendations',
    'listClinicalLibraryFolders', 'listClinicalLibraryTemplates', 'listClinicalPathways',
    'listCustomValidationRules', 'listDocumentTemplates', 'listEducationMaterials',
    'listLibraryDocuments', 'listMedicareComplianceRules', 'listMedicareGuidelines',
    'listOcrCorrections', 'listOcrTrainingRuns', 'listOnCallShifts',
    'listPatientEducationAssignments', 'listPhysicians', 'listSentEducationMaterials',
    'listVisitPointConfigs', 'lookupComplianceRule', 'manageClinicalLibraryFolder',
    'manageClinicalLibraryTemplate', 'manageClinicalPathway', 'manageCustomValidationRule',
    'manageEducationMaterial', 'managePatientEducationAssignment', 'readAiConfiguration',
    'recordChartRecommendation', 'recordSentEducationMaterial', 'saveAiConfiguration',
    'saveMyNotificationPreferences',
  ]);
});

test('a function call is only a reason to wait while the callee is unported', () => {
  const invoked = invokedFunctions(`
    const a = await base44.functions.invoke('portedOne', {});
    const b = await base44.functions.fetch('/portedTwo', {});
  `);
  assert.deepEqual(invoked, { names: ['portedOne', 'portedTwo'], dynamic: false });
  // `fetch` addresses the function by PATH, so the leading slash is not part of
  // the name and a set that kept it would match nothing in the registry.
  assert.equal(invoked.names.includes('/portedTwo'), false);
});

test('a function set nothing can enumerate claims nothing', () => {
  // `testAutomations` invokes a name it was handed. Every reach is counted and
  // only the parsed shapes are named, so an unparsed one leaves the set
  // dynamic and the capability keeps waiting — the same rule `entityReach`
  // follows for a computed key, and the same direction: fail closed.
  assert.deepEqual(invokedFunctions(`
    const r = await base44.functions.invoke(fnName, {});
  `), { names: [], dynamic: true });
  assert.deepEqual(invokedFunctions(`
    await base44.functions.invoke('known', {});
    await base44.functions[pick]('other', {});
  `), { names: ['known'], dynamic: true });
  for (const value of [null, undefined, 42, {}]) {
    assert.deepEqual(invokedFunctions(value), { names: [], dynamic: true });
  }
});

test('the callee is read from the call, never from the module that holds it', () => {
  // `asServiceRole` never reaches this bucket — `classifyPortBlocker` answers
  // `records_schema` for it first — and the same regex is what counts reaches
  // here, so the two agree about what a reach is.
  assert.equal(classifyPortBlocker("await base44.functions.invoke('x', {});"), 'ported_function');
  assert.equal(classifyPortBlocker("await base44.asServiceRole.functions.invoke('x', {});"),
    'records_schema');
  assert.deepEqual(invokedFunctions("await base44.asServiceRole.functions.invoke('x', {});"),
    { names: [], dynamic: false });
});

test('what is left once the call is not the reason is asked, not assumed', () => {
  // The sibling of `classifyWithoutEntities`, masked the same way. It needs no
  // entity masking: `records_schema` and `files` are answered BEFORE
  // `ported_function`, so a module reaching this verdict has neither.
  assert.equal(classifyWithoutInvocations("await base44.functions.invoke('x', {});"), 'none');
  assert.equal(classifyWithoutInvocations(
    "await base44.functions.invoke('x', {}); await base44.integrations.Core.SendEmail({});"),
  'core_integration');
  assert.equal(classifyWithoutInvocations(
    "await base44.functions.invoke('x', {}); const k = Deno.env.get('OPENAI_API_KEY');"),
  'external_secret');
  // And the real module: nothing but the call was ever holding it.
  assert.equal(discoverInvocationFreeBlockers(repository).extractReferralDataForSmartNote, 'none');
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

test('a capability whose only entities are the claims helper is not waiting on the record store', () => {
  // D74, and the fifth correction of this shape. The generated
  // `trustedCallerClaims` helper reads `AgencyMembership` and `Agency` to
  // answer ONE question — what tenant role does this caller hold — and the
  // ported service answers it from the request envelope. D34 settled that
  // those two are the authority store's native model.
  const claims = discoverClaimsOnlyFunctions(repository);
  // Measured, not asserted: the set is derived by removing the fence and
  // re-running the SAME extractor, so a module that also reads a real row
  // keeps its entities and is untouched.
  for (const name of claims) {
    const source = readFileSync(resolve(repository, 'base44/functions', name, 'entry.ts'), 'utf8');
    assert.ok(entitiesTouched(source).names.length > 0, `${name} touches entities`);
    const bare = entitiesTouched(source.replace(TRUSTED_CLAIMS_FENCE, ''));
    assert.deepEqual(bare.names, [], `${name} touches none outside the helper`);
    assert.equal(bare.dynamic, false, `${name} indexes no namespace`);
  }
  // The two the measurement finds, and what each one is.
  assert.deepEqual([...claims].sort(), ['autoImportPatients', 'sendAccountReadyEmail']);

  const report = checkCoverage(
    discoverCapabilities(repository),
    parseManifest(readFileSync(resolve(repository, 'tools-transition-disposition.json'), 'utf8')),
    discoverEvidence(repository),
  );
  // `sendAccountReadyEmail`'s whole body is one `Core.SendEmail`, so reporting
  // it as startable-today said a capability could be written whose only work
  // is the send D56 has not decided. The refinement that fixed that is still
  // what runs here — the claims fence is authorization, not records — and the
  // capability has since been written (D86), so it reads `none`. The check
  // that matters is unchanged: whatever it reads, it is not `records_schema`,
  // because its two entity reads never wanted the record store.
  assert.equal(report.port_blockers.records_schema.includes('sendAccountReadyEmail'), false);
  assert.ok(report.port_blockers.none.includes('sendAccountReadyEmail'));
  // And the refinement itself, asked directly, still answers what it did: a
  // port of this capability that had NOT been written would read
  // `core_integration` rather than `records_schema`.
  assert.equal(discoverEntityFreeBlockers(repository).sendAccountReadyEmail, 'core_integration');
  // `autoImportPatients` is `preserved_paused` and in no bucket, so the
  // refinement changes nothing for it — which is the check that this fires
  // where it should and nowhere else.
  for (const names of Object.values(report.port_blockers)) {
    assert.equal(names.includes('autoImportPatients'), false);
  }
  // The bucket reached zero under D75, by finding the last entry had been
  // paused at source all along, went to 3 under D84 — which is the queue
  // working rather than failing, since those are carried capabilities whose
  // one uncarried leg now has a named successor — and is 0 since D89, D90 and
  // D91 wrote all three. A count that only ever falls cannot represent work
  // arriving, and one that only ever rises is a queue nobody is clearing.
  //
  // The label on the last of them was wrong on this page until the module was
  // read. It was filed as carrying "two `Core.SendEmail` behind
  // `outboundDeliveryGate`"; it has ONE, and the branch it sits on is one the
  // module already refuses itself — D79's `generatePatientHandout` exactly, so
  // D81's partial shape served it. The other "SendEmail" was a docstring.
  assert.deepEqual(report.port_blockers.records_schema, []);
});

test('a flag pinned true pauses a handler exactly as one pinned false does', () => {
  // D75, and D47's failure for the third time — in a third shape, with the
  // same lesson: when a check exists to stop a class of mistake, re-derive the
  // shapes from the tree rather than from the check.
  const released = 'const RELEASED = false;\nif (!RELEASED) { return refusal(); }\n';
  const suspended = 'const THING_PAUSED = true;\nif (THING_PAUSED) { return refusal(); }\n';
  assert.equal(isPausedFunction(released), true, 'the shape D47 taught it');
  assert.equal(isPausedFunction(suspended), true, 'and the same pause written the other way');
  // Neither polarity fires without a RETURN in the guard's own branch: a flag
  // that merely logs is not a pause.
  assert.equal(isPausedFunction('const THING_PAUSED = true;\nif (THING_PAUSED) { log(); }\n'),
    false);
  // And a live flag is not a pause either way round.
  assert.equal(isPausedFunction('const RELEASED = true;\nif (!RELEASED) { return refusal(); }\n'),
    false, 'a true RELEASED with a negated guard is the live branch');

  // Thirteen modules in the tree use the flipped polarity, and the check saw
  // none of them. Twelve already carried `preserved_paused` because somebody
  // had read them; the thirteenth carried `port`.
  const paused = new Set(discoverPausedFunctions(repository));
  const manifest = parseManifest(
    readFileSync(resolve(repository, 'tools-transition-disposition.json'), 'utf8'));
  const flipped = ['createTelehealthToken', 'deduplicatePatients', 'dispatchScheduledSms',
    'generateMessageSuggestions', 'markMessageRead', 'messagingAssistant',
    'notifyUrgentMessage', 'processCompletedVisit', 'redriveFailedSms',
    'saveOasisResponses', 'scheduleSms', 'sendMessage', 'summarizeMessageThread'];
  for (const name of flipped) {
    const source = readFileSync(
      resolve(repository, 'base44/functions', name, 'entry.ts'), 'utf8');
    assert.match(source, /^const\s+[A-Z][A-Z0-9_]*\s*=\s*true\s*;/m, `${name} pins a flag`);
    assert.ok(paused.has(name), `${name} is detected as paused`);
    assert.equal(manifest.functions[name], 'preserved_paused',
      `${name} carries the disposition its source already had`);
  }
  // D47's rule: switching a capability off means changing its disposition in
  // the same change. `processCompletedVisit` was switched off long ago and the
  // disposition never caught up, so the gate contradicted it until it did.
  assert.equal(manifest.functions.processCompletedVisit, 'preserved_paused');
});
