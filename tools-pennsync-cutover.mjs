#!/usr/bin/env node
// Offline evidence integrity/coverage checking. No deployment, credential, DNS,
// database, network or release-control operation is implemented here.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORMAT = 'pennsync-external-cutover';
export const VERSION = 1;
export const ROLES = Object.freeze(['admin_a', 'clinician_a', 'clinician_a_empty', 'admin_b']);
export const MODES = Object.freeze(['business_backend_exit', 'complete_hosting_exit']);
const SHA = /^[a-f0-9]{64}$/;
const GIT = /^[a-f0-9]{40}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const MAX_BYTES = 2 * 1024 * 1024;
const own = (v, k) => Object.hasOwn(v, k);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const keys = (v, names) => object(v) && Object.keys(v).length === names.length && names.every(k => own(v, k));
const equal = (a, b) => canonical(a) === canonical(b);
const unique = values => Array.isArray(values) && new Set(values).size === values.length;
const integer = (v, min = 0) => Number.isSafeInteger(v) && v >= min;
const hex = (v, pattern = SHA) => typeof v === 'string' && pattern.test(v) && !/^0+$/.test(v);
const utc = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const sha256 = value => createHash('sha256').update(value).digest('hex');

// Reject duplicate keys as well as unknown fields; a last-key-wins parse must
// not let an operator accidentally hide contradictory receipt statements.
export function parseStrictJson(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > MAX_BYTES) throw new Error('INPUT_INVALID');
  const parsed = JSON.parse(raw);
  const tokens = raw.match(/"(?:\\.|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\],:]/g) || [];
  let position = 0;
  function value(depth = 0) {
    if (depth > 40) throw new Error('INPUT_INVALID');
    const token = tokens[position++];
    if (token === '{') {
      const seen = new Set();
      if (tokens[position] === '}') { position++; return; }
      do {
        const key = JSON.parse(tokens[position++]);
        if (seen.has(key)) throw new Error('INPUT_INVALID');
        seen.add(key);
        position++; // colon; the native parser already verified grammar
        value(depth + 1);
      } while (tokens[position++] === ',');
    } else if (token === '[') {
      if (tokens[position] === ']') { position++; return; }
      do { value(depth + 1); } while (tokens[position++] === ',');
    }
  }
  value();
  return parsed;
}

function httpsUrl(v, originOnly = false) {
  if (typeof v !== 'string' || v.length > 500) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash
      && (originOnly ? u.origin === v : u.href === v);
  } catch { return false; }
}
function base44Url(v) {
  const host = new URL(v).hostname.toLowerCase();
  return ['base44.app', 'base44.com', 'base44.io', 'base44.dev'].some(s => host === s || host.endsWith(`.${s}`));
}
function deployment(v) {
  return keys(v, ['commit', 'tree', 'artifact_sha256', 'origin', 'deployment_id'])
    && hex(v.commit, GIT) && hex(v.tree, GIT) && hex(v.artifact_sha256)
    && httpsUrl(v.origin, true) && typeof v.deployment_id === 'string' && ID.test(v.deployment_id);
}
function pair(v) { return keys(v, ['frontend', 'backend']) && deployment(v.frontend) && deployment(v.backend); }
function sameBuild(a, b) { return ['commit', 'tree', 'artifact_sha256'].every(k => a[k] === b[k]); }
function capabilityId(v) { return typeof v === 'string' && /^(?:source|target|hosted):[A-Za-z0-9_./: -]{1,240}$/.test(v) && v.trim() === v && !v.includes('..'); }

