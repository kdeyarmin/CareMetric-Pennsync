#!/usr/bin/env node
/**
 * Capability disposition coverage for the Base44 exit.
 *
 * The offline cutover evidence contract requires a disposition for every
 * capability in the census. This tool enumerates the repository's own
 * capabilities and checks that `tools-transition-disposition.json` classifies
 * each one exactly once, with no entry left over for a capability that no
 * longer exists.
 *
 * A `retire` disposition decides where a capability goes, not what happens to
 * the rows it already holds, so every retired entity also carries a retention
 * basis. Retiring a table is a decision about the target store; it is never an
 * instruction to delete anything.
 *
 * Coverage alone would let a disposition contradict the source it describes,
 * so each function's declared disposition is also checked against what its
 * module can actually do. A function that cannot perform any I/O has no live
 * behavior to move, and claiming otherwise would send reviewers to port a
 * deliberately fail-closed endpoint.
 *
 * It is deterministic and offline. It reads no secret, contacts no provider,
 * performs no hosted inventory and authorizes nothing. Coverage is not the
 * same as review: `undecided` entries are counted and reported as blocking,
 * and a manifest whose `review_state` is `proposed` never reports owner
 * review as complete.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPERATIONS } from './services/integration-runtime/contracts.mjs';

export const FORMAT = 'pennsync-transition-disposition';
export const FORMAT_VERSION = 2;
export const MANIFEST_FILE = 'tools-transition-disposition.json';
export const FAMILIES = Object.freeze(['functions', 'entities', 'workflows', 'integrations']);
export const DISPOSITIONS = Object.freeze(['port', 'broker', 'hub', 'retire', 'preserved_paused', 'undecided']);
export const REVIEW_STATES = Object.freeze(['proposed', 'accepted']);
/** Dispositions that assert the capability still has behavior worth carrying. */
export const ACTIVE_DISPOSITIONS = Object.freeze(['port', 'broker', 'hub']);
/** Only `accepted` plus zero undecided entries makes the census usable. */
export const BLOCKING = Object.freeze(['undecided']);
/** Dispositions whose rows need a retention basis before the capability goes. */
export const RETIRING_DISPOSITIONS = Object.freeze(['retire']);
/**
 * Where a retired entity's existing rows live afterwards.
 *
 * - `archive`   kept in the encrypted export archive for `years` years.
 * - `external_system_of_record`  another system already holds the record; the
 *   entity was only ever a mirror, and `system` names it.
 * - `none`      operational or synthetic rows that record nothing about a
 *   person and carry no identifier.
 */
export const RETENTION_BASES = Object.freeze(['archive', 'external_system_of_record', 'none']);

const SOURCE_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'];
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'coverage', '.git', 'test', 'tests', '__tests__']);
const INTEGRATION_PATTERN = /\bintegrations\s*\.\s*Core\s*\.\s*([A-Za-z][A-Za-z0-9_]{0,63})/g;

function listDirectories(path) {
  try { return readdirSync(path).filter(name => statSync(join(path, name)).isDirectory()).sort(); }
  catch { return []; }
}

function listFiles(path, match) {
  try { return readdirSync(path).filter(name => match.test(name)).sort(); }
  catch { return []; }
}

function* sourceFiles(root) {
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (entry.isSymbolicLink()) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      yield* sourceFiles(path);
    } else if (SOURCE_EXTENSIONS.some(extension => entry.name.endsWith(extension))
      && !/\.(test|spec)\./.test(entry.name)) {
      yield path;
    }
  }
}

/**
 * Discover the Core integrations this repository actually reaches for, rather
 * than trusting a hand-kept list. A newly used integration therefore appears
 * as missing coverage instead of passing unnoticed. The external runtime's own
 * operation list is unioned in, because an adapter it already implements is a
 * capability whether or not a caller has migrated to it yet.
 */
export function discoverIntegrations(repository) {
  const found = new Set(OPERATIONS);
  for (const root of ['src', 'base44/functions']) {
    for (const file of sourceFiles(join(repository, root))) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(INTEGRATION_PATTERN)) found.add(match[1]);
    }
  }
  return [...found].sort();
}

