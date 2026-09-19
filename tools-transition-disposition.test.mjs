import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACTIVE_DISPOSITIONS, DISPOSITIONS, FORMAT, FORMAT_VERSION, RETENTION_BASES, checkCoverage, discoverCapabilities,
  discoverEvidence, discoverInertFunctions, discoverIntegrations, isInertFunction, main, parseManifest,
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

test('the committed manifest never reports itself as reviewed or authorized', () => {
  const report = main(['--summary'], { repository, log: () => {} });
  assert.equal(report, 0);
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