export function validateExpectations(v) {
  if (!keys(v, ['format', 'schema_version', 'mode', 'source', 'target', 'rehearsal', 'census_sha256',
    'hosted_capabilities', 'public_endpoints', 'owner_subject_sha256', 'actors', 'minimum_observation_seconds', 'evidence_not_before', 'evidence_not_after'])) return false;
  if (v.format !== FORMAT || v.schema_version !== VERSION || !MODES.includes(v.mode)
    || !pair(v.source) || !pair(v.target) || !pair(v.rehearsal) || !hex(v.census_sha256)
    || !integer(v.minimum_observation_seconds, 1) || !utc(v.evidence_not_before) || !utc(v.evidence_not_after)
    || Date.parse(v.evidence_not_before) >= Date.parse(v.evidence_not_after)
    || !unique(v.hosted_capabilities) || v.hosted_capabilities.length > 10000
    || v.hosted_capabilities.some(x => !capabilityId(x) || !x.startsWith('hosted:'))
    || !unique(v.public_endpoints) || !v.public_endpoints.length || v.public_endpoints.length > 100
    || v.public_endpoints.some(x => !httpsUrl(x)) || !hex(v.owner_subject_sha256)
    || !Array.isArray(v.actors) || v.actors.length !== 4) return false;
  if (!sameBuild(v.target.frontend, v.rehearsal.frontend) || !sameBuild(v.target.backend, v.rehearsal.backend)
    || v.target.backend.origin === v.rehearsal.backend.origin || base44Url(v.target.backend.origin)
    || base44Url(v.rehearsal.backend.origin)) return false;
  if (v.mode === 'complete_hosting_exit' && (base44Url(v.target.frontend.origin) || base44Url(v.rehearsal.frontend.origin))) return false;
  if (v.mode === 'business_backend_exit' && !base44Url(v.target.frontend.origin)) return false;
  if (!v.public_endpoints.includes('https://caremetricai.base44.app/')
    || !v.public_endpoints.includes('https://app.caremetricai.com/')) return false;
  for (let i = 0; i < ROLES.length; i++) {
    const a = v.actors[i];
    if (!keys(a, ['role', 'subject_sha256', 'agency_sha256']) || a.role !== ROLES[i]
      || !hex(a.subject_sha256) || a.subject_sha256 === v.owner_subject_sha256 || !hex(a.agency_sha256)) return false;
  }
  return unique(v.actors.map(a => a.subject_sha256))
    && v.actors.slice(0, 3).every(a => a.agency_sha256 === v.actors[0].agency_sha256)
    && v.actors[3].agency_sha256 !== v.actors[0].agency_sha256;
}

// Union of source and candidate Git inventories. Removed source functions are
// still required; unknown future hosted resources belong in reviewed additions.
// This is a file census, not whole-program call-graph proof.
export function createCutoverCensus(expectations, { cwd = process.cwd(), execFile = execFileSync } = {}) {
  const selected = p => /^base44\/functions\/[^/]+\/entry\.[cm]?[jt]s$/.test(p)
    || /^base44\/workflows\/[^/]+\.jsonc?$/.test(p)
    || /^base44\/entities\/[^/]+\.jsonc?$/.test(p)
    || (/^(?:src|services)\/.+\.(?:[cm]?[jt]sx?|sql)$/.test(p)
      && !/\.(test|spec)\./.test(p) && !/(?:^|\/)(?:test|tests|__tests__)\//.test(p));
  const records = [];
  for (const side of ['source', 'target']) {
    for (const part of ['frontend', 'backend']) {
      const pinned = expectations[side][part];
      const options = { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 };
      const tree = execFile('git', ['rev-parse', `${pinned.commit}^{tree}`], options).trim();
      if (tree !== pinned.tree) throw new Error('CENSUS_IDENTITY_MISMATCH');
      const raw = execFile('git', ['ls-tree', '-r', '-z', pinned.commit], options);
      for (const entry of raw.split('\0').filter(Boolean)) {
        const match = /^(\d+) blob ([a-f0-9]{40})\t(.+)$/.exec(entry);
        if (!match || !selected(match[3]) || (part === 'frontend') !== match[3].startsWith('src/')) continue;
        if (match[1] !== '100644' && match[1] !== '100755') throw new Error('CENSUS_UNSUPPORTED_FILE');
        records.push({ id: `${side}:${match[3]}`, blob: match[2] });
      }
    }
  }
  const byId = new Map();
  for (const r of records) {
    if (byId.has(r.id) && byId.get(r.id) !== r.blob) throw new Error('CENSUS_MIXED_COMPONENT_TREES');
    byId.set(r.id, r.blob);
  }
  for (const id of expectations.hosted_capabilities) byId.set(id, null);
  const inventory = [...byId].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([id, blob]) => ({ id, blob }));
  if (!inventory.some(r => r.id.startsWith('source:base44/functions/'))
    || !inventory.some(r => r.id.startsWith('target:src/pages/'))) throw new Error('CENSUS_INCOMPLETE');
  return { ids: inventory.map(r => r.id), sha256: sha256(canonical(inventory)) };
}