/**
 * A function module is inert when it cannot perform any work: it imports
 * nothing, awaits nothing, reaches no network or environment, constructs no
 * Base44 client, and reads nothing from the request but its method, so every
 * caller gets the same constant response. That is the shape this repository
 * uses to keep a quarantined, paused or retired endpoint fail-closed, and it is
 * decided from the source rather than from the wording of its comment or the
 * status code it happens to serve.
 *
 * Every condition errs toward calling a module live. A synchronous endpoint
 * that answers from its query string reads the request and is not inert, and an
 * `await`, `fetch` or client mention inside a comment is enough to disqualify
 * one. A missed pause is a disposition left as its author wrote it; a live
 * handler wrongly called inert would push real behavior out of `port`.
 */
export function isInertFunction(source) {
  if (typeof source !== 'string') return false;
  if (!/\bDeno\s*\.\s*serve\b/.test(source)) return false;
  if (/^\s*import\s/m.test(source)) return false;
  if (/\bawait\b/.test(source)) return false;
  if (/\bfetch\s*\(/.test(source)) return false;
  if (/\bDeno\s*\.\s*env\b/.test(source)) return false;
  if (/createClientFromRequest|\bbase44\s*\./.test(source)) return false;
  // Reading the request at all means the response can vary with the caller.
  // Branching on the method only is still one constant answer per method.
  return [...source.matchAll(/\b_?req(?:uest)?\s*\.\s*(\w+)/g)].every(match => match[1] === 'method');
}

/**
 * A function module is paused when a module-level flag pinned `false` gates its
 * handler with a refusal.
 *
 * This needs no heuristics. The flag is a `const` initialised to `false`, so
 * `if (!FLAG)` is always taken; establishing that the branch returns is enough
 * to know every caller is refused. Eighteen modules in this repository use the
 * shape, and eleven were already carried `preserved_paused` — the pattern is
 * the house style for switching a capability off at source.
 *
 * It is separate from `isInertFunction` because a paused module is usually NOT
 * inert: it still imports the SDK and awaits, it simply never reaches any of
 * it. That difference is why seven paused capabilities sat in the port queue as
 * writable work — the inert check could not see them, and a reader going by the
 * feature name would not either.
 *
 * Like the inert check, every condition errs toward calling a module live: a
 * flag that is merely read, or a guard that does not return, is not a pause.
 */
export function isPausedFunction(source) {
  if (typeof source !== 'string') return false;
  for (const match of source.matchAll(/^const\s+([A-Z][A-Z0-9_]*)\s*=\s*false\s*;/gm)) {
    const flag = match[1];
    const guard = source.search(new RegExp(`if\\s*\\(\\s*!\\s*${flag}\\s*\\)`));
    if (guard === -1) continue;
    // Only the guard's own branch counts. A fixed window would see the
    // handler's ordinary return further down and call a live module paused, so
    // the block is delimited rather than guessed.
    const rest = source.slice(source.indexOf(')', guard) + 1);
    const open = rest.indexOf('{');
    const statement = open === -1 || rest.slice(0, open).trim() !== ''
      ? rest.slice(0, rest.indexOf(';') + 1) // `if (!FLAG) return ...;`
      : (() => {
        let depth = 0;
        for (let index = open; index < rest.length; index += 1) {
          if (rest[index] === '{') depth += 1;
          else if (rest[index] === '}' && (depth -= 1) === 0) return rest.slice(open, index + 1);
        }
        return '';
      })();
    if (/\breturn\b/.test(statement)) return true;
  }
  return false;
}

export function discoverPausedFunctions(repository) {
  const root = join(repository, 'base44/functions');
  const paused = [];
  for (const name of listDirectories(root)) {
    let source;
    try { source = readFileSync(join(root, name, 'entry.ts'), 'utf8'); } catch { continue; }
    if (isPausedFunction(source)) paused.push(name);
  }
  return paused.sort();
}

/**
 * The entities a function's module actually touches.
 *
 * D16 checked the `broker` disposition on ENTITIES against their schemas and
 * found fourteen assigned by reading names. The same disposition on a FUNCTION
 * was never checked at all, and it claims more: that the capability can be
 * retired and served by the generic family instead. A function doing anything
 * the family cannot do is therefore mis-dispositioned, and only its module can
 * say which entities it reaches.
 *
 * Three access forms, because two of them defeated the obvious regex. A first
 * pass matching `entities.Name` reported six functions as touching only
 * brokered entities; reading them showed the number is zero. `getDashboardData`
 * aliases the NAMESPACE — `const sr = base44.asServiceRole.entities` — and then
 * reads `sr.Patient` and `sr.Visit`, so a scan for `entities.Patient` sees
 * nothing while the function reads every active patient. Destructuring
 * (`const { Agency } = base44.entities`) hides the same way.
 *
 * `dynamic` is separate from the name list and is never a pass: a module that
 * indexes the namespace with a computed key touches a set nothing here can
 * enumerate, so it cannot be shown to stay inside the family.
 */
export function entitiesTouched(source, known = null) {
  if (typeof source !== 'string') return { names: [], dynamic: false };
  const names = new Set();
  let dynamic = /entities\s*\[/.test(source);
  for (const match of source.matchAll(/entities\.([A-Z][A-Za-z0-9_]*)/g)) names.add(match[1]);
  for (const match of source.matchAll(/\{([^{}]*)\}\s*=\s*base44(?:\.asServiceRole)?\.entities/g)) {
    for (const part of match[1].split(',')) {
      const name = part.split(':')[0].trim();
      if (/^[A-Z][A-Za-z0-9_]*$/.test(name)) names.add(name);
    }
  }
  for (const match of source.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*base44(?:\.asServiceRole)?\.entities\s*[;\n]/g)) {
    const alias = match[1].replace(/[$]/g, '\\$&');
    for (const use of source.matchAll(new RegExp(`\\b${alias}\\.([A-Z][A-Za-z0-9_]*)`, 'g'))) names.add(use[1]);
    if (new RegExp(`\\b${alias}\\s*\\[`).test(source)) dynamic = true;
  }
  const list = [...names].filter(name => !known || known.has(name)).sort();
  return { names: list, dynamic };
}

export function discoverEntityReach(repository, known = null) {
  const root = join(repository, 'base44/functions');
  const reach = {};
  for (const name of listDirectories(root)) {
    let source;
    try { source = readFileSync(join(root, name, 'entry.ts'), 'utf8'); } catch { continue; }
    reach[name] = entitiesTouched(source, known);
  }
  return reach;
}

export function discoverInertFunctions(repository) {
  const root = join(repository, 'base44/functions');
  const inert = [];
  for (const name of listDirectories(root)) {
    let source;
    try { source = readFileSync(join(root, name, 'entry.ts'), 'utf8'); } catch { continue; }
    if (isInertFunction(source)) inert.push(name);
  }
  return inert.sort();
}

/**
 * Why a `port` cannot be written yet.
 *
 * The census says which capabilities are carried; it does not say which of them
 * anyone can act on. That turned out to matter: of the 86 functions dispositioned
 * `port`, exactly one could be written without something the transition has not
 * built yet, and it already has been. Reading the queue as "86 ports awaiting
 * review" would send someone to work that cannot start.
 *
 * The categories are deliberately about the blocker, not the feature:
 *
 * - `records_schema` — reads or writes entity rows, so it needs the ported
 *   record store and a tenant predicate for the entities it touches.
 * - `ported_function` — calls another Base44 function, so it waits on that one.
 * - `files` — reads or writes an uploaded file. The SSRF allowlist these
 *   handlers use names Base44's own storage host, so porting one verbatim would
 *   carry a Base44 dependency into the service the exit exists to remove, and
 *   the `cmfile:` handles that replace those URLs do not exist yet. It waits on
 *   the file layer, which is a phase of its own, rather than on the record
 *   store or the runtime.
 * - `core_integration` — calls a Core integration (an LLM, an extraction, a
 *   send) and touches no entity row. It needs the integration runtime's
 *   brokered path released, not the record store. This was counted as
 *   `records_schema` until it was measured: every one of these functions turned
 *   out to read nothing, so the queue was sending people to wait for a store
 *   they do not use — the exact failure the blocker categories exist to
 *   prevent.
 * - `pdf_rendering` — renders through `jspdf`; carrying it means adopting that
 *   dependency in the new service and deciding how to compare rendered output,
 *   which byte-for-byte parity cannot do.
 * - `external_secret` — calls a third-party API with a key from the environment,
 *   which belongs to the integration runtime's brokered path, not to a handler.
 * - `none` — portable today.
 *
 * Precedence runs from the most binding to the least: a function that both reads
 * rows and renders a PDF is blocked on the rows first.
 */
/**
 * Two of these are not properties of the module at all, which is why they are
 * applied after `classifyPortBlocker` rather than inside it.
 *
 * `records_schema` had come to mean "touches an entity", and a queue that says
 * 94 handlers are waiting on the record store is wrong twice over once the
 * modules are read against the dispositions. A third of them are waiting on a
 * decision nobody has taken, and the store arriving tomorrow would not move one
 * of them:
 *
 * - **`entity_not_carried`** — the module reads an entity dispositioned
 *   `retire`, `hub` or `preserved_paused`, so the table it wants will not exist
 *   here. It counted 34 until the three retired log tables were separated out
 *   from the rest (`AUDITED_ENTITIES`, below): 27 of the 34 were held by one of
 *   those and nothing else, and D25 gives all three a successor. Seven remain,
 *   and each reads a table from a domain that is genuinely going away — the
 *   training records, the paused comms logs, the real-time metrics.
 * - **`entity_authorization`** — the module reads a carried entity that has
 *   forced RLS and no policy. That is `User`, and it is deliberate: D14 left it
 *   "unreachable through this surface until a decision says how it may be
 *   read". D23 answers it — the roster is served from the authority store's
 *   membership rows rather than from the carried table — so what this bucket
 *   now counts is a roster read waiting on that RPC, not an undecided one.
 *
 * Both rank above `records_schema` because neither is helped by the store
 * existing, and `entity_not_carried` above `entity_authorization` because
 * whether a capability survives at all comes before how a table is read.
 */
export const PORT_BLOCKERS = Object.freeze(['entity_not_carried', 'entity_authorization', 'patient_access_model',
  'records_schema', 'files', 'ported_function', 'core_integration', 'pdf_rendering', 'external_secret', 'none']);
/** A disposition whose entity gets no table in the record store. */
export const UNCARRIED_DISPOSITIONS = Object.freeze(['retire', 'hub', 'preserved_paused']);
/**
 * Three representations of "who may see this patient" exist, and which one
 * governs has never been decided:
 *
 * 1. `pennsync_private.assignment` in the authority store, which
 *    `pennsync_private.context` ALREADY uses to scope a clinician;
 * 2. `PatientCareTeamAssignment`, carried into the record store as its own
 *    `port` entity;
 * 3. `Patient.assigned_nurses` — an array of emails — plus `created_by`, which
 *    is what every Base44 original actually reads.
 *
 * A capability reading the third cannot be ported until one of them is
 * authoritative, and the answer has to be the same for all of them or the
 * system contradicts itself about who may open a chart. It is not per-capability
 * contract work for that reason, and getting it wrong means a clinician cannot
 * see their own patient or can see somebody else's.
 */
export const CARE_TEAM_SIGNALS = Object.freeze(['assigned_nurses', 'PatientCareTeamAssignment']);

export function classifyPortBlocker(source) {
  if (typeof source !== 'string') return 'records_schema';
  // Dynamic access (`entities[name]`) reads rows exactly as the dotted form does.
  if (/\.\s*entities\s*[.[]|asServiceRole/.test(source)) return 'records_schema';
  // A file locator, the shared SSRF guard that only admits Base44's storage
  // hosts, or an upload/signing operation. Any of them means the handler is
  // bound to the old file layer.
  if (/\bfile_urls?\b|\bfileUrl\b|isSafeFetchUrl|UploadFile|UploadPrivateFile|CreateFileSignedUrl/.test(source)) {
    return 'files';
  }
  if (/\bbase44\s*\.\s*functions\b/.test(source)) return 'ported_function';
  if (/\.\s*integrations\s*\./.test(source)) return 'core_integration';
  if (/from\s+'npm:jspdf@/.test(source)) return 'pdf_rendering';
  if (/\bDeno\s*\.\s*env\s*\.\s*get\b/.test(source)) return 'external_secret';
  return 'none';
}

/**
 * Functions already written in the ported service, read from its own registry.
 *
 * Nothing blocks a port that has happened. Without this the classifier would go
 * on reporting `generateBagTechniquePDF` as blocked on PDF rendering because its
 * Base44 original still imports jsPDF — true of the original, and irrelevant.
 *
 * The registry is parsed rather than imported so this tool stays synchronous and
 * pulls in no service dependency. `tools-transition-disposition.test.mjs` checks
 * the parsed names against the module's own `HANDLER_NAMES`, so the parse cannot
 * drift from the registry it is reading.
 */
export function discoverPortedFunctions(repository) {
  let source;
  try { source = readFileSync(join(repository, 'services/pennsync-api/handlers.mjs'), 'utf8'); }
  catch { return []; }
  const start = source.indexOf('export const HANDLERS = Object.freeze({');
  if (start < 0) return [];
  const body = source.slice(start, source.indexOf('\n});', start));
  return [...body.matchAll(/^ {2}([A-Za-z][A-Za-z0-9_]*): Object\.freeze\(\{$/gm)]
    .map(match => match[1]).sort();
}

/**
 * The three retired log tables the general activity trail replaces (D25), and
 * whether that trail actually exists yet.
 *
 * `retire` decided where a table's EXISTING rows go, never whether the product
 * keeps auditing, and the two readings were indistinguishable in this queue: 27
 * of the 34 capabilities counted `entity_not_carried` are held by one of these
 * three and nothing else. Read as "no table for it exists here" they wait on a
 * schema that is never coming; read as "the successor is the activity trail"
 * they are ordinary ports.
 *
 * Which reading applies is a question about the repository, not about this
 * tool, so it is answered by looking for the migration. Delete
 * `20260920010000_activity_audit.sql` and all 27 go back to being blocked,
 * which is the correct answer in a tree that has no audit sink.
 */
export const AUDITED_ENTITIES = Object.freeze(['SecurityLog', 'SystemLog', 'UserActivity']);
export const ACTIVITY_TRAIL_MIGRATION =
  'services/authority-store/supabase/record-migrations/20260920010000_activity_audit.sql';

/** True when the store this branch commits actually has somewhere to audit to. */
export function discoverActivityTrail(repository) {
  try { return readFileSync(join(repository, ACTIVITY_TRAIL_MIGRATION), 'utf8').includes('activity_audit'); }
  catch { return false; }
}

export function discoverPortBlockers(repository) {
  const root = join(repository, 'base44/functions');
  const blockers = {};
  for (const name of listDirectories(root)) {
    let source;
    try { source = readFileSync(join(root, name, 'entry.ts'), 'utf8'); } catch { continue; }
    blockers[name] = classifyPortBlocker(source);
  }
  return blockers;
}

export function discoverEvidence(repository) {
  return {
    inertFunctions: discoverInertFunctions(repository),
    pausedFunctions: discoverPausedFunctions(repository),
    portBlockers: discoverPortBlockers(repository),
    portedFunctions: discoverPortedFunctions(repository),
    entityReach: discoverEntityReach(repository),
    policylessEntities: discoverPolicylessEntities(repository),
    careTeamDependents: discoverCareTeamDependents(repository),
    activityTrail: discoverActivityTrail(repository),
  };
}

/**
 * Carried entities with forced RLS and no policy, so nothing can read them.
 *
 * Read from the tenant paths rather than the SQL: `renderPolicies` emits a
 * comment instead of a policy for a `profile_claim`, and the path file is where
 * that verdict is recorded.
 */
/** Functions whose authorization depends on how care-team membership is represented. */
export function discoverCareTeamDependents(repository) {
  const root = join(repository, 'base44/functions');
  const dependents = [];
  for (const name of listDirectories(root)) {
    let source;
    try { source = readFileSync(join(root, name, 'entry.ts'), 'utf8'); } catch { continue; }
    if (CARE_TEAM_SIGNALS.some(signal => source.includes(signal))) dependents.push(name);
  }
  return dependents.sort();
}

export function discoverPolicylessEntities(repository) {
  let recorded;
  try {
    recorded = JSON.parse(readFileSync(join(repository, 'tools-tenant-path-expectations.json'), 'utf8')).entities;
  } catch { return []; }
  return (Array.isArray(recorded) ? recorded : [])
    .filter(entry => entry.kind === 'profile_claim').map(entry => entry.entity).sort();
}

export function discoverCapabilities(repository) {
  return {
    functions: listDirectories(join(repository, 'base44/functions')),
    entities: listFiles(join(repository, 'base44/entities'), /\.jsonc?$/).map(name => name.replace(/\.jsonc?$/, '')),
    workflows: listFiles(join(repository, 'base44/workflows'), /\.jsonc?$/),
    integrations: discoverIntegrations(repository),
  };
}

export function parseManifest(raw) {
  let manifest;
  try { manifest = JSON.parse(raw); } catch { throw new Error('MANIFEST_INVALID_JSON'); }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('MANIFEST_INVALID_SHAPE');
  if (manifest.format !== FORMAT || manifest.version !== FORMAT_VERSION) throw new Error('MANIFEST_UNSUPPORTED_FORMAT');
  if (!REVIEW_STATES.includes(manifest.review_state)) throw new Error('MANIFEST_INVALID_REVIEW_STATE');
  const allowed = new Set([...FAMILIES, 'format', 'version', 'review_state', 'retention', 'broker_ceiling']);
  if (Object.keys(manifest).some(key => !allowed.has(key))) throw new Error('MANIFEST_UNKNOWN_FIELD');
  // Per-field exemptions from D2's ceiling on `broker`, checked in full by
  // `tools-tenant-decision.mjs`, which can read the schemas. Only the shape is
  // settled here, so a malformed block fails at the manifest rather than later.
  const ceiling = manifest.broker_ceiling ?? {};
  if (typeof ceiling !== 'object' || Array.isArray(ceiling)) throw new Error('MANIFEST_INVALID_BROKER_CEILING');
  for (const entry of Object.values(ceiling)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('MANIFEST_INVALID_BROKER_CEILING');
    if (!Array.isArray(entry.fields) || !entry.fields.length
      || entry.fields.some(field => typeof field !== 'string' || !field)) {
      throw new Error('MANIFEST_INVALID_BROKER_CEILING');
    }
    if (typeof entry.because !== 'string' || entry.because.trim().length < 20) {
      throw new Error('MANIFEST_INVALID_BROKER_CEILING');
    }
  }
  const retention = manifest.retention;
  if (!retention || typeof retention !== 'object' || Array.isArray(retention)) throw new Error('MANIFEST_INVALID_RETENTION');
  for (const entry of Object.values(retention)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('MANIFEST_INVALID_RETENTION');
    if (!RETENTION_BASES.includes(entry.basis)) throw new Error('MANIFEST_INVALID_RETENTION_BASIS');
    if (!Number.isSafeInteger(entry.years) || entry.years < 0) throw new Error('MANIFEST_INVALID_RETENTION_YEARS');
    // An archive that keeps nothing for no time is not an archive, and a
    // mirror that cannot name its system of record has not identified one.
    if (entry.basis === 'archive' && entry.years < 1) throw new Error('MANIFEST_INVALID_RETENTION_YEARS');
    if (entry.basis !== 'archive' && entry.years !== 0) throw new Error('MANIFEST_INVALID_RETENTION_YEARS');
    if (entry.basis === 'external_system_of_record' && !(typeof entry.system === 'string' && entry.system.trim())) {
      throw new Error('MANIFEST_INVALID_RETENTION_SYSTEM');
    }
  }
  for (const family of FAMILIES) {
    const entries = manifest[family];
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error('MANIFEST_INVALID_FAMILY');
    for (const value of Object.values(entries)) {
      if (!DISPOSITIONS.includes(value)) throw new Error('MANIFEST_INVALID_DISPOSITION');
    }
  }
  return manifest;
}

export function checkCoverage(capabilities, manifest, evidence = {}) {
  const inert = new Set(Array.isArray(evidence.inertFunctions) ? evidence.inertFunctions : []);
  const paused = new Set(Array.isArray(evidence.pausedFunctions) ? evidence.pausedFunctions : []);
  const blockers = evidence.portBlockers && typeof evidence.portBlockers === 'object' ? evidence.portBlockers : {};
  const ported = new Set(Array.isArray(evidence.portedFunctions) ? evidence.portedFunctions : []);
  const reach = evidence.entityReach && typeof evidence.entityReach === 'object' ? evidence.entityReach : {};
  const policyless = new Set(Array.isArray(evidence.policylessEntities) ? evidence.policylessEntities : []);
  const careTeam = new Set(Array.isArray(evidence.careTeamDependents) ? evidence.careTeamDependents : []);
  // D25. With a trail to write to, a retired log table is a destination that
  // moved rather than one that vanished; without it, this set is empty and
  // every one of them still blocks.
  const audited = new Set(evidence.activityTrail ? AUDITED_ENTITIES : []);
  /**
   * What a module reads can make a `records_schema` verdict wrong, and only in
   * that direction: a blocker the source already named is never overridden,
   * because reaching a file or a Core integration is true whatever the rows are.
   */
  const refine = (blocker, name) => {
    if (blocker !== 'records_schema') return blocker;
    const touched = reach[name];
    // The first two need the entity set, so a module using a computed key is
    // left alone by them: nothing can be claimed about a set nothing can
    // enumerate.
    if (touched && !touched.dynamic) {
      for (const entity of touched.names) {
        const disposition = (manifest.entities || {})[entity];
        // `retire` only. The trail is the successor to a RETIRED log table; a
        // `hub` disposition names a different destination and a `preserved_
        // paused` one names none, so neither is answered by this table
        // existing even for an entity that shares a name with one of the three.
        if (disposition === 'retire' && audited.has(entity)) continue;
        if (UNCARRIED_DISPOSITIONS.includes(disposition)) return 'entity_not_carried';
      }
      if (touched.names.some(entity => policyless.has(entity))) return 'entity_authorization';
    }
    // The third does not, because reading `assigned_nurses` is a property of
    // the source text rather than of the entity set. Gating it behind the same
    // guard left `appendPatientNoteHistory` and `getAuthorizedPatientNoteHistory`
    // counted against the record store when what they wait on is this decision.
    // Last of the three because it is the narrowest: the tables exist and are
    // readable, and what is missing is which representation of care-team
    // membership authorizes a read of them.
    return careTeam.has(name) ? 'patient_access_model' : blocker;
  };
  const brokeredEntities = new Set(Object.keys(manifest.entities || {})
    .filter(entity => manifest.entities[entity] === 'broker'));
  const portQueue = Object.fromEntries(PORT_BLOCKERS.map(blocker => [blocker, []]));
  const families = {};
  const missing = [];
  const unknown = [];
  const undecided = [];
  const contradicted = [];
  const retention = manifest.retention || {};
  const retentionUnspecified = [];
  const retentionUnused = [];
  for (const family of FAMILIES) {
    const declared = manifest[family];
    const present = new Set(capabilities[family]);
    const counts = {};
    for (const name of capabilities[family]) {
      if (!Object.hasOwn(declared, name)) { missing.push(`${family}:${name}`); continue; }
      const value = declared[name];
      counts[value] = (counts[value] || 0) + 1;
      if (BLOCKING.includes(value)) undecided.push(`${family}:${name}`);
      // An endpoint that cannot run has nothing to port, broker or hand to the
      // hub; carrying it paused or retiring it are the only honest readings.
      if (family === 'functions' && inert.has(name) && ACTIVE_DISPOSITIONS.includes(value)) {
        contradicted.push(`${family}:${name} declared ${value} but its module performs no work`);
      }
      // Same reading for a capability switched off at source. Carrying it as
      // `port` claims work that cannot be written against behaviour that does
      // not run: the handler refuses before it reaches anything worth porting.
      // D7 already says paused domains are carried paused and ported only after
      // their own gate passes.
      if (family === 'functions' && paused.has(name) && ACTIVE_DISPOSITIONS.includes(value)) {
        contradicted.push(`${family}:${name} declared ${value} but its handler is paused at source`);
      }
      // D2's ceiling, on the function side. `broker` claims the capability can
      // be retired and served by the one generic family, so a module reaching
      // an entity that family does not serve is claiming something untrue —
      // and the family deliberately serves no clinical table. Measured over
      // all 33: `getDashboardData` reads every active patient and today's
      // visits through an aliased namespace while declared `broker`.
      // Only where the module was actually read. A module that could not be
      // opened is skipped by the inert and paused checks too, and asserting
      // "touches no entity" about a file nobody read would be a finding about
      // the reader.
      if (family === 'functions' && value === 'broker' && reach[name]) {
        const touched = reach[name];
        if (touched.dynamic) {
          contradicted.push(`${family}:${name} declared broker but indexes the entity namespace dynamically`);
        } else if (!touched.names.length) {
          // The family serves entities. A capability that touches none does
          // something else entirely — `sendWelcomeEmail` reaches
          // `Core.SendEmail` — and no entity family can be the thing that
          // replaces it.
          contradicted.push(`${family}:${name} declared broker but touches no entity the family could serve`);
        }
        for (const entity of touched.names) {
          if (!brokeredEntities.has(entity)) {
            contradicted.push(`${family}:${name} declared broker but reaches ${entity}, which the family does not serve`);
          }
        }
      }
      // Informational, never a gate: a port that becomes possible must not fail
      // the census, and a port that is written should move a count here.
      if (family === 'functions' && value === 'port') {
        portQueue[ported.has(name) ? 'none' : refine(blockers[name] ?? 'records_schema', name)].push(name);
      }
    }
    for (const name of Object.keys(declared)) if (!present.has(name)) unknown.push(`${family}:${name}`);
    // Retiring an entity leaves its rows behind. Naming where they go is part
    // of the decision, not a follow-up somebody remembers later.
    if (family === 'entities') {
      for (const name of capabilities[family]) {
        if (!RETIRING_DISPOSITIONS.includes(declared[name])) continue;
        if (!Object.hasOwn(retention, name)) retentionUnspecified.push(`${family}:${name}`);
      }
      for (const name of Object.keys(retention)) {
        if (!RETIRING_DISPOSITIONS.includes(declared[name])) retentionUnused.push(`${family}:${name}`);
      }
    }
    families[family] = { capabilities: capabilities[family].length, declared: Object.keys(declared).length, counts };
  }
  const complete = missing.length === 0 && unknown.length === 0;
  const consistent = contradicted.length === 0;
  const retentionSettled = retentionUnspecified.length === 0 && retentionUnused.length === 0;
  return {
    format: FORMAT,
    schema_version: FORMAT_VERSION,
    review_state: manifest.review_state,
    families,
    missing_disposition: missing.sort(),
    unknown_capability: unknown.sort(),
    undecided: undecided.sort(),
    coverage_complete: complete,
    inert_functions: inert.size,
    paused_functions: paused.size,
    contradicted_disposition: contradicted.sort(),
    evidence_consistent: consistent,
    retention_unspecified: retentionUnspecified.sort(),
    retention_unused: retentionUnused.sort(),
    retention_settled: retentionSettled,
    // What stands between each carried function and being written, so the queue
    // reads as work that can start rather than work awaiting review.
    port_blockers: Object.fromEntries(PORT_BLOCKERS.map(blocker => [blocker, portQueue[blocker].sort()])),
    // Every capability classified AND consistent with its source AND every
    // retirement's rows accounted for AND none left undecided AND owners accepted.
    census_ready: complete && consistent && retentionSettled
      && undecided.length === 0 && manifest.review_state === 'accepted',
    owner_review_complete: manifest.review_state === 'accepted',
    // This tool inventories the repository only.
    hosted_inventory_reconciled: false,
    migration_authorized: false,
  };
}

export function main(args = process.argv.slice(2), { repository = resolve(dirname(fileURLToPath(import.meta.url))), log = console.log } = {}) {
  if (args.some(argument => !['--json', '--summary'].includes(argument))) {
    log(JSON.stringify({ error: 'INVALID_ARGUMENTS' }));
    return 2;
  }
  let report;
  try {
    report = checkCoverage(
      discoverCapabilities(repository),
      parseManifest(readFileSync(join(repository, MANIFEST_FILE), 'utf8')),
      discoverEvidence(repository),
    );
  } catch (error) {
    log(JSON.stringify({ error: error?.message === 'ENOENT' ? 'MANIFEST_UNAVAILABLE' : (error?.message || 'MANIFEST_UNAVAILABLE') }));
    return 2;
  }
  if (args.includes('--summary')) {
    const totals = Object.entries(report.families)
      .map(([family, value]) => `${family}=${value.capabilities}`).join(' ');
    log(`disposition coverage ${report.coverage_complete ? 'complete' : 'INCOMPLETE'} (${totals}); `
      + `contradicted=${report.contradicted_disposition.length}; undecided=${report.undecided.length}; `
      + `retention_settled=${report.retention_settled}; `
      + `review_state=${report.review_state}; census_ready=${report.census_ready}`);
    for (const entry of report.contradicted_disposition) log(`  contradicted: ${entry}`);
    for (const entry of report.retention_unspecified) log(`  retirement with no retention basis: ${entry}`);
    for (const entry of report.retention_unused) log(`  retention basis for something not retired: ${entry}`);
    const queue = Object.entries(report.port_blockers).filter(([, names]) => names.length);
    log(`  port queue: ${queue.map(([blocker, names]) => `${blocker}=${names.length}`).join(' ') || 'empty'}`);
  } else {
    log(JSON.stringify(report, null, 2));
  }
  return report.coverage_complete && report.evidence_consistent && report.retention_settled ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main();
}
