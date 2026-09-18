import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FORMAT, ROLES, GATES, canonical, sha256, parseStrictJson, validateExpectations,
  bindingSha256, createCutoverCensus, checkCutoverEvidence, runCli,
} from './tools-pennsync-cutover.mjs';

const hash = value => sha256(value);
const git = value => hash(value).slice(0, 40);
const clone = value => structuredClone(value);
const NOW = '2026-09-18T04:00:00.000Z';
function fixture(mode = 'business_backend_exit') {
  const deployment = (label, origin, build = label) => ({ commit: git(`${build}-commit`), tree: git(`${build}-tree`), artifact_sha256: hash(`${build}-artifact`), origin, deployment_id: label });
  const actors = ROLES.map((role, i) => ({ role, subject_sha256: hash(role), agency_sha256: hash(i < 3 ? 'agency-a' : 'agency-b') }));
  const ids = ['source:base44/functions/getMyTenantContext/entry.ts', 'source:src/pages/Patients.jsx', 'target:src/pages/Patients.jsx', 'hosted:disabled-signing'];
  const census = { ids, sha256: hash('reviewed-census') };
  const e = {
    format: FORMAT, schema_version: 1, mode,
    source: { frontend: deployment('old-front', 'https://caremetricai.base44.app'), backend: deployment('old-back', 'https://base44.app') },
    target: { frontend: deployment('new-front', mode === 'business_backend_exit' ? 'https://caremetricai.base44.app' : 'https://app.caremetricai.com'), backend: deployment('new-back', 'https://api.caremetricai.com') },
    rehearsal: { frontend: deployment('stage-front', mode === 'business_backend_exit' ? 'https://staging.base44.app' : 'https://stage.caremetricai.com', 'new-front'), backend: deployment('stage-back', 'https://stage-api.caremetricai.com', 'new-back') },
    census_sha256: census.sha256, hosted_capabilities: ['hosted:disabled-signing'],
    public_endpoints: ['https://caremetricai.base44.app/', 'https://app.caremetricai.com/'],
    owner_subject_sha256: hash('protected-owner'), actors, minimum_observation_seconds: 600,
    evidence_not_before: '2026-09-18T00:00:00.000Z', evidence_not_after: '2026-09-18T03:00:00.000Z',
  };
  const claims = {
    inventory: { source_inventory_complete: true, target_inventory_complete: true, hosted_and_dynamic_resources_reviewed: true, no_unclassified_operations: true },
    identities: { actors, independent_authentication: true, owner_excluded: true },
    isolation: { positive: ['admin_a:A1', 'admin_a:A2', 'clinician_a:A1', 'admin_b:B1'], negative: ['admin_a:B1', 'clinician_a:A2', 'clinician_a:B1', 'clinician_a_empty:A1', 'clinician_a_empty:A2', 'clinician_a_empty:B1', 'admin_b:A1', 'admin_b:A2'], raw_response_assertions: true, empty_clinician_roster: true },
    revocation: { reads_denied_after_revocation: true, writes_denied_after_revocation: true, role_version_change_denied: true, stale_sessions_denied: true, inflight_disclosure_fenced: true },
    concurrency: { independent_clients: 2, duplicate_primary_records: 0, unique_constraints_verified: true, stale_updates_rejected: true, revocation_linearized: true, lost_response_reconciled: true },
    clinical: { patient_chart_passed: true, referral_create_accept_passed: true, visit_save_passed: true, supporting_artifacts_complete: true, retry_deduplicated: true },
    private_files: { source_sha256: hash('private-bytes'), download_sha256: hash('private-bytes'), authorized_download: true, foreign_actor_denied: true, revoked_actor_denied: true, expiry_and_renewal_verified: true },
    archive_restore: { source_rows: 100, restored_rows: 100, source_users: 4, restored_users: 4, source_files: 3, restored_files: 3, encrypted_backup: true, restore_rehearsed: true, record_manifest_reconciled: true, identity_mapping_reconciled: true, file_hashes_reconciled: true, references_reconciled: true, unexplained_conflicts: 0 },
    sessions: { old_sessions_invalidated: true, backend_identity_bound: true, cross_tab_logout_passed: true, idle_expiry_passed: true, stale_callbacks_denied: true, cached_phi_purged: true, draft_authority_preserved: true, recovery_login_passed: true },
    endpoints: { urls: e.public_endpoints, deep_links_preserved: true, legacy_file_urls_preserved: true, native_entry_preserved: true, static_compatibility_shell_retained: mode === 'business_backend_exit', base44_hosting_dependency: mode === 'business_backend_exit' },
    native: { ios_bundle: 'com.caremetric.ai', android_package: 'com.caremetic.ai', apple_store_id: '6757097720', physical_signed_ios: true, physical_signed_android: true, signing_continuity: true, launch_login_deep_links: true, camera_microphone: true, downloads_sharing: true, network_recovery: true, purchase_restore: true, entitlements_reconciled: true },
    rollback: { write_freeze_rehearsed: true, inflight_reconciled: true, target_delta_reconciled: true, prior_artifact_restored: true, records_files_verified: true, single_authority_restored: true, sessions_revalidated: true },
    cutover: { source_writes_frozen: true, inflight_reconciled: true, final_delta_reconciled: true, single_authority: true, source_data_retained: true, rollback_available: true, canary_passed: true, observation_seconds: 600, unresolved_errors: 0 },
    independence: { base44_api_blocked: true, base44_execution_calls: 0, fallback_calls: 0, business_workflows_passed: true, base44_hosting_dependency: mode === 'business_backend_exit', permanent_origin_preserved_without_base44_hosting: mode === 'complete_hosting_exit' },
    release_controls: { master_released: false, browser_released: false, operations: [], browser_operations: [] },
  };
  const receipts = new Map();
  const put = (kind, context, content, capturedAt = context === 'rehearsal' ? '2026-09-18T01:00:00.000Z' : '2026-09-18T02:00:00.000Z') => {
    const raw = JSON.stringify({ format: `${FORMAT}-receipt`, schema_version: 1, receipt_id: kind, binding_sha256: bindingSha256(e), kind, context, captured_at: capturedAt, deployment: context === 'production' ? e.target : e.rehearsal, result: 'pass', claims: content });
    const digest = hash(raw); receipts.set(digest, raw); return digest;
  };
  const evidence = { format: FORMAT, schema_version: 1, binding_sha256: bindingSha256(e), capabilities: [], gates: {} };
  for (const [name, rule] of Object.entries(GATES)) evidence.gates[name] = put(name, rule.context, claims[name]);
  const independent = ids.filter(id => !id.startsWith('hosted:'));
  const independentReceipt = put('capability_independent', 'production', { capability_ids: independent, base44_execution_calls: 0, outcomes_verified: true });
  const pausedReceipt = put('capability_preserved_paused', 'production', { capability_ids: [ids[3]], base44_execution_calls: 0, baseline_pause_verified: true, target_pause_verified: true });
  evidence.capabilities = ids.map(id => ({ id, state: id.startsWith('hosted:') ? 'preserved_paused' : 'independent', receipt_sha256: id.startsWith('hosted:') ? pausedReceipt : independentReceipt }));
  function replaceGate(name, change) {
    const old = JSON.parse(receipts.get(evidence.gates[name]));
    change(old);
    const raw = JSON.stringify(old); evidence.gates[name] = hash(raw); receipts.set(hash(raw), raw);
  }
  const run = () => checkCutoverEvidence({ expectations: e, evidence, census, loadReceipt: sha => receipts.get(sha), now: NOW });
  return { e, evidence, census, receipts, claims, put, replaceGate, run };
}
const blocked = (f, reason) => {
  const result = f.run();
  assert.equal(result.status, 'blocked');
  if (reason) assert.ok(result.blockers.includes(reason), JSON.stringify(result.blockers));
  assert.equal(result.release_authorized, false);
};