const booleans = (v, names) => keys(v, names) && names.every(k => v[k] === true);
const minimumMatrix = Object.freeze({
  positive: ['admin_a:A1', 'admin_a:A2', 'clinician_a:A1', 'admin_b:B1'],
  negative: ['admin_a:B1', 'clinician_a:A2', 'clinician_a:B1', 'clinician_a_empty:A1', 'clinician_a_empty:A2', 'clinician_a_empty:B1', 'admin_b:A1', 'admin_b:A2'],
});
export const GATES = Object.freeze({
  inventory: { context: 'production', check: v => booleans(v, ['source_inventory_complete', 'target_inventory_complete', 'hosted_and_dynamic_resources_reviewed', 'no_unclassified_operations']) },
  identities: { context: 'rehearsal', check: (v, e) => keys(v, ['actors', 'independent_authentication', 'owner_excluded']) && equal(v.actors, e.actors) && v.independent_authentication === true && v.owner_excluded === true },
  isolation: { context: 'rehearsal', check: v => keys(v, ['positive', 'negative', 'raw_response_assertions', 'empty_clinician_roster']) && equal(v.positive, minimumMatrix.positive) && equal(v.negative, minimumMatrix.negative) && v.raw_response_assertions === true && v.empty_clinician_roster === true },
  revocation: { context: 'rehearsal', check: v => booleans(v, ['reads_denied_after_revocation', 'writes_denied_after_revocation', 'role_version_change_denied', 'stale_sessions_denied', 'inflight_disclosure_fenced']) },
  concurrency: { context: 'rehearsal', check: v => keys(v, ['independent_clients', 'duplicate_primary_records', 'unique_constraints_verified', 'stale_updates_rejected', 'revocation_linearized', 'lost_response_reconciled']) && integer(v.independent_clients, 2) && v.duplicate_primary_records === 0 && ['unique_constraints_verified', 'stale_updates_rejected', 'revocation_linearized', 'lost_response_reconciled'].every(k => v[k] === true) },
  clinical: { context: 'rehearsal', check: v => booleans(v, ['patient_chart_passed', 'referral_create_accept_passed', 'visit_save_passed', 'supporting_artifacts_complete', 'retry_deduplicated']) },
  private_files: { context: 'rehearsal', check: v => keys(v, ['source_sha256', 'download_sha256', 'authorized_download', 'foreign_actor_denied', 'revoked_actor_denied', 'expiry_and_renewal_verified']) && hex(v.source_sha256) && v.source_sha256 === v.download_sha256 && ['authorized_download', 'foreign_actor_denied', 'revoked_actor_denied', 'expiry_and_renewal_verified'].every(k => v[k] === true) },
  archive_restore: { context: 'rehearsal', check: v => keys(v, ['source_rows', 'restored_rows', 'source_users', 'restored_users', 'source_files', 'restored_files', 'encrypted_backup', 'restore_rehearsed', 'record_manifest_reconciled', 'identity_mapping_reconciled', 'file_hashes_reconciled', 'references_reconciled', 'unexplained_conflicts']) && ['rows', 'users', 'files'].every(k => integer(v[`source_${k}`], 1) && v[`source_${k}`] === v[`restored_${k}`]) && ['encrypted_backup', 'restore_rehearsed', 'record_manifest_reconciled', 'identity_mapping_reconciled', 'file_hashes_reconciled', 'references_reconciled'].every(k => v[k] === true) && v.unexplained_conflicts === 0 },
  sessions: { context: 'rehearsal', check: v => booleans(v, ['old_sessions_invalidated', 'backend_identity_bound', 'cross_tab_logout_passed', 'idle_expiry_passed', 'stale_callbacks_denied', 'cached_phi_purged', 'draft_authority_preserved', 'recovery_login_passed']) },
  endpoints: { context: 'production', check: (v, e) => keys(v, ['urls', 'deep_links_preserved', 'legacy_file_urls_preserved', 'native_entry_preserved', 'static_compatibility_shell_retained', 'base44_hosting_dependency']) && equal(v.urls, e.public_endpoints) && ['deep_links_preserved', 'legacy_file_urls_preserved', 'native_entry_preserved'].every(k => v[k] === true) && v.static_compatibility_shell_retained === (e.mode === 'business_backend_exit') && v.base44_hosting_dependency === (e.mode === 'business_backend_exit') },
  native: { context: 'production', check: v => keys(v, ['ios_bundle', 'android_package', 'apple_store_id', 'physical_signed_ios', 'physical_signed_android', 'signing_continuity', 'launch_login_deep_links', 'camera_microphone', 'downloads_sharing', 'network_recovery', 'purchase_restore', 'entitlements_reconciled']) && v.ios_bundle === 'com.caremetric.ai' && v.android_package === 'com.caremetic.ai' && v.apple_store_id === '6757097720' && ['physical_signed_ios', 'physical_signed_android', 'signing_continuity', 'launch_login_deep_links', 'camera_microphone', 'downloads_sharing', 'network_recovery', 'purchase_restore', 'entitlements_reconciled'].every(k => v[k] === true) },
  rollback: { context: 'rehearsal', check: v => booleans(v, ['write_freeze_rehearsed', 'inflight_reconciled', 'target_delta_reconciled', 'prior_artifact_restored', 'records_files_verified', 'single_authority_restored', 'sessions_revalidated']) },
  cutover: { context: 'production', check: (v, e) => keys(v, ['source_writes_frozen', 'inflight_reconciled', 'final_delta_reconciled', 'single_authority', 'source_data_retained', 'rollback_available', 'canary_passed', 'observation_seconds', 'unresolved_errors']) && ['source_writes_frozen', 'inflight_reconciled', 'final_delta_reconciled', 'single_authority', 'source_data_retained', 'rollback_available', 'canary_passed'].every(k => v[k] === true) && integer(v.observation_seconds, e.minimum_observation_seconds) && v.unresolved_errors === 0 },
  independence: { context: 'production', check: (v, e) => keys(v, ['base44_api_blocked', 'base44_execution_calls', 'fallback_calls', 'business_workflows_passed', 'base44_hosting_dependency', 'permanent_origin_preserved_without_base44_hosting']) && v.base44_api_blocked === true && v.base44_execution_calls === 0 && v.fallback_calls === 0 && v.business_workflows_passed === true && v.base44_hosting_dependency === (e.mode === 'business_backend_exit') && v.permanent_origin_preserved_without_base44_hosting === (e.mode === 'complete_hosting_exit') },
  release_controls: { context: 'production', check: v => keys(v, ['master_released', 'browser_released', 'operations', 'browser_operations']) && v.master_released === false && v.browser_released === false && equal(v.operations, []) && equal(v.browser_operations, []) },
});

