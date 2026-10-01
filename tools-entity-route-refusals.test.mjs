/**
 * Why each refused call site is refused, and what unblocking it would take.
 *
 * `check:entity-routes` reports a figure it names accurately and which still
 * misleads: "N of those are sites a declared route REFUSES" reads as N things
 * to go and fix. Three separate hands have now spent real time discovering
 * that three of them are in a module with no caller — `retiredOfflineQueue.js`
 * says so in its own header, and says it has already started two
 * investigations from scratch for exactly this reason. This file is the third
 * one, written down.
 *
 * What it pins is the REASON, per site, measured rather than asserted:
 *
 *   * the three offline-queue sites are unreachable, proved by the import
 *     graph rather than by the header's own sentence;
 *   * the three `User.list` sites ask for a `full_name` order the roster
 *     deliberately refuses (`20260920630000_roster_display_name.sql` says why:
 *     the column is empty, so a name-sorted list would read in email order
 *     under a name heading) AND read fields the roster does not project at
 *     all, which is the half nothing else records.
 *
 * That second half is the load-bearing one. Serving the sort is a two-line
 * change and it would turn a loud refusal into a quiet wrong answer: the
 * approver filter reads `role` and `account_type`, which D23 keeps off the
 * roster ON PURPOSE because they are self-editable labels, and the three
 * Telnyx panels read `work_phone_number` and `personal_cell_e164`, which the
 * projection had never carried. A staffing screen would render nobody and a
 * provisioning screen would render nothing provisioned, both confidently.
 *
 * The panels are what this branch acts on, and it takes the other route: the
 * sites stopped reading the absent fields, so their entries came out here
 * exactly as the table's own rule prescribes — a ported site fails the
 * still-reads half. Note what the projection does and does NOT now carry, since
 * "ported" is not "the columns were added": `work_phone_number` is projected
 * under its own name and privileged-only, the two provisioning screens get
 * `has_work_phone` and `has_personal_cell` because they only ever COUNT, and
 * the personal cell is projected MASKED under a key of its own rather than as
 * `personal_cell_e164` — `20260920720000_roster_phone_provisioned.sql` says in
 * its own header why that indirection is load-bearing. So no entry here came out
 * because the roster started answering what it refused; each came out because
 * its site asks something else now.
 *
 * Serving the sort on its own would still be the defect described above, which
 * is why the paragraph stays.
 *
 * So this test fails if somebody makes a site pass the route while it still
 * reads an absent field, and it names the fields in the failure. It also fails
 * when a site stops reading them — that is a real port, and the entry comes
 * out in the same change.
 *
 * **The evidence is per SITE, and the first version of it was not.** It searched
 * the whole file for each field name, which accepted two kinds of false
 * evidence and was found in review rather than by this file:
 *
 *   * a PROSE mention. `NumberPoolPanel.jsx` names `work_phone_number` only in
 *     its header comment, so the table claimed a read that does not exist and
 *     the assertion passed. That entry named the cell alone until this branch
 *     ported the site and removed it; the finding is kept because the
 *     stripping it produced is what the remaining entries rest on.
 *   * a NEIGHBOUR'S read. `Timesheets.jsx` holds TWO refused sites, and a
 *     file-wide search answers identically for both — so the employee list,
 *     which asks nothing about `account_type`, was credited with the approver
 *     filter's read of it. The two entries now carry different field sets.
 *
 * Each entry therefore cites the EXPRESSION that reads its fields; the
 * expression must appear exactly once in the comment-stripped source, every
 * named field must be inside one of them, and no two entries for one file may
 * cite the same expression. The stripping is what makes the first case bite:
 * with comments left in, citing that header line passes.
 *
 * Worth noticing where the defect was: the import-graph test below already
 * stripped comments, and the roster projection parse strips comment lines and
 * says why. The technique was in this file twice and the one assertion that
 * needed it most did not use it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { servedSites } from './tools-entity-routes.mjs';
import { callArguments } from './tools-entity-call-arguments.mjs';
import { ENTITY_ROUTES } from './src/lib/independentEntityRoutes.js';

const REPOSITORY = resolve(import.meta.dirname);
const RETIRED = 'src/lib/retiredOfflineQueue.js';
const MINIMUM_REASON = 40;

/**
 * One entry per refused call site. `file` and `key` identify it; `because` is
 * the route's own refusal detail, so a site that starts refusing for a
 * different reason is a new row rather than a silent change of meaning.
 */
