import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACTIVE_DISPOSITIONS, DISPOSITIONS, FORMAT, FORMAT_VERSION, PORT_BLOCKERS, RETENTION_BASES, checkCoverage,
  classifyPortBlocker, discoverCapabilities, discoverEvidence, discoverInertFunctions, discoverIntegrations,
  discoverPortBlockers, discoverPortedFunctions, isInertFunction, main, parseManifest,
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
  assert.deepEqual([...PORT_BLOCKERS], ['records_schema', 'ported_function', 'core_integration',
    'pdf_rendering', 'external_secret', 'none']);
  assert.equal(classifyPortBlocker("await base44.entities.Patient.filter({})"), 'records_schema');
  assert.equal(classifyPortBlocker("base44.asServiceRole.entities.Visit.list()"), 'records_schema');
  // Dynamic access reads rows exactly as the dotted form does.
  assert.equal(classifyPortBlocker("await base44.entities[name].filter({})"), 'records_schema');
  // A Core integration is NOT a record blocker. This asserted 'records_schema'
  // until the functions were read: all twelve of them touch no entity at all,
  // so the queue was holding them behind a store they never use. Their blocker
  // is the integration runtime's brokered path, which is deployed and paused.
  assert.equal(classifyPortBlocker("await base44.integrations.Core.InvokeLLM({})"), 'core_integration');
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

test('the port queue is work that cannot start yet, and says why', () => {
  // Reading the census as "86 ports awaiting review" would send someone to work
  // nothing in the repository can support. Exactly one of them was writable
  // without something the transition has not built, and it has been written.
  const report = checkCoverage(
    discoverCapabilities(repository),
    parseManifest(readFileSync(resolve(repository, 'tools-transition-disposition.json'), 'utf8')),
    discoverEvidence(repository),
  );
  const counts = Object.fromEntries(Object.entries(report.port_blockers).map(([key, names]) => [key, names.length]));
  assert.deepEqual(counts, { records_schema: 68, ported_function: 1, core_integration: 11,
    pdf_rendering: 0, external_secret: 1, none: 5 });
  // Twelve of these were counted against the record store until the functions
  // were read. Every one calls a Core integration and touches no entity row, so
  // what they wait on is the integration runtime's brokered path — already
  // deployed, and paused — not a store that does not exist. Naming them keeps
  // the correction from quietly reverting.
  assert.deepEqual(report.port_blockers.core_integration, [
    'analyzeReferral', 'analyzeReferralIntake', 'extractClinicalDocument',
    'extractPatientDataFromDocument', 'generateAdmissionNoteFromReferral', 'generateCarePlanFromReferral',
    'generateDynamicCoverSheet', 'generateReferralTasks', 'generateUserGuidePDF', 'matchPatientWithAI',
    'splitReferralPDF',
  ], 'analyzeReferralPriority left this list by being written, not by being reclassified');
  assert.deepEqual(report.port_blockers.none,
    ['analyzeReferralPriority', 'generateBagTechniquePDF', 'generateSmartNoteGuide', 'generateUserManual',
      'validatePatientData'],
    'the set of written ports changed');
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