export function bindingSha256(expectations) { return sha256(canonical(expectations)); }

export function checkCutoverEvidence({ expectations, evidence, census, loadReceipt, now = new Date().toISOString() }) {
  const blockers = new Set();
  const report = () => ({ format: FORMAT, schema_version: VERSION,
    status: blockers.size ? 'blocked' : 'evidence_coverage_complete',
    scope: MODES.includes(expectations?.mode) ? expectations.mode : null,
    blockers: [...blockers].sort(),
    migration_independently_verified: false, manual_assertions_cryptographically_proven: false,
    release_authorized: false, mutations_performed: 0, network_requests: 0,
    base44_static_hosting_retained: expectations?.mode === 'business_backend_exit',
  });
  if (!validateExpectations(expectations)) { blockers.add('EXPECTATIONS_INVALID'); return report(); }
  const e = expectations;
  if (!utc(now) || Date.parse(e.evidence_not_after) > Date.parse(now)) blockers.add('EVIDENCE_WINDOW_INVALID');
  if (!keys(census, ['ids', 'sha256']) || !unique(census.ids) || !census.ids.length
    || census.ids.some(x => !capabilityId(x)) || census.sha256 !== e.census_sha256) {
    blockers.add('CENSUS_MISMATCH'); return report();
  }
  const binding = bindingSha256(e);
  if (!keys(evidence, ['format', 'schema_version', 'binding_sha256', 'capabilities', 'gates'])
    || evidence.format !== FORMAT || evidence.schema_version !== VERSION || evidence.binding_sha256 !== binding
    || !Array.isArray(evidence.capabilities) || evidence.capabilities.length > 10000
    || !keys(evidence.gates, Object.keys(GATES))) { blockers.add('EVIDENCE_INVALID'); return report(); }
  const cache = new Map();
  const receiptIds = new Map();
  function receipt(hash, kind, context) {
    if (!hex(hash)) return null;
    try {
      if (!cache.has(hash)) {
        const raw = loadReceipt(hash);
        if (typeof raw !== 'string' || sha256(raw) !== hash) return null;
        const r = parseStrictJson(raw);
        if (!keys(r, ['format', 'schema_version', 'receipt_id', 'binding_sha256', 'kind', 'context', 'captured_at', 'deployment', 'result', 'claims'])
          || r.format !== `${FORMAT}-receipt` || r.schema_version !== VERSION
          || typeof r.receipt_id !== 'string' || !ID.test(r.receipt_id) || r.binding_sha256 !== binding
          || !['production', 'rehearsal'].includes(r.context) || !utc(r.captured_at)
          || Date.parse(r.captured_at) < Date.parse(e.evidence_not_before) || Date.parse(r.captured_at) > Date.parse(e.evidence_not_after)
          || !equal(r.deployment, r.context === 'production' ? e.target : e.rehearsal)
          || r.result !== 'pass' || !object(r.claims)) return null;
        if (receiptIds.has(r.receipt_id) && receiptIds.get(r.receipt_id) !== hash) return null;
        receiptIds.set(r.receipt_id, hash);
        cache.set(hash, r);
      }
      const r = cache.get(hash);
      return r.kind === kind && r.context === context ? r : null;
    } catch { return null; }
  }
  const capabilities = new Map();
  for (const c of evidence.capabilities) {
    if (!keys(c, ['id', 'state', 'receipt_sha256']) || !capabilityId(c.id) || !['independent', 'preserved_paused'].includes(c.state) || capabilities.has(c.id)) {
      blockers.add('CAPABILITY_COVERAGE_INVALID'); continue;
    }
    capabilities.set(c.id, c);
  }
  if (!equal([...capabilities.keys()].sort(), [...census.ids].sort())) blockers.add('CAPABILITY_COVERAGE_MISMATCH');
  const checkedCapabilityReceipts = new Map();
  for (const c of capabilities.values()) {
    const cacheKey = `${c.state}:${c.receipt_sha256}`;
    if (checkedCapabilityReceipts.has(cacheKey)) {
      if (!checkedCapabilityReceipts.get(cacheKey)?.has(c.id)) blockers.add('CAPABILITY_RECEIPT_INVALID');
      continue;
    }
    const r = receipt(c.receipt_sha256, `capability_${c.state}`, 'production');
    const common = ['capability_ids', 'base44_execution_calls'];
    const specific = c.state === 'independent' ? ['outcomes_verified'] : ['baseline_pause_verified', 'target_pause_verified'];
    if (!r || !keys(r.claims, [...common, ...specific]) || !unique(r.claims.capability_ids)
      || !r.claims.capability_ids.length || r.claims.capability_ids.some(id => !capabilities.has(id) || capabilities.get(id).state !== c.state || capabilities.get(id).receipt_sha256 !== c.receipt_sha256)
      || !r.claims.capability_ids.includes(c.id) || r.claims.base44_execution_calls !== 0
      || !specific.every(k => r.claims[k] === true)) {
      checkedCapabilityReceipts.set(cacheKey, null);
      blockers.add('CAPABILITY_RECEIPT_INVALID');
    } else checkedCapabilityReceipts.set(cacheKey, new Set(r.claims.capability_ids));
  }
  const captured = new Map();
  for (const [gate, rule] of Object.entries(GATES)) {
    const r = receipt(evidence.gates[gate], gate, rule.context);
    if (!r || !rule.check(r.claims, e)) blockers.add(`GATE_${gate.toUpperCase()}_INVALID`);
    else captured.set(gate, Date.parse(r.captured_at));
  }
  // Production confirmation must follow a successful rollback rehearsal and
  // source restore. Old/future receipts cannot be relabeled as final acceptance.
  if (captured.has('cutover')) {
    for (const [gate, rule] of Object.entries(GATES)) {
      if (rule.context === 'rehearsal' && captured.has(gate) && captured.get(gate) > captured.get('cutover')) blockers.add('REHEARSAL_AFTER_CUTOVER');
    }
    for (const gate of ['independence', 'endpoints', 'native', 'release_controls']) {
      if (captured.has(gate) && captured.get(gate) < captured.get('cutover')) blockers.add('FINAL_PROOF_PRECEDES_CUTOVER');
    }
  }
  return report();
}