const REFUSALS = Object.freeze([
  {
    file: RETIRED, key: 'ComplianceAudit.filter', because: 'limit_required',
    reason: 'Unreachable. A one-word fix to code nothing calls; the module is marked DELETE AFTER ONE RELEASE.',
  },
  {
    file: RETIRED, key: 'Incident.filter', because: 'limit_required',
    reason: 'Unreachable, as above. The route is right to require a bound on an unfiltered read.',
  },
  {
    file: RETIRED, key: 'Task.filter', because: 'filter_field',
    reason: 'Unreachable, and `contract_task_list` has no `client_request_id` parameter: serving it would mean a forward migration and an RPC signature change for a call with no caller.',
  },
  {
    file: 'src/pages/TimeOff.jsx', key: 'User.list', because: 'sort',
    absent: ['account_type', 'role'],
    reads: ['u.role === "admin" || u.account_type === "agency_admin" || u.is_manager === true'],
    reason: 'Needs the roster port and a decision: its approver filter reads `role` and `account_type`, which D23 keeps off the roster deliberately, so who may approve has to be re-expressed as a tenant role.',
  },
  {
    file: 'src/pages/Timesheets.jsx', key: 'User.list', because: 'sort',
    absent: ['account_type', 'role'],
    reads: ['u.role === "admin" || u.account_type === "agency_admin" || u.is_manager === true'],
    reason: 'Needs the roster port and a decision: this page\'s approver filter reads `role` and `account_type`, which D23 keeps off the roster deliberately, so who may approve has to be re-expressed as a tenant role.',
  },
  {
    file: 'src/pages/Timesheets.jsx', key: 'User.list', because: 'sort',
    absent: ['role'],
    reads: ['u.email && u.role === "user" && u.is_active !== false'],
    reason: 'The second of this page\'s two roster reads, and a DIFFERENT field set: the employee list filters `role === "user"`, which the roster cannot answer, and it asks nothing about `account_type`. Listed separately because each call is its own site.',
  },
]);

const identity = site => `${site.file} ${site.key}:${site.because}`;

/**
 * Source with block and line comments removed.
 *
 * The import-graph test below already did this and the roster projection parse
 * strips comment lines for the same reason; the field evidence did not, and a
 * review caught it. `NumberPoolPanel.jsx` names `work_phone_number` ONLY in its
 * header comment, so the table claimed a read that does not exist and the
 * assertion passed. A prose mention is not a read.
 */
const withoutComments = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

function measured() {
  const calls = callArguments(REPOSITORY);
  return servedSites(REPOSITORY, ENTITY_ROUTES, calls.length).refused;
}

