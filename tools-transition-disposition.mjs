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
export const FORMAT_VERSION = 3;
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
 * The SECOND shape a paused handler takes: the refusal is the first statement
 * of the handler itself, with the real body unreachable below it.
 *
 * This needs no heuristics either. `Deno.serve(async (req) => { return ... })`
 * refuses every caller whatever follows, and nine modules here do exactly that
 * — six of them carried `port`, and counted as writable work, because the flag
 * check below could not see a pause that uses no flag. That is the same
 * failure the flag check was written to fix, in a shape nobody re-measured.
 *
 * It errs toward calling a module live the same way: only a handler whose
 * opening brace is followed by nothing but comments and a `return` counts, so
 * a guard, an assignment or an `await` first is a live module.
 */
export function isRefusingHandler(source) {
  if (typeof source !== 'string') return false;
  const serve = source.search(/Deno\.serve\s*\(\s*(?:async\s*)?\(?\s*[A-Za-z_$][\w$]*\s*\)?\s*=>\s*\{/);
  if (serve === -1) return false;
  let body = source.slice(source.indexOf('{', serve) + 1);
  // Comments are not statements. A pause is normally introduced by one saying
  // why, so skipping them is the whole point rather than a convenience.
  for (;;) {
    const trimmed = body.replace(/^\s+/, '');
    if (trimmed.startsWith('//')) { body = trimmed.slice(trimmed.indexOf('\n') + 1); continue; }
    if (trimmed.startsWith('/*')) {
      const close = trimmed.indexOf('*/');
      if (close === -1) return false;
      body = trimmed.slice(close + 2);
      continue;
    }
    body = trimmed;
    break;
  }
  return /^return\b/.test(body);
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
  /*
   * D75. TWO polarities, because the tree uses both and this check knew one.
   *
   * `const RELEASED = false;` with `if (!RELEASED) return refusal` is the
   * shape D7 named and D47 taught this function. `const X_PAUSED = true;` with
   * `if (X_PAUSED) return refusal` is the same pause written the other way
   * round, and thirteen modules use it — twelve already carried
   * `preserved_paused` because somebody read them, and `processCompletedVisit`
   * carried `port` and was reported as the single capability left that could
   * be written against the record store. It refuses every caller.
   *
   * That is D47's failure for the third time and its own lesson for the third
   * time: when a check exists to stop a class of mistake, re-derive the shapes
   * from the tree rather than from the check.
   */
  const flags = [
    ...[...source.matchAll(/^const\s+([A-Z][A-Z0-9_]*)\s*=\s*false\s*;/gm)]
      .map(match => [match[1], `if\\s*\\(\\s*!\\s*${match[1]}\\s*\\)`]),
    ...[...source.matchAll(/^const\s+([A-Z][A-Z0-9_]*)\s*=\s*true\s*;/gm)]
      .map(match => [match[1], `if\\s*\\(\\s*${match[1]}\\s*\\)`]),
  ];
  for (const [, pattern] of flags) {
    const guard = source.search(new RegExp(pattern));
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
    if (isPausedFunction(source) || isRefusingHandler(source)) paused.push(name);
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
/** Operations that change a row, as the Base44 entity client spells them. */
export const MUTATING = Object.freeze(['create', 'update', 'delete', 'upsert',
  'bulkCreate', 'bulkUpdate', 'createMany', 'updateMany', 'deleteMany']);

export function entitiesTouched(source, known = null) {
  if (typeof source !== 'string') return { names: [], dynamic: false, writes: [] };
  const names = new Set();
  const writes = new Set();
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
  // Which of them the module WRITES, which is a different question from which
  // it touches and became one worth asking once a table could be readable and
  // unwritable at the same time. A reference to the entity followed by a
  // mutating call is the same shape in all three access forms above, so one
  // pass over the names finds it.
  const columns = {};
  for (const name of names) {
    const escaped = name.replace(/[$]/g, '\\$&');
    const call = new RegExp(`\\b${escaped}\\s*\\.\\s*(?:${MUTATING.join('|')})\\s*\\(`, 'g');
    if (!call.test(source)) continue;
    writes.add(name);
    // WHICH columns, not just that it writes. A store can permit a NARROWED
    // write — D82 lets a person change their own duty status and refuses every
    // other column of the same row — and "writes this entity" cannot tell a
    // capability the narrowing covers from one it does not.
    //
    // `null` means the payload could not be read, and it is not the same as
    // "no columns": `userManagement` passes an `updates` object assembled
    // earlier, so nothing here can say what it sets. Unknown is treated as
    // outside the narrowing, which is what keeps a payload nobody can see from
    // reading as a payload that writes nothing.
    columns[name] = writtenColumns(source, escaped);
  }
  const keep = name => !known || known.has(name);
  const list = [...names].filter(keep).sort();
  const written = [...writes].filter(keep).sort();
  return {
    names: list,
    dynamic,
    writes: written,
    writeColumns: Object.fromEntries(written.map(name => [name, columns[name]])),
  };
}

/**
 * The column names a module passes to a mutating call on one entity, or `null`
 * when any of those calls hands over something this cannot read.
 *
 * Deliberately shallow: it takes the top-level keys of an object literal and
 * refuses anything else — a spread, an identifier, a call. A nested object is
 * a column holding JSON, so its own keys are not columns and are not walked.
 */
export function writtenColumns(source, escaped) {
  const found = new Set();
  const call = new RegExp(`\\b${escaped}\\s*\\.\\s*(?:${MUTATING.join('|')})\\s*\\(`, 'g');
  for (const match of source.matchAll(call)) {
    const open = source.indexOf('{', match.index + match[0].length - 1);
    const stop = source.indexOf(')', match.index + match[0].length - 1);
    // A mutating call with no object literal before its closing paren is
    // passing a variable, a spread or nothing readable.
    if (open < 0 || (stop >= 0 && stop < open)) return null;
    let depth = 0; let end = -1;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) return null;
    const body = source.slice(open + 1, end);
    // Top level only: strip nested braces, brackets and parentheses so a JSON
    // column's own keys and a helper call's arguments are not mistaken for
    // columns of this table.
    let level = 0; let flat = '';
    for (const character of body) {
      if ('{[('.includes(character)) level += 1;
      else if (')]}'.includes(character)) level -= 1;
      else if (level === 0) flat += character;
      if (level === 0 && ')]}'.includes(character)) flat += ' ';
    }
    for (const part of flat.split(',')) {
      const key = part.split(':')[0].trim();
      if (!key) continue;
      // A spread, a shorthand or a computed key: the payload is not fully
      // readable, so the whole call is unknown rather than partly known.
      if (!/^[A-Za-z_$][\w$]*$/.test(key) && !/^'[a-z_][a-z0-9_]*'$/.test(key)) return null;
      found.add(key.replace(/'/g, ''));
    }
  }
  return [...found].sort();
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
 * - **`entity_authorization`** — the module WRITES a carried entity the store
 *   makes readable and not writable. It meant "reads a carried entity with
 *   forced RLS and no policy", which was `User` while D14 left it
 *   "unreachable through this surface until a decision says how it may be
 *   read". D23 ended that, and the bucket went on describing itself by the
 *   rule it no longer used: `User` has a read policy keyed on the authority
 *   store's roster, `discoverPolicylessEntities` is empty, and the roster RPC
 *   this paragraph said the eight were waiting for shipped as
 *   `contract_roster` with two handlers over it. So the read rule is a guard
 *   that fires on nothing, and what the bucket counts is the two populations
 *   a read policy does not help — six that UPDATE a profile, which D23 leaves
 *   deliberately open because the roster policy is read-only and nothing may
 *   settle that question by accident, and two that write `MedicareGuideline`,
 *   a `global` reference table no tenant surface may write. A seventh profile
 *   writer, `offboardUser`, is held by `entity_not_carried` first. The second
 *   population was always blocked and was never reported, because the
 *   classifier could not tell reading a table from writing one.
 *
 * Both rank above `records_schema` because neither is helped by the store
 * existing, and `entity_not_carried` above `entity_authorization` because
 * whether a capability survives at all comes before how a table is written.
 */
export const PORT_BLOCKERS = Object.freeze(['entity_not_carried', 'entity_authorization', 'patient_access_model',
  'records_schema', 'files', 'ported_function', 'core_integration', 'pdf_rendering', 'external_secret', 'none']);
/** A disposition whose entity gets no table in the record store. */
export const UNCARRIED_DISPOSITIONS = Object.freeze(['retire', 'hub', 'preserved_paused']);
/**
 * Three representations of "who may see this patient" existed, and which one
 * governs was the decision this bucket waited on:
 *
 * 1. `pennsync_private.assignment` in the authority store, which
 *    `pennsync_private.context` ALREADY uses to scope a clinician;
 * 2. `PatientCareTeamAssignment`, carried into the record store as its own
 *    `port` entity;
 * 3. `Patient.assigned_nurses` — an array of emails — plus `created_by`, which
 *    is what every Base44 original actually reads.
 *
 * D24 answered it, and with NONE of the three. `caller_assigned_patients`
 * reads `pennsync_private.chart_assignment` — a production table that the
 * staging `assignment` in (1) is not, and the two are not interchangeable —
 * and `tools-pennsync-assignment-backfill.mjs` carries (2) into it. (3) is
 * not merely unchosen but refused as a source: an address stays on the
 * patient row after its assignment is suspended, so reading those emails
 * again resurrects access somebody revoked.
 *
 * The signals stay because they are what enforces that answer rather than
 * what waits on it. `discoverCareTeamDependents` finds a module reading (2)
 * or (3); `discoverChartScope` asks whether BOTH halves of D24 are in this
 * tree, and every dependent is blocked again if either is deleted, which is
 * the right answer in a tree that has half of it. That is also why this was
 * never per-capability contract work: the answer has to be the same for all
 * of them or the system contradicts itself about who may open a chart, and
 * getting it wrong means a clinician cannot see their own patient or can see
 * somebody else's.
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

/**
 * D24's two halves, each read from the file that provides it.
 *
 * The decision named both and said neither is optional, and the reason is the
 * one that would not have been noticed: moving authority to
 * `pennsync_private.assignment` without carrying today's rows across means
 * every clinician loses access to their own patients at cutover. So a
 * capability that authorizes on care-team membership is blocked until BOTH
 * exist, and the queue answers that by looking rather than by asserting.
 *
 * Delete either file and the 36 are blocked again, which is the right answer
 * in a tree that has only half of it.
 */
export const CHART_SCOPE_EVIDENCE = Object.freeze({
  helper: 'services/authority-store/supabase/record-migrations/20260919170000_record_store.sql',
  backfill: 'tools-pennsync-assignment-backfill.mjs',
});
export function discoverChartScope(repository) {
  const holds = (file, token) => {
    try { return readFileSync(join(repository, file), 'utf8').includes(token); } catch { return false; }
  };
  return holds(CHART_SCOPE_EVIDENCE.helper, 'caller_assigned_patients')
    && holds(CHART_SCOPE_EVIDENCE.backfill, 'planBackfill');
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

/**
 * What would block a module if its ENTITY access were already served.
 *
 * `classifyPortBlocker` answers with the first thing it finds and entities come
 * first, which is right while the record store is the question. It stops being
 * right for a module whose only entity is one of D25's three retired log
 * tables: the trail IS that module's record half, already built, so
 * `records_schema` names something that is finished. Four such modules sat in
 * that bucket — two waiting on the file layer, one on `Core.SendEmail` and one
 * on a third-party key — and a reader going by the count would have started a
 * record contract for a capability whose records are done.
 *
 * The entity accesses are masked rather than the classifier reordered, because
 * the ORDER is correct for every module this does not apply to — with one
 * exception the store's own progress created. This comment used to end "a
 * capability that reads a chart AND uploads a file waits on the chart first",
 * which was true while the record store was the question and stopped being
 * true once it was built; `refine` uses this function's `files` verdict to say
 * so (D65). The masking is still how that is measured.
 */
export function classifyWithoutEntities(source) {
  if (typeof source !== 'string') return 'records_schema';
  return classifyPortBlocker(source
    .replace(/\.\s*entities\s*[.[]/g, '.$pennsyncMasked[')
    .replace(/asServiceRole/g, '$pennsyncMasked'));
}

/**
 * Which Base44 functions a module invokes, and whether the set can be enumerated.
 *
 * `ported_function` says in its own words that the capability "waits on that
 * one". Six ports later, the thing it waits on can already be written — and
 * the classifier goes on reporting the wait, because its rule is a single
 * unconditional `return` on the shape of the call rather than a question about
 * the callee. This reads the callee names so the wait can end.
 *
 * It fails CLOSED. Every `base44.functions` reach is counted, and only the two
 * shapes the tree actually uses are parsed — `invoke('name', …)` and
 * `fetch('/name', …)`, the second being a path. A reach this does not parse
 * (`testAutomations` invokes a name it was handed) leaves `dynamic` true, and
 * a dynamic set claims nothing, for the same reason `entityReach` claims
 * nothing about a computed key: a set nothing can enumerate cannot be shown to
 * be fully ported.
 */
export function invokedFunctions(source) {
  if (typeof source !== 'string') return { names: [], dynamic: true };
  const reaches = [...source.matchAll(/\bbase44\s*\.\s*functions\b/g)].length;
  const parsed = [...source.matchAll(
    /\bbase44\s*\.\s*functions\s*\.\s*(invoke|fetch)\s*\(\s*(?:'([^'\\]*)'|"([^"\\]*)")/g)];
  const names = parsed.map(match =>
    // `fetch` addresses the function by path; `invoke` names it directly.
    (match[1] === 'fetch' ? (match[2] ?? match[3]).replace(/^\//, '') : (match[2] ?? match[3])));
  return {
    names: [...new Set(names)].sort(),
    dynamic: parsed.length !== reaches || names.some(name => !name),
  };
}

export function discoverInvokedFunctions(repository) {
  const root = join(repository, 'base44/functions');
  const invoked = {};
  for (const name of listDirectories(root)) {
    let source;
    try { source = readFileSync(join(root, name, 'entry.ts'), 'utf8'); } catch { continue; }
    invoked[name] = invokedFunctions(source);
  }
  return invoked;
}

/**
 * What a module needs once the function it called is no longer a reason to
 * wait. The sibling of `classifyWithoutEntities`, and masked the same way.
 *
 * It needs no entity masking of its own: `classifyPortBlocker` answers
 * `records_schema` and `files` BEFORE `ported_function`, so a module that
 * reached this verdict has neither.
 */
export function classifyWithoutInvocations(source) {
  if (typeof source !== 'string') return 'records_schema';
  return classifyPortBlocker(source.replace(/\bbase44\s*\.\s*functions\b/g, '$pennsyncMasked'));
}

export function discoverInvocationFreeBlockers(repository) {
  const root = join(repository, 'base44/functions');
  const blockers = {};
  for (const name of listDirectories(root)) {
    let source;
    try { source = readFileSync(join(root, name, 'entry.ts'), 'utf8'); } catch { continue; }
    blockers[name] = classifyWithoutInvocations(source);
  }
  return blockers;
}

export function discoverEntityFreeBlockers(repository) {
  const root = join(repository, 'base44/functions');
  const blockers = {};
  for (const name of listDirectories(root)) {
    let source;
    try { source = readFileSync(join(root, name, 'entry.ts'), 'utf8'); } catch { continue; }
    blockers[name] = classifyWithoutEntities(source);
  }
  return blockers;
}

/**
 * The generated `trustedCallerClaims` helper, whose two entities are
 * AUTHORIZATION rather than records.
 *
 * It reads `AgencyMembership` and `Agency` to answer one question — what
 * tenant role does this caller hold — and the ported service answers it from
 * the request envelope instead: `resolveAuthority` runs on every request, and
 * D34 settled that those two are the authority store's native model rather
 * than anything `pennsync_records` was ever going to serve.
 *
 * So a module whose ENTIRE entity reach is inside that fence is not waiting on
 * the record store. Measured by removing the fence and re-running the same
 * extractor: a module that also reads a real row keeps its entities and is
 * untouched by this.
 */
export const TRUSTED_CLAIMS_FENCE =
  /\/\/ <<<BEGIN SHARED HELPER: trustedCallerClaims[\s\S]*?\/\/ <<<END SHARED HELPER: trustedCallerClaims>>>/g;

export function discoverClaimsOnlyFunctions(repository) {
  const root = join(repository, 'base44', 'functions');
  const names = new Set();
  let entries = [];
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return names; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    let source;
    try { source = readFileSync(join(root, entry.name, 'entry.ts'), 'utf8'); } catch { continue; }
    const whole = entitiesTouched(source);
    if (whole.dynamic || whole.names.length === 0) continue;
    const bare = entitiesTouched(source.replace(TRUSTED_CLAIMS_FENCE, ''));
    if (!bare.dynamic && bare.names.length === 0) names.add(entry.name);
  }
  return names;
}

export function discoverEvidence(repository) {
  return {
    inertFunctions: discoverInertFunctions(repository),
    pausedFunctions: discoverPausedFunctions(repository),
    portBlockers: discoverPortBlockers(repository),
    entityFreeBlockers: discoverEntityFreeBlockers(repository),
    invokedFunctions: discoverInvokedFunctions(repository),
    invocationFreeBlockers: discoverInvocationFreeBlockers(repository),
    portedFunctions: discoverPortedFunctions(repository),
    entityReach: discoverEntityReach(repository),
    entityPolicies: discoverEntityPolicies(repository),
    policylessEntities: discoverPolicylessEntities(repository),
    careTeamDependents: discoverCareTeamDependents(repository),
    activityTrail: discoverActivityTrail(repository),
    chartScope: discoverChartScope(repository),
    claimsOnlyFunctions: discoverClaimsOnlyFunctions(repository),
    columnNarrowing: discoverColumnNarrowing(repository),
    schedulerAuthFunctions: discoverSchedulerAuthFunctions(repository),
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

/**
 * What the generated record store actually permits, per entity, read from the
 * emitted policies rather than inferred from a tenant path.
 *
 * It was inferred: "kind is `profile_claim`" stood in for "has no policy",
 * which was true while a profile claim was the only thing that produced a
 * table with none. D23 ends that — `User` now has a read policy and no write
 * policy — and an inference that cannot tell those apart would have reported
 * all 43 of its readers unblocked along with the 8 that write it.
 *
 * Reading the SQL also makes the answer exact for every other entity: a
 * `global` table has always been readable and unwritable, and nothing until
 * now could say so.
 */
export function discoverEntityPolicies(repository) {
  let sql; let plan;
  try {
    sql = readFileSync(join(repository,
      'services/authority-store/supabase/record-migrations/20260919170000_record_store.sql'), 'utf8');
    plan = JSON.parse(readFileSync(join(repository, 'tools-entity-schema-plan-expectations.json'), 'utf8')).entities;
  } catch { return {}; }
  const byTable = new Map((Array.isArray(plan) ? plan : []).map(entry => [entry.table, entry.entity]));
  const policies = {};
  for (const [, table, verb] of sql.matchAll(/create policy "([a-z0-9_]+)_(read|insert|update|delete)" on /g)) {
    const entity = byTable.get(table);
    if (!entity) continue;
    policies[entity] ??= { read: false, write: false };
    if (verb === 'read') policies[entity].read = true; else policies[entity].write = true;
  }
  // A table the generator emitted with no policy at all is absent from that
  // scan, so it is added here as permitting nothing. Leaving it out would read
  // as "nothing is known", and nothing-known is how an unreadable table gets
  // treated as an ordinary one.
  for (const entry of Array.isArray(plan) ? plan : []) {
    policies[entry.entity] ??= { read: false, write: false };
  }
  return policies;
}

/** Carried entities with forced RLS and no read policy, so nothing can read them. */
export function discoverPolicylessEntities(repository) {
  const policies = discoverEntityPolicies(repository);
  return Object.keys(policies).filter(entity => !policies[entity].read).sort();
}

/**
 * Where the store permits only PART of a write, per entity, read from the
 * column guard it emits rather than from the decision that asked for it.
 *
 * D82 is the first narrowing of this kind: `user` gains an update policy and a
 * trigger that admits a named set of columns and raises on everything else. A
 * classifier that asked only "may this table be written" would report all eight
 * of its writers unblocked the moment that policy appeared, which is the same
 * mistake in the other direction as the one D23 caught — there the question was
 * reading versus writing, here it is writing versus writing SOME OF IT.
 *
 * The allowlist is parsed out of the generated SQL for the same reason the
 * policies are: a second copy kept by hand is a copy that drifts, and this one
 * would drift silently, because a column added to the guard and not added here
 * fails nothing.
 */
export function discoverColumnNarrowing(repository) {
  let sql; let plan;
  try {
    sql = readFileSync(join(repository,
      'services/authority-store/supabase/record-migrations/20260919170000_record_store.sql'), 'utf8');
    plan = JSON.parse(readFileSync(join(repository, 'tools-entity-schema-plan-expectations.json'), 'utf8')).entities;
  } catch { return {}; }
  const byTable = new Map((Array.isArray(plan) ? plan : []).map(entry => [entry.table, entry.entity]));
  const narrowing = {};
  for (const [, table, allowed] of sql.matchAll(
    /create function "pennsync_records"\."([a-z0-9_]+)_self_write_guard"\(\)[\s\S]*?array\[([^\]]*)\]/g)) {
    const entity = byTable.get(table);
    if (!entity) continue;
    narrowing[entity] = [...allowed.matchAll(/'([a-z_][a-z0-9_]*)'/g)].map(match => match[1]).sort();
  }
  return narrowing;
}

/**
 * Functions whose only caller is the scheduler, and why that decides a write.
 *
 * `schedulerAuth` admits a shared secret in place of a person. A narrowing
 * written as "the caller's own row" — which is what D82's update policy says,
 * naming `caller_user_id()` — admits nothing at all to such a caller, because
 * there is no caller to be. So a scheduled sweep is blocked by a self-scoped
 * write however harmless the columns it touches look: `autoEndDutyDay` writes
 * `duty_status` and `duty_on_since`, both of them inside D82's allowlist, on
 * every on-duty person in the deployment.
 *
 * Read from the shared-helper fence the generator stamps, so the signal is the
 * helper the module actually carries rather than a guess from its name.
 */
export const SCHEDULER_AUTH_FENCE = '<<<BEGIN SHARED HELPER: schedulerAuth';
export function discoverSchedulerAuthFunctions(repository) {
  const root = join(repository, 'base44/functions');
  const scheduled = [];
  for (const name of listDirectories(root)) {
    let source;
    try { source = readFileSync(join(root, name, 'entry.ts'), 'utf8'); } catch { continue; }
    if (source.includes(SCHEDULER_AUTH_FENCE)) scheduled.push(name);
  }
  return scheduled.sort();
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
  const allowed = new Set([...FAMILIES, 'format', 'version', 'review_state', 'retention', 'broker_ceiling',
    'uncarried_legs']);
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
  /*
   * D84. Which uncarried entity a carried capability may keep reaching, and
   * what serves that leg instead.
   *
   * `entity_not_carried` had come to mean "touches a table that will not exist
   * here", and for four of its seven members that was true of one leg of a
   * capability whose other eight were carried — `generateAIReport` waits on the
   * whole record store for two figures in one PDF block. Reading the bucket as
   * "blocked" sent people away from work that can start; reading it as "fine"
   * would drop an audit path in a regulated product without anybody noticing,
   * which is the loss D25 describes.
   *
   * So the leg is settled per capability and written down where it fails: the
   * entities, what serves them instead, and why. `because` is required and has
   * a floor, exactly as `broker_ceiling` requires one, because a reason nobody
   * had to write is a reason nobody wrote. `checkCoverage` then refuses an
   * entry that names a capability which does not reach those entities, so an
   * entry cannot outlive the leg it settles — the failure this repository has
   * now recorded nine times.
   */
  const legs = manifest.uncarried_legs ?? {};
  if (typeof legs !== 'object' || Array.isArray(legs)) throw new Error('MANIFEST_INVALID_UNCARRIED_LEGS');
  for (const entry of Object.values(legs)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('MANIFEST_INVALID_UNCARRIED_LEGS');
    if (!Array.isArray(entry.entities) || !entry.entities.length
      || entry.entities.some(entity => typeof entity !== 'string' || !entity)) {
      throw new Error('MANIFEST_INVALID_UNCARRIED_LEGS');
    }
    if (typeof entry.served_by !== 'string' || !entry.served_by.trim()) {
      throw new Error('MANIFEST_INVALID_UNCARRIED_LEGS');
    }
    if (typeof entry.because !== 'string' || entry.because.trim().length < 20) {
      throw new Error('MANIFEST_INVALID_UNCARRIED_LEGS');
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
  // What the store permits per entity, so a module that only reads a
  // read-only table is not held by the fact that it cannot write one.
  const settledLegs = Object.fromEntries(Object.entries(manifest.uncarried_legs || {})
    .map(([name, entry]) => [name, entry.entities]));
  const permits = evidence.entityPolicies && typeof evidence.entityPolicies === 'object'
    ? evidence.entityPolicies : {};
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
    /*
     * D76, and the sixth correction of the recurring shape — the first that
     * ends a wait rather than renaming one. `ported_function` means "calls
     * another Base44 function, so it waits on that one", and the queue kept
     * saying it after that one was written: the rule is an unconditional
     * `return` on the SHAPE of the call, and nothing ever asked who the callee
     * was.
     *
     * The five before it (D47, D55, D65, D74, D75) each corrected a bucket's
     * NAME. This one moves a capability from blocked to startable, so it is
     * also the answer to "what else is holding this": re-classify by what the
     * module needs once the call is not it.
     *
     * Every callee must be ported, and the set must be enumerable. A module
     * invoking a name it was handed claims nothing — the same rule
     * `entityReach` follows for a computed key.
     */
    if (blocker === 'ported_function') {
      const invoked = (evidence.invokedFunctions || {})[name];
      if (invoked && !invoked.dynamic && invoked.names.length > 0
        && invoked.names.every(callee => ported.has(callee))) {
        const rest = (evidence.invocationFreeBlockers || {})[name];
        if (rest && rest !== 'ported_function') return rest;
      }
    }
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
        // D84: a leg this capability's own manifest entry settles, naming what
        // serves it instead. Four of the seven this bucket held were a carried
        // capability with one uncarried leg — two figures in a PDF, a
        // fire-and-forget summary row — and reporting the whole of each as
        // blocked on a schema sent people away from work that could start. The
        // entry is checked against the reach below, so it cannot outlive the
        // leg; what it cannot do is settle a leg nobody wrote down.
        if ((settledLegs[name] || []).includes(entity)) continue;
        if (UNCARRIED_DISPOSITIONS.includes(disposition)) return 'entity_not_carried';
      }
      // Every entity it touches is a retired log table the trail already
      // serves, so the record store has nothing left to give this module.
      // Re-classify by what else it needs; see `classifyWithoutEntities`.
      if (touched.names.length > 0
        && touched.names.every(entity => (manifest.entities || {})[entity] === 'retire'
          && audited.has(entity))) {
        const rest = (evidence.entityFreeBlockers || {})[name];
        if (rest && rest !== 'records_schema') return rest;
      }
      /*
       * D74, and the fifth correction of this shape. A module whose ENTIRE
       * entity reach is the generated `trustedCallerClaims` helper is reading
       * AUTHORIZATION, not records: those two entities answer "what tenant
       * role does this caller hold", and the ported service answers it from
       * the request envelope — `resolveAuthority` runs on every request, and
       * D34 settled that `AgencyMembership` and `Agency` are the authority
       * store's native model.
       *
       * It sits beside the retired-log fall-through above because it is the
       * same sentence with a different reason: the record store has nothing
       * left to give this module, so re-classify by what else it needs. The
       * classifier had already computed that answer and was discarding it.
       */
      if ((evidence.claimsOnlyFunctions || new Set()).has(name)) {
        const rest = (evidence.entityFreeBlockers || {})[name];
        if (rest && rest !== 'records_schema') return rest;
      }
      if (touched.names.some(entity => policyless.has(entity))) return 'entity_authorization';
      // Readable but not writable. `User` is the one that matters — D23 serves
      // the roster and deliberately leaves the profile-write path open, so the
      // 7 `port` capabilities that update a profile stay blocked while the 39
      // that only read one do not. The same rule catches a module writing a
      // `global` reference table, which was never possible and was never
      // reported. Both counts are pinned against the tree by
      // `tools-transition-disposition.test.mjs`, because a number in a comment
      // is what drifted here twice: D75 moved three profile writers out of
      // `port` and the ports since moved readers into the shipped set.
      const written = Array.isArray(touched.writes) ? touched.writes : [];
      if (written.some(entity => permits[entity] && permits[entity].read && !permits[entity].write)) {
        return 'entity_authorization';
      }
      /*
       * Writable, but only in part. D82 gives `user` an update policy naming
       * `caller_user_id()` and a trigger admitting a named column set, which
       * makes "the store permits a write to this table" true and useless: it is
       * true of a person correcting their own telephone number and true of a
       * sweep rewriting everyone's approval flag.
       *
       * So a narrowed entity is admitted only where the narrowing demonstrably
       * covers the module, and both halves have to hold:
       *
       * - every column it writes is in the emitted allowlist, and the payload
       *   could be READ. An opaque payload is not an empty one — `userManagement`
       *   assembles `updates` and hands it over — so unknown counts as outside.
       * - the module has a caller. A self-scoped policy admits nothing to a
       *   scheduler secret, whatever columns it touches.
       *
       * What this leaves blocked is an administrative write path: changing
       * somebody else's row, or changing a column the subject may not assert
       * about themselves. That is the half D82 deliberately did not settle.
       */
      const narrowed = evidence.columnNarrowing && typeof evidence.columnNarrowing === 'object'
        ? evidence.columnNarrowing : {};
      const scheduled = new Set(evidence.schedulerAuthFunctions || []);
      const columns = (touched.writeColumns && typeof touched.writeColumns === 'object')
        ? touched.writeColumns : {};
      const outsideNarrowing = entity => {
        const allowed = narrowed[entity];
        if (!allowed) return false;
        if (scheduled.has(name)) return true;
        const uses = columns[entity];
        return !Array.isArray(uses) || uses.some(column => !allowed.includes(column));
      };
      if (written.some(outsideNarrowing)) return 'entity_authorization';
      /*
       * D65. `classifyWithoutEntities` says in its own comment that the order
       * is right because "a capability that reads a chart AND uploads a file
       * waits on the chart first". That was true while the record store was
       * the question. It is built now, with sixty-three ports over it and a
       * repeatable chart-read shape, while the file layer is still a data
       * migration, a `file_url` -> `cmfile:` compatibility layer and
       * thirty-one call sites. So the chart is not what these wait on, and
       * `records_schema` — which a reader takes as "startable today" — names
       * the wrong half.
       *
       * It comes AFTER the entity checks above on purpose: those name a
       * DECISION nobody has made, and a decision outranks work that is merely
       * large. This one fires only where the record half is otherwise clear.
       */
      if ((evidence.entityFreeBlockers || {})[name] === 'files') return 'files';
    }
    // The third does not, because reading `assigned_nurses` is a property of
    // the source text rather than of the entity set. Gating it behind the same
    // guard left `appendPatientNoteHistory` and `getAuthorizedPatientNoteHistory`
    // counted against the record store when what they wait on is this decision.
    // Last of the three because it is the narrowest: the tables exist and are
    // readable, and what is missing is which representation of care-team
    // membership authorizes a read of them.
    // D24. Both halves exist, so a care-team dependency is no longer a thing
    // to decide — it is a port to write, against a store that can answer.
    return careTeam.has(name) && !evidence.chartScope ? 'patient_access_model' : blocker;
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
  const legsUnused = [];
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
    // D84. A settled leg that no longer exists is the defect this repository
    // has recorded nine times, written down once more: an entry that outlives
    // the reach it describes goes on excusing a capability from a check
    // nothing fails. So an entry is refused unless its capability is still a
    // `port` here and still touches every entity it names. Repointing the leg,
    // porting it or retiring the capability each fail this until the entry
    // goes with it.
    if (family === 'functions') {
      for (const [name, entry] of Object.entries(manifest.uncarried_legs || {})) {
        const touched = (evidence.entityReach || {})[name];
        const stale = declared[name] !== 'port' || !touched || touched.dynamic
          || entry.entities.some(entity => !touched.names.includes(entity)
            || !UNCARRIED_DISPOSITIONS.includes((manifest.entities || {})[entity]));
        if (stale) legsUnused.push(`${family}:${name}`);
      }
    }
  }
  const complete = missing.length === 0 && unknown.length === 0;
  const consistent = contradicted.length === 0;
  const retentionSettled = retentionUnspecified.length === 0 && retentionUnused.length === 0;
  const legsSettled = legsUnused.length === 0;
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
    uncarried_legs_unused: legsUnused.sort(),
    // What stands between each carried function and being written, so the queue
    // reads as work that can start rather than work awaiting review.
    port_blockers: Object.fromEntries(PORT_BLOCKERS.map(blocker => [blocker, portQueue[blocker].sort()])),
    // Every capability classified AND consistent with its source AND every
    // retirement's rows accounted for AND none left undecided AND owners accepted.
    census_ready: complete && consistent && retentionSettled && legsSettled
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
