/**
 * Which of this store's own functions a migration CALLS while it is applying.
 *
 * D110 widened the classifier guard to both migration directories, and left the
 * body exclusion standing: a `PENNSYNC_*` code raised inside a `create function`
 * body is a refusal answered to a caller at runtime, not a migration failure, so
 * it is deliberately not in `MIGRATION_CODES`. That exclusion rests on a
 * property nobody was checking — that no such body can run while a migration is
 * applying. It held by observation and would have stopped holding silently.
 *
 * The tempting shape is to take every `pennsync_*` token outside a function body
 * and call it a reference. That is wrong here, and measurably: the do-block
 * preconditions contain 162 `to_regprocedure`/`to_regclass` existence lookups
 * naming contract functions, many of which do raise. **Over-approximating a
 * reference set does not make a ratchet safely stricter when the references are
 * mostly not calls** — it makes it fail on arrival and get deleted.
 *
 * So every occurrence is placed in a NAMED context, and anything this cannot
 * place is returned as `unclassified` for the caller to fail on. Nothing is
 * silently dropped: an unparsed shape is a red test, never a quiet pass.
 */
import { readdir, readFile } from 'node:fs/promises';

/** Dollar-quoted regions: `create function … as $tag$ … $tag$`, and `do $$ … $$`. */
const DOLLAR = /\$([A-Za-z_]*)\$([\s\S]*?)\$\1\$/g;
const STRING = /'(?:[^']|'')*'/g;
const QUALIFIED = /\b(pennsync_(?:private|records)\.[a-z_0-9]+)\s*\(/gi;
const RAISES = /message\s*=\s*'(PENNSYNC_[A-Z_]+)'/g;
/** A name in one of these positions is a RELATION, not a function being called. */
const RELATION_POSITION = /\b(?:on|into|from|join|update|references|table|only)\s+$/i;

/**
 * Statement kinds, and whether a call written in one runs while the migration
 * applies. `alter table` and `alter domain` are counted as executing because a
 * constraint added there is validated against the rows already present; a
 * `set default` in the same statement would be counted with them and is a false
 * positive we accept, since its remedy is somebody reading the statement and
 * the opposite error is the one this exists to prevent.
 */
const STATEMENT_KINDS = Object.freeze([
  [/^\s*(?:create|alter|drop)\s+(?:or\s+replace\s+)?(?:function|procedure)\b/i, 'function_ddl', false],
  [/^\s*(?:create|alter|drop)\s+(?:constraint\s+)?trigger\b/i, 'trigger_ddl', false],
  [/^\s*(?:grant|revoke)\b/i, 'grant', false],
  [/^\s*comment\s+on\b/i, 'comment', false],
  [/^\s*create\s+(?:unlogged\s+)?table\b/i, 'create_table', false],
  [/^\s*create\s+domain\b/i, 'create_domain', false],
  [/^\s*(?:create|alter|drop)\s+policy\b/i, 'policy_ddl', false],
  [/^\s*create\s+(?:unique\s+)?index\b/i, 'create_index', true],
  [/^\s*alter\s+table\b/i, 'alter_table', true],
  [/^\s*alter\s+domain\b/i, 'alter_domain', true],
  [/^\s*(?:select|perform)\b/i, 'query', true],
  [/^\s*insert\s+into\b/i, 'insert', true],
  [/^\s*update\b/i, 'update', true],
  [/^\s*delete\s+from\b/i, 'delete', true],
]);

const decomment = sql => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');

/**
 * A `create function` / `create procedure` header, read from the text before a
 * dollar-quoted region. The generated families declare with QUOTED identifiers
 * (`create function "pennsync_records"."broker_read"(…)`), so a bare
 * `[a-z_0-9.]+` misses them — and a missed declaration drops that function out
 * of the raising set, which is the silent direction.
 */
const DECLARATION = /create\s+(?:or\s+replace\s+)?(?:function|procedure)\s+("?[a-z_0-9]+"?\.?"?[a-z_0-9]*"?)\s*\(/gi;

function declaredNameIn(preceding) {
  // The LAST header wins: the text since the previous region can hold more than
  // one, and the one being closed is the nearest.
  let name = null;
  for (const match of decomment(preceding).matchAll(DECLARATION)) name = match[1];
  return name && name.toLowerCase().replace(/"/g, '');
}

/**
 * Split SQL into the function bodies it defines, the text that runs while it
 * applies, and the SQL it BUILDS. Every dollar-quoted region is one of three
 * things and the rule is what precedes it: `do $$ … $$` runs now, a region
 * after a `create function … as` is a body, and anything else is a dollar-quoted
 * string holding generated SQL.
 *
 * That third case is not hypothetical and stripping it was a real blind spot:
 * the deployment pin writes `deployment_app_id()` and `deployment_label()`
 * through `execute format($fn$ create function … $fn$)`, so the one function a
 * migration-time CHECK constraint actually calls had no readable body at all.
 * It raises nothing, so the answer was right — which is the way this kind of
 * gap survives. Recursing is what makes the answer measured rather than lucky.
 */
export function segment(sql) {
  const bodies = [];
  const dynamic = [];
  let executed = '';
  let last = 0;
  for (const match of sql.matchAll(DOLLAR)) {
    const preceding = sql.slice(last, match.index);
    executed += preceding;
    last = match.index + match[0].length;
    if (/\bdo\s*$/i.test(preceding)) {
      const inner = segment(match[2]);
      bodies.push(...inner.bodies);
      dynamic.push(...inner.dynamic);
      executed += ` ; ${inner.executed} ; `;
      continue;
    }
    const name = declaredNameIn(preceding);
    executed += ' ';
    if (name) {
      bodies.push({ name, text: match[2] });
      continue;
    }
    const inner = segment(match[2]);
    bodies.push(...inner.bodies);
    // Its statements run through EXECUTE, not here, so they are classified as
    // dynamic rather than inlined into the migration-time text.
    dynamic.push(inner.executed, ...inner.dynamic);
  }
  return { executed: executed + sql.slice(last), dynamic, bodies };
}

/**
 * The qualified names a function BODY reaches. Inside a body the direction of
 * safety reverses: an over-approximation here can only make the reachability
 * closure wider, and a wider closure can only turn the ratchet red for somebody
 * to resolve. At migration time the opposite holds — there an over-approximation
 * fails on arrival, which is why that side places every occurrence in a named
 * context instead. Same regex, opposite default, and the reason is which way
 * being wrong fails.
 */
function bodyCalls(text) {
  // One representation throughout: the offsets below index the decommented
  // copy, so the preceding text has to be read out of that same copy.
  const clean = decomment(text);
  const names = new Set();
  for (const match of clean.matchAll(QUALIFIED)) {
    if (!RELATION_POSITION.test(clean.slice(0, match.index))) names.add(match[1].toLowerCase());
  }
  return names;
}

function placeOccurrences(statement, source, into) {
  const kind = STATEMENT_KINDS.find(([pattern]) => pattern.test(statement));
  for (const match of statement.matchAll(QUALIFIED)) {
    const before = statement.slice(0, match.index);
    if (!kind) into.push({ ...source, name: match[1].toLowerCase(), kind: 'unclassified', calls: false, statement });
    else if (RELATION_POSITION.test(before)) into.push({ ...source, name: match[1].toLowerCase(), kind: `${kind[1]}:relation`, calls: false });
    else into.push({ ...source, name: match[1].toLowerCase(), kind: kind[1], calls: kind[2] });
  }
}

/** Every occurrence in one file's migration-time text, each placed in a context. */
export function occurrencesIn(sql, file) {
  const { executed, dynamic, bodies } = segment(sql);
  const found = [];
  for (const built of dynamic) {
    for (const statement of decomment(built).split(';')) {
      if (/\S/.test(statement)) placeOccurrences(statement.replace(STRING, "''"), { file, dynamic: true }, found);
    }
  }
  for (const statement of decomment(executed).split(';')) {
    if (!/\S/.test(statement)) continue;
    // Dynamic SQL names its objects inside a string literal, which the pass
    // below blanks out. Classify the literal's own text first, by the same
    // rules — a `create trigger … execute function f()` built with `format`
    // is a trigger definition wherever it is written.
    if (/\bexecute\b/i.test(statement)) {
      for (const literal of statement.match(STRING) || []) {
        placeOccurrences(literal.slice(1, -1).replace(/''/g, "'"), { file, dynamic: true }, found);
      }
    }
    placeOccurrences(statement.replace(STRING, "''"), { file, dynamic: false }, found);
  }
  return { occurrences: found, bodies };
}

/**
 * Read both migration directories and report, for the whole store: which of its
 * functions raise a `PENNSYNC_*` code, which are CALLED while a migration
 * applies, and every occurrence this could not place.
 */
export async function readMigrationTimeCalls(directories) {
  const called = new Map();
  const declared = new Map();
  const unclassified = [];
  for (const directory of directories) {
    for (const file of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
      const sql = await readFile(new URL(file, directory), 'utf8');
      const { occurrences, bodies } = occurrencesIn(sql, file);
      for (const body of bodies) {
        const codes = [...body.text.matchAll(RAISES)].map(match => match[1]);
        if (!body.name) continue;
        // `create or replace` in a later migration is the same function, so the
        // last definition wins rather than the union: a code a replacement
        // REMOVED must stop being attributed to it.
        declared.set(body.name, { codes: new Set(codes), calls: bodyCalls(body.text) });
      }
      for (const occurrence of occurrences) {
        if (occurrence.kind === 'unclassified') unclassified.push(occurrence);
        else if (occurrence.calls) {
          const sites = called.get(occurrence.name) || [];
          sites.push({ file: occurrence.file, kind: occurrence.kind, dynamic: occurrence.dynamic });
          called.set(occurrence.name, sites);
        }
      }
    }
  }
  // Derived rather than kept alongside: two representations of one fact is the
  // defect this whole file is about.
  const raising = new Map([...declared].filter(([, body]) => body.codes.size).map(([name, body]) => [name, body.codes]));
  return { raising, called, declared, unclassified };
}

/**
 * Every function a migration can reach from a migration-time call, following
 * what each body itself calls. `app_admitted` and `deployment_app_id` are both
 * named by a CHECK constraint of their own, so a depth-one reading finds the
 * pair either way and says nothing about the link between them — which is the
 * coincidence this walk removes. A name with no definition here is kept in the
 * result so the caller can see it rather than having it silently vanish.
 */
export function reachableFrom(seeds, declared) {
  const reached = new Set();
  const queue = [...seeds];
  while (queue.length) {
    const name = queue.pop();
    if (reached.has(name)) continue;
    reached.add(name);
    for (const next of declared.get(name)?.calls || []) queue.push(next);
  }
  return reached;
}