/** The keys the LAST definition of `roster_entry` projects. */
function rosterProjection() {
  const directory = 'services/authority-store/supabase/record-migrations/';
  const defining = readdirSync(resolve(REPOSITORY, directory))
    .filter(name => name.endsWith('.sql')).sort()
    .filter(name => /create (or replace )?function "pennsync_records"\.roster_entry\(/
      .test(readFileSync(resolve(REPOSITORY, directory + name), 'utf8')));
  assert.ok(defining.length > 0, 'roster_entry is defined somewhere');
  const sql = readFileSync(resolve(REPOSITORY, directory + defining.at(-1)), 'utf8');
  const open = sql.search(/create (or replace )?function "pennsync_records"\.roster_entry\(/);
  const body = sql.slice(sql.indexOf('jsonb_build_object(', open),
    sql.indexOf('$projection$;', open));
  // Comment lines first: the block explains which columns it deliberately does
  // NOT carry, and naming one there would read as projecting it.
  const code = body.split('\n').filter(line => !line.trim().startsWith('--')).join('\n');
  const keys = [...code.matchAll(/^\s*'([a-z_0-9]+)',/gm)].map(match => match[1]);
  assert.ok(keys.includes('email') && keys.includes('tenant_role'),
    'the projection parse found the keys it should');
  return keys;
}

test('every refused call site is one this file explains', () => {
  const found = measured().map(identity).sort();
  assert.deepEqual(found, REFUSALS.map(identity).sort(),
    'a refused site arrived or left; add or remove its entry with a reason');
  for (const entry of REFUSALS) {
    assert.ok(entry.reason.length >= MINIMUM_REASON,
      `${identity(entry)} needs a reason somebody can act on`);
  }
});

test('the three offline-queue sites are unreachable, by the import graph', () => {
  // The module's header states this. Proving it here rather than quoting it,
  // because a header is not a measurement and this one has already been read
  // past twice.
  // Deleting the module must BREAK this rather than satisfy it. The set
  // assertion above already fails when three refusals disappear, and this
  // says it in the place somebody deleting the file will read: the three
  // entries come out in the same change, and whoever removes them has to look
  // at what they said on the way past.
  assert.ok(existsSync(resolve(REPOSITORY, RETIRED)),
    `${RETIRED} is gone; delete its three entries above in this same change`);
  const offline = measured().filter(call => call.file === RETIRED);
  assert.equal(offline.length, 3, 'three refused sites live in the retired queue');

  // And the marker on that module is a CONDITION, not a date: "DELETE AFTER
  // ONE RELEASE". Nothing here establishes that a release has gone out, so
  // nothing here says the marker has come due.

  const sources = [];
  const walk = (relative) => {
    for (const entry of readdirSync(resolve(REPOSITORY, relative), { withFileTypes: true })) {
      const next = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (/\.(js|jsx|mjs)$/.test(entry.name)) sources.push(next);
    }
  };
  walk('src');
  const production = sources.filter(file => !/\.(test|spec)\.[a-z]+$/.test(file) && file !== RETIRED);
  const importers = production.filter(file => {
    const text = readFileSync(resolve(REPOSITORY, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    return /(from|import)\s*\(?\s*['"][^'"]*retiredOfflineQueue/.test(text);
  });
  assert.deepEqual(importers, [],
    'something now imports the retired queue; these three sites may be live again');
});

test('the roster sites read fields the roster does not project', () => {
  // The half that makes serving the sort a defect rather than a fix. The
  // fields are NAMED above and both halves of each claim are re-checked here:
  // that the roster really does not project it, and that the file really does
  // still read it. A site that gets ported fails the second half, which is
  // when its entry comes out.
  const projected = new Set(rosterProjection());
  const roster = measured().filter(call => call.key === 'User.list');
  // THREE, not six: this branch ports NumberPoolPanel, PhoneProvisioningPanel and
  // TelnyxSetupProgress, so their entries came out as the table's own comment
  // prescribes. The three left are the approver screens, whose blocker is a
  // decision rather than a projection.
  assert.equal(roster.length, 3, 'three refused sites read the roster');

  // `full_name` IS projected — `20260920630000` added it — and is empty until
  // names are loaded. That is the sort's own problem and a different one.
  assert.ok(projected.has('full_name'), 'the roster carries a name key');

  // No two entries for one file may cite the same expression. Two pages here
  // hold two refused sites each, and without this an entry could point at its
  // neighbour's evidence and claim to be measured — the same mistake as a
  // file-wide search, one step down.
  const cited = new Map();
  for (const entry of REFUSALS.filter(row => row.key === 'User.list')) {
    for (const snippet of entry.reads ?? []) {
      const at = `${entry.file} :: ${snippet}`;
      assert.equal(cited.has(at), false,
        `${identity(entry)} cites an expression another entry for the same file already cites;`
        + ' each site owns its own evidence or neither is measured');
      cited.set(at, entry);
    }
  }

  for (const entry of REFUSALS.filter(row => row.key === 'User.list')) {
    assert.ok(Array.isArray(entry.absent) && entry.absent.length > 0,
      `${identity(entry)} must name what the roster cannot give it`);
    assert.ok(Array.isArray(entry.reads) && entry.reads.length > 0,
      `${identity(entry)} must carry the expression that reads them`);
    const text = withoutComments(readFileSync(resolve(REPOSITORY, entry.file), 'utf8'));

    // The evidence is the SITE'S OWN expression, and it has to be the only one
    // like it in the file. Two pages here hold two refused `User.list` sites
    // each, so a file-wide search answers the same way for both and cannot tell
    // a ported site from an unported one beside it.
    const seen = new Map();
    for (const snippet of entry.reads) {
      const count = text.split(snippet).length - 1;
      assert.equal(count, 1,
        `${identity(entry)}: its evidence ${JSON.stringify(snippet)} appears ${count} times`
        + ' in the comment-stripped source, and must appear exactly once');
      for (const field of entry.absent) if (snippet.includes(field)) seen.set(field, snippet);
    }
    for (const field of entry.absent) {
      assert.equal(projected.has(field), false,
        `${entry.file} claims the roster lacks ${field}, and it projects it`);
      // Every named field has to be IN one of those expressions, so the entry
      // cannot name a field this site does not read. A field appearing anywhere
      // else in the file — in a header comment, or at the page's other site —
      // is no longer evidence for this one.
      assert.ok(seen.has(field),
        `${identity(entry)} names ${field}, and none of its own expressions reads it;`
        + ' if this site is ported, drop the field or the entry in the same change');
    }
  }
});