test('complete receipt coverage is not a verified migration or release authorization', () => {
  for (const mode of ['business_backend_exit', 'complete_hosting_exit']) {
    const f = fixture(mode), r = f.run();
    assert.equal(r.status, 'evidence_coverage_complete', JSON.stringify(r));
    assert.equal(r.scope, mode);
    assert.equal(r.base44_static_hosting_retained, mode === 'business_backend_exit');
    assert.equal(r.migration_independently_verified, false);
    assert.equal(r.manual_assertions_cryptographically_proven, false);
    assert.equal(r.release_authorized, false);
  }
});
test('every required gate must carry a retained, matching receipt', () => {
  for (const gate of Object.keys(GATES)) {
    const f = fixture(); f.receipts.delete(f.evidence.gates[gate]);
    blocked(f, `GATE_${gate.toUpperCase()}_INVALID`);
  }
});
test('bare success flags, malformed schemas and missing fields do not complete a migration', () => {
  for (const alteration of [e => { e.schema_version = 2; }, e => { e.complete = true; }, e => { delete e.gates.rollback; }, e => { e.capabilities = []; }, e => { e.gates = { success: true }; }]) {
    const f = fixture(); alteration(f.evidence); blocked(f);
  }
});
test('receipt bytes must match the referenced hash even when the result remains pass', () => {
  const f = fixture(), digest = f.evidence.gates.cutover;
  f.receipts.set(digest, f.receipts.get(digest) + ' '); blocked(f, 'GATE_CUTOVER_INVALID');
});
test('every receipt rejects a different build, deployment, target, source or expectation binding', () => {
  for (const mutate of [
    r => { r.deployment.backend.commit = git('different'); },
    r => { r.deployment.frontend.artifact_sha256 = hash('different'); },
    r => { r.deployment.backend.deployment_id = 'different'; },
    r => { r.deployment.backend.origin = 'https://foreign.example'; },
    r => { r.binding_sha256 = hash('different-source'); },
  ]) { const f = fixture(); f.replaceGate('cutover', mutate); blocked(f, 'GATE_CUTOVER_INVALID'); }
});
test('changing trusted source or target revisions invalidates all existing evidence', () => {
  for (const part of ['source', 'target']) {
    const f = fixture(); f.e[part].frontend.commit = git('new'); blocked(f);
  }
});
test('census cannot omit a source function or candidate feature or add an unknown capability', () => {
  for (const change of [f => { f.evidence.capabilities.pop(); }, f => { f.evidence.capabilities.push(clone(f.evidence.capabilities[0])); }, f => { f.evidence.capabilities[0].id = 'hosted:unknown'; }, f => { f.census.sha256 = hash('different'); }]) {
    const f = fixture(); change(f); blocked(f);
  }
});
test('per-capability receipt must name each capability, correct state, and no Base44 execution', () => {
  for (const mutate of [r => { r.claims.capability_ids = []; }, r => { r.claims.base44_execution_calls = 1; }, r => { r.claims.outcomes_verified = false; }, r => { r.kind = 'capability_preserved_paused'; }]) {
    const f = fixture(); const receipt = JSON.parse(f.receipts.get(f.evidence.capabilities[0].receipt_sha256)); mutate(receipt);
    const raw = JSON.stringify(receipt), digest = hash(raw); f.receipts.set(digest, raw);
    f.evidence.capabilities.filter(c => c.state === 'independent').forEach(c => { c.receipt_sha256 = digest; }); blocked(f, 'CAPABILITY_RECEIPT_INVALID');
  }
});
test('a newly disabled feature is not proven preserved merely by calling it paused', () => {
  const f = fixture(), c = f.evidence.capabilities[3], r = JSON.parse(f.receipts.get(c.receipt_sha256));
  r.claims.baseline_pause_verified = false; const raw = JSON.stringify(r); c.receipt_sha256 = hash(raw); f.receipts.set(hash(raw), raw);
  blocked(f, 'CAPABILITY_RECEIPT_INVALID');
});
test('four independent principals must be distinct, not owner, and correctly bound to two agencies', () => {
  for (const mutate of [e => { e.actors[0].subject_sha256 = e.owner_subject_sha256; }, e => { e.actors[1].subject_sha256 = e.actors[0].subject_sha256; }, e => { e.actors[3].agency_sha256 = e.actors[0].agency_sha256; }, e => { e.actors[2].role = 'owner'; }, e => { e.actors.pop(); }]) {
    const f = fixture(); mutate(f.e); blocked(f, 'EXPECTATIONS_INVALID');
  }
  const f = fixture(); f.replaceGate('identities', r => { r.claims.independent_authentication = false; }); blocked(f, 'GATE_IDENTITIES_INVALID');
});
test('negative-only probes and UI-only tests do not satisfy two-agency positives and raw denials', () => {
  for (const mutate of [r => { r.claims.positive = []; }, r => { r.claims.negative.pop(); }, r => { r.claims.raw_response_assertions = false; }, r => { r.claims.empty_clinician_roster = false; }]) {
    const f = fixture(); f.replaceGate('isolation', mutate); blocked(f, 'GATE_ISOLATION_INVALID');
  }
});
test('sequential test doubles and incomplete revocation/concurrency outcomes fail', () => {
  for (const [gate, mutate] of [
    ['concurrency', r => { r.claims.independent_clients = 1; }], ['concurrency', r => { r.claims.duplicate_primary_records = 1; }],
    ['concurrency', r => { r.claims.unique_constraints_verified = false; }], ['revocation', r => { r.claims.inflight_disclosure_fenced = false; }],
  ]) { const f = fixture(); f.replaceGate(gate, mutate); blocked(f, `GATE_${gate.toUpperCase()}_INVALID`); }
});
test('file metadata alone, mismatched bytes, lost users or missing restore proof fail', () => {
  for (const [gate, mutate] of [
    ['private_files', r => { r.claims.download_sha256 = hash('changed'); }], ['private_files', r => { r.claims.foreign_actor_denied = false; }],
    ['archive_restore', r => { r.claims.restored_users = 3; }], ['archive_restore', r => { r.claims.source_files = 0; r.claims.restored_files = 0; }],
    ['archive_restore', r => { r.claims.restore_rehearsed = false; }], ['archive_restore', r => { r.claims.unexplained_conflicts = 1; }],
  ]) { const f = fixture(); f.replaceGate(gate, mutate); blocked(f, `GATE_${gate.toUpperCase()}_INVALID`); }
});
test('stale sessions, DNS-only rollback, unobserved production and lack of device/billing proof fail', () => {
  for (const [gate, field] of [['sessions', 'old_sessions_invalidated'], ['rollback', 'target_delta_reconciled'], ['cutover', 'single_authority'], ['native', 'physical_signed_android'], ['native', 'purchase_restore'], ['endpoints', 'legacy_file_urls_preserved']]) {
    const f = fixture(); f.replaceGate(gate, r => { r.claims[field] = false; }); blocked(f, `GATE_${gate.toUpperCase()}_INVALID`);
  }
  const f = fixture(); f.replaceGate('cutover', r => { r.claims.observation_seconds = 599; }); blocked(f, 'GATE_CUTOVER_INVALID');
});
test('existing native spelling, identity, store id and public URLs cannot be replaced', () => {
  for (const [field, value] of [['ios_bundle', 'com.new.app'], ['android_package', 'com.caremetric.ai'], ['apple_store_id', 'new']]) {
    const f = fixture(); f.replaceGate('native', r => { r.claims[field] = value; }); blocked(f, 'GATE_NATIVE_INVALID');
  }
  const f = fixture(); f.e.public_endpoints = ['https://replacement.example/']; blocked(f, 'EXPECTATIONS_INVALID');
});
test('retained Base44 shell must not be labeled complete hosting exit', () => {
  const f = fixture(); f.e.mode = 'complete_hosting_exit'; blocked(f, 'EXPECTATIONS_INVALID');
  const g = fixture('complete_hosting_exit'); g.replaceGate('independence', r => { r.claims.base44_hosting_dependency = true; }); blocked(g, 'GATE_INDEPENDENCE_INVALID');
  const h = fixture(); h.replaceGate('endpoints', r => { r.claims.base44_hosting_dependency = false; }); blocked(h, 'GATE_ENDPOINTS_INVALID');
});
test('Base44 API fallback and prematurely enabled integration operations remain blockers', () => {
  for (const [gate, mutate] of [
    ['independence', r => { r.claims.fallback_calls = 1; }], ['independence', r => { r.claims.base44_api_blocked = false; }],
    ['release_controls', r => { r.claims.master_released = true; }], ['release_controls', r => { r.claims.browser_operations = ['SendEmail']; }],
  ]) { const f = fixture(); f.replaceGate(gate, mutate); blocked(f, `GATE_${gate.toUpperCase()}_INVALID`); }
});
test('unknown or secret-shaped fields at root, receipt, claims and actors fail without echo', () => {
  const sentinel = 'SECRET_DO_NOT_EMIT';
  for (const mutate of [r => { r.password = sentinel; }, r => { r.claims.token = sentinel; }, r => { r.deployment.backend.api_key = sentinel; }]) {
    const f = fixture(); f.replaceGate('cutover', mutate); blocked(f); assert.ok(!JSON.stringify(f.run()).includes(sentinel));
  }
  const f = fixture(); f.e.actors[0].email = sentinel; blocked(f, 'EXPECTATIONS_INVALID');
});
test('duplicate keys including escaped equivalents and excessive nesting are rejected', () => {
  assert.throws(() => parseStrictJson('{"result":"fail","result":"pass"}'));
  assert.throws(() => parseStrictJson(String.raw`{"a":1,"\u0061":2}`));
  assert.throws(() => parseStrictJson('['.repeat(50) + '0' + ']'.repeat(50)));
  assert.deepEqual(parseStrictJson('{"array":[{"a":1},{"a":2}],"b":true}'), { array: [{ a: 1 }, { a: 2 }], b: true });
});
test('malformed/future/out-of-window and wrong-context receipts cannot be reused', () => {
  for (const mutate of [r => { r.captured_at = '2026-02-30T01:00:00.000Z'; }, r => { r.captured_at = '2026-09-17T01:00:00.000Z'; }, r => { r.context = 'rehearsal'; }, r => { r.result = 'pending'; }, r => { r.kind = 'inventory'; }]) {
    const f = fixture(); f.replaceGate('cutover', mutate); blocked(f, 'GATE_CUTOVER_INVALID');
  }
  const f = fixture(); f.e.evidence_not_after = '2027-01-01T00:00:00.000Z'; blocked(f, 'EVIDENCE_WINDOW_INVALID');
});
test('rehearsal must precede cutover and final native/endpoint/runtime proof must follow it', () => {
  const f = fixture(); f.replaceGate('rollback', r => { r.captured_at = '2026-09-18T02:30:00.000Z'; }); blocked(f, 'REHEARSAL_AFTER_CUTOVER');
  const g = fixture(); g.replaceGate('native', r => { r.captured_at = '2026-09-18T01:59:00.000Z'; }); blocked(g, 'FINAL_PROOF_PRECEDES_CUTOVER');
});
test('receipt id collisions with different bytes are rejected', () => {
  const f = fixture(); f.replaceGate('native', r => { r.receipt_id = 'inventory'; }); blocked(f, 'GATE_NATIVE_INVALID');
});
test('Git census retains removed source handlers and adds target pages, excludes test files', () => {
  const f = fixture();
  const source = `100644 blob ${git('fn')}\tbase44/functions/oldFunction/entry.ts\0`;
  const front = `100644 blob ${git('page')}\tsrc/pages/New.jsx\0`;
  const extra = `100644 blob ${git('spec')}\tsrc/pages/New.spec.jsx\0`;
  const nested = `100644 blob ${git('nested')}\tservices/core/src/auth/session.mjs\0`;
  const schema = `100644 blob ${git('schema')}\tbase44/entities/User.jsonc\0`;
  const calls = [];
  const execFile = (_cmd, args) => {
    calls.push(args);
    if (args[0] === 'rev-parse') {
      const d = [f.e.source.frontend, f.e.source.backend, f.e.target.frontend, f.e.target.backend].find(v => args[1] === `${v.commit}^{tree}`);
      return d.tree;
    }
    return source + front + extra + nested + schema;
  };
  const result = createCutoverCensus(f.e, { execFile });
  assert.ok(result.ids.includes('source:base44/functions/oldFunction/entry.ts'));
  assert.ok(result.ids.includes('target:src/pages/New.jsx'));
  assert.ok(!result.ids.some(id => id.includes('.spec.')));
  assert.ok(result.ids.includes('hosted:disabled-signing'));
  assert.ok(result.ids.includes('target:services/core/src/auth/session.mjs'));
  assert.ok(result.ids.includes('source:base44/entities/User.jsonc'));
  assert.equal(calls.filter(c => c[0] === 'rev-parse').length, 4);
});
test('Git census refuses unexpected tree or symlink resource', () => {
  const f = fixture();
  assert.throws(() => createCutoverCensus(f.e, { execFile: () => git('wrong') }));
  assert.throws(() => createCutoverCensus(f.e, { execFile: (_c, args) => args[0] === 'rev-parse'
    ? [f.e.source.frontend, f.e.source.backend, f.e.target.frontend, f.e.target.backend].find(v => args[1] === `${v.commit}^{tree}`).tree
    : `120000 blob ${git('link')}\tsrc/pages/Patients.jsx\0` }));
});
test('CLI requires explicit check plus separately pinned files, never emits paths or parse contents', () => {
  const output = [], write = line => output.push(JSON.parse(line));
  assert.equal(runCli({ args: ['--apply'], env: {}, write }), 2);
  assert.equal(runCli({ args: ['--check'], env: {}, write }), 2);
  const dir = mkdtempSync(join(tmpdir(), 'pennsync-cutover-'));
  try {
    const path = join(dir, 'expectations.json'); writeFileSync(path, '{"secret":"SECRET_DO_NOT_EMIT"');
    const env = { PENNSYNC_CUTOVER_EXPECTATIONS_SHA256: hash('different'), PENNSYNC_CUTOVER_EXPECTATIONS_PATH: path, PENNSYNC_CUTOVER_EVIDENCE_PATH: join(dir, 'evidence.json'), PENNSYNC_CUTOVER_RECEIPTS_DIR: dir };
    assert.equal(runCli({ args: ['--check'], env, write }), 2);
    assert.ok(!JSON.stringify(output).includes('SECRET_DO_NOT_EMIT'));
    assert.ok(!JSON.stringify(output).includes(dir));
    assert.ok(output.every(r => r.mutations_performed === 0 && r.release_authorized === false));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('expectation validator rejects unsafe origins, mixed rehearsal builds and unsupported fields', () => {
  for (const mutate of [e => { e.target.backend.origin = 'https://api.base44.com'; }, e => { e.target.backend.origin = 'https://api.example/?token=secret'; }, e => { e.rehearsal.backend.artifact_sha256 = hash('other'); }, e => { e.minimum_observation_seconds = 0; }, e => { e.hosted_capabilities.push('hosted:../escape'); }, e => { e.target.backend.password = 'secret'; }]) {
    const f = fixture(); mutate(f.e); assert.equal(validateExpectations(f.e), false);
  }
});
test('canonical binding is order-independent but changes with any actual expectation', () => {
  assert.equal(canonical({ b: 2, a: 1 }), canonical({ a: 1, b: 2 }));
  const f = fixture(), before = bindingSha256(f.e); f.e.target.backend.deployment_id = 'other'; assert.notEqual(before, bindingSha256(f.e));
});
test('real CLI hashes retained files and reads the actual Git census without making migration claims', () => {
  const f = fixture();
  const options = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] };
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], options).trim();
  const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], options).trim();
  for (const pair of [f.e.source, f.e.target, f.e.rehearsal]) {
    for (const d of Object.values(pair)) { d.commit = commit; d.tree = tree; }
  }
  // Historical fixed window avoids depending on CI timezone/current clock.
  f.e.evidence_not_before = '2000-01-01T00:00:00.000Z';
  f.e.evidence_not_after = '2000-01-02T00:00:00.000Z';
  const census = createCutoverCensus(f.e); f.e.census_sha256 = census.sha256;
  f.evidence.binding_sha256 = bindingSha256(f.e);
  const independent = census.ids.filter(id => !id.startsWith('hosted:'));
  const byKind = new Map();
  const rewritten = new Map();
  for (const raw of f.receipts.values()) {
    const r = JSON.parse(raw);
    r.binding_sha256 = f.evidence.binding_sha256;
    r.deployment = r.context === 'production' ? f.e.target : f.e.rehearsal;
    r.captured_at = r.context === 'production' ? '2000-01-01T02:00:00.000Z' : '2000-01-01T01:00:00.000Z';
    if (r.kind === 'capability_independent') r.claims.capability_ids = independent;
    const changed = JSON.stringify(r), digest = hash(changed); rewritten.set(digest, changed); byKind.set(r.kind, digest);
  }
  for (const gate of Object.keys(GATES)) f.evidence.gates[gate] = byKind.get(gate);
  f.evidence.capabilities = census.ids.map(id => {
    const state = id.startsWith('hosted:') ? 'preserved_paused' : 'independent';
    return { id, state, receipt_sha256: byKind.get(`capability_${state}`) };
  });
  const dir = mkdtempSync(join(tmpdir(), 'pennsync-cutover-cli-'));
  try {
    const expectationPath = join(dir, 'expectations.json'), evidencePath = join(dir, 'evidence.json');
    const raw = JSON.stringify(f.e); writeFileSync(expectationPath, raw); writeFileSync(evidencePath, JSON.stringify(f.evidence));
    for (const [digest, content] of rewritten) writeFileSync(join(dir, `${digest}.json`), content);
    const env = { PENNSYNC_CUTOVER_EXPECTATIONS_PATH: expectationPath, PENNSYNC_CUTOVER_EXPECTATIONS_SHA256: hash(raw), PENNSYNC_CUTOVER_EVIDENCE_PATH: evidencePath, PENNSYNC_CUTOVER_RECEIPTS_DIR: dir };
    const output = []; const write = line => output.push(JSON.parse(line));
    assert.equal(runCli({ args: ['--check'], env, write }), 0, JSON.stringify(output));
    assert.equal(output[0].status, 'evidence_coverage_complete');
    assert.equal(output[0].migration_independently_verified, false);
    writeFileSync(join(dir, `${f.evidence.gates.rollback}.json`), '{}');
    assert.equal(runCli({ args: ['--check'], env, write }), 1);
    assert.ok(output[1].blockers.includes('GATE_ROLLBACK_INVALID'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