function readBounded(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) throw new Error('INPUT_INVALID');
  return readFileSync(path, 'utf8');
}
export function runCli({ args = process.argv.slice(2), env = process.env, cwd = process.cwd(), write = console.log } = {}) {
  const invalid = code => { write(JSON.stringify({ format: FORMAT, schema_version: VERSION, status: 'blocked', blockers: [code], release_authorized: false, mutations_performed: 0, network_requests: 0 })); return 2; };
  if (!equal(args, ['--check'])) return invalid('INVALID_ARGUMENTS');
  if (!hex(env.PENNSYNC_CUTOVER_EXPECTATIONS_SHA256) || !env.PENNSYNC_CUTOVER_EXPECTATIONS_PATH
    || !env.PENNSYNC_CUTOVER_EVIDENCE_PATH || !env.PENNSYNC_CUTOVER_RECEIPTS_DIR) return invalid('PINNED_INPUTS_REQUIRED');
  try {
    const raw = readBounded(env.PENNSYNC_CUTOVER_EXPECTATIONS_PATH);
    if (sha256(raw) !== env.PENNSYNC_CUTOVER_EXPECTATIONS_SHA256) return invalid('EXPECTATIONS_HASH_MISMATCH');
    const expectations = parseStrictJson(raw);
    if (!validateExpectations(expectations)) return invalid('EXPECTATIONS_INVALID');
    const evidence = parseStrictJson(readBounded(env.PENNSYNC_CUTOVER_EVIDENCE_PATH));
    const dir = resolve(env.PENNSYNC_CUTOVER_RECEIPTS_DIR);
    if (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink() || realpathSync(dir) !== dir) return invalid('RECEIPT_DIRECTORY_INVALID');
    const census = createCutoverCensus(expectations, { cwd });
    const report = checkCutoverEvidence({ expectations, evidence, census, loadReceipt: hash => readBounded(join(dir, `${hash}.json`)) });
    write(JSON.stringify(report));
    return report.status === 'evidence_coverage_complete' ? 0 : 1;
  } catch { return invalid('INPUT_OR_CENSUS_UNAVAILABLE'); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = runCli();
