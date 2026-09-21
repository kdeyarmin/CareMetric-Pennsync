import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

/**
 * Contract: every node:test file is actually referenced by a test script.
 *
 * The `test:*` scripts in package.json are hand-maintained file lists, so a new
 * `*.test.js` runs locally when you invoke it directly, passes review, and then
 * never executes in CI again — the suite reports green while the file is inert.
 * Five files had drifted this way before this guard existed, three of them
 * added by the same PR that introduced them.
 *
 * Root `tools-*.test.js` and `tools-*.test.mjs` files are also explicit
 * node:test entries and must
 * be registered. `.test.jsx` is excluded: those are component tests,
 * collected by vitest (`test:components`) via glob rather than an explicit
 * list.
 */

const ROOTS = ['src', 'base44'];
/**
 * `services/` is checked separately because a test there has TWO legitimate
 * homes: a `test:*` script, or a workflow step. A dozen of them need a real
 * PostgreSQL or a running local stack and cannot be in `pnpm test` at all.
 *
 * It is checked at all because five contract suites drifted exactly the way
 * this guard was built to catch — written, passing when invoked directly, and
 * never run again — and the miss surfaced as an unrelated CI failure rather
 * than as a red test.
 */
const SERVICE_ROOT = 'services';
const WORKFLOWS = '.github/workflows';

function collectNodeTests(dir, pattern = /\.test\.js$/) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...collectNodeTests(p, pattern));
    else if (pattern.test(entry)) out.push(p.replace(/\\/g, '/'));
  }
  return out;
}

test('every node:test file is wired into a package.json test script', () => {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
  const registry = Object.entries(pkg.scripts)
    .filter(([name]) => name.startsWith('test:'))
    .map(([, body]) => body)
    .join(' ');

  const orphans = ROOTS
    .flatMap((root) => collectNodeTests(join(process.cwd(), root)))
    .concat(
      readdirSync(process.cwd())
        .filter((entry) => /^tools-.*\.test\.(?:js|mjs)$/.test(entry))
        .map((entry) => join(process.cwd(), entry)),
    )
    .map((abs) => abs.slice(process.cwd().length + 1))
    .filter((rel) => !registry.includes(rel))
    .sort();

  assert.deepEqual(
    orphans,
    [],
    'These test files never run in CI. Add them to a test:* script in '
      + 'package.json (test:utils is the usual home):\n  '
      + orphans.join('\n  '),
  );
});

test('every services test runs somewhere: a test script or a workflow step', () => {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
  const registry = Object.entries(pkg.scripts)
    .filter(([name]) => name.startsWith('test:'))
    .map(([, body]) => body)
    .join(' ');
  // A workflow step is a home too: a suite needing a real PostgreSQL or a
  // running local stack cannot be in `pnpm test`, and pretending otherwise
  // would push somebody to delete the guard rather than register the file.
  const workflows = readdirSync(join(process.cwd(), WORKFLOWS))
    .filter((entry) => /\.ya?ml$/.test(entry))
    .map((entry) => readFileSync(join(process.cwd(), WORKFLOWS, entry), 'utf8'))
    .join('\n');
  const orphans = collectNodeTests(join(process.cwd(), SERVICE_ROOT), /\.test\.mjs$/)
    .map((abs) => abs.slice(process.cwd().length + 1))
    .filter((rel) => !registry.includes(rel) && !workflows.includes(rel))
    // A glob in a script covers a whole directory, which is a real home.
    .filter((rel) => !registry.includes(`${rel.replace(/\/[^/]+$/, '')}/*.test.mjs`))
    .sort();
  assert.deepEqual(orphans, [],
    'These service tests never run in CI. Add them to a test:* script in '
      + 'package.json, or to a workflow step when they need a database or a '
      + 'running stack:\n  ' + orphans.join('\n  '));
});

test('nothing the isolated authority job runs needs a package that job does not install', () => {
  // The `postgres` job in `pennsync-authority.yml` installs ONLY
  // `services/authority-store` and `services/integration-runtime/tests`, each
  // with `--ignore-workspace`. There is no root `pnpm install` in it. So a
  // suite there that reaches a root tool importing `json5` fails at LOAD,
  // before a single test runs — which presents as a step failing in under a
  // second while the same file passes locally.
  //
  // Only that job is checked, because only its install set is narrow and
  // knowable. Other workflows install the root package and the rule would be
  // a guess.
  const workflow = readFileSync(join(process.cwd(), WORKFLOWS, 'pennsync-authority.yml'), 'utf8');
  const job = workflow.slice(workflow.indexOf('\n  postgres:'), workflow.indexOf('\n  http:'));
  const installed = new Set(['services/authority-store', 'services/integration-runtime/tests']
    .flatMap((directory) => {
      const owner = JSON.parse(readFileSync(join(process.cwd(), directory, 'package.json'), 'utf8'));
      return [...Object.keys(owner.dependencies ?? {}), ...Object.keys(owner.devDependencies ?? {})];
    }));
  // Every bare specifier the file reaches, following relative imports, because
  // the failure is transitive: the test imported a tool, and the TOOL imported
  // the package that was missing.
  const reached = (entry, seen = new Set()) => {
    if (seen.has(entry)) return [];
    seen.add(entry);
    let source;
    try { source = readFileSync(entry, 'utf8'); } catch { return []; }
    const bare = [];
    // `from '…'` on an import or export line, plus a side-effect `import '…'`.
    // Matching any quoted string after the word `export` picked up every
    // `export const NAME = 'value'` in the fixtures, which is how the first
    // draft reported that a test needed a package called `s3_referral`.
    const specifiers = [
      ...source.matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"\n]*\bfrom\s*['"]([^'"\n]+)['"]/g),
      ...source.matchAll(/(?:^|\n)\s*import\s*['"]([^'"\n]+)['"]/g),
    ];
    for (const match of specifiers) {
      const specifier = match[1];
      if (specifier.startsWith('node:')) continue;
      if (!specifier.startsWith('.')) { bare.push({ entry, specifier }); continue; }
      const resolved = join(entry, '..', specifier);
      bare.push(...[resolved, `${resolved}.mjs`, `${resolved}.js`]
        .filter((candidate) => { try { return statSync(candidate).isFile(); } catch { return false; } })
        .flatMap((candidate) => reached(candidate, seen)));
    }
    return bare;
  };
  const offences = [];
  for (const absolute of collectNodeTests(join(process.cwd(), SERVICE_ROOT), /\.test\.mjs$/)
    .concat(readdirSync(process.cwd())
      .filter((entry) => /^tools-.*\.test\.mjs$/.test(entry))
      .map((entry) => join(process.cwd(), entry)))) {
    const relative = absolute.slice(process.cwd().length + 1);
    if (!job.includes(relative)) continue;
    for (const { entry, specifier } of reached(absolute)) {
      if (installed.has(specifier)) continue;
      offences.push(`${relative}: ${entry.slice(process.cwd().length + 1)} needs ${specifier}`);
    }
  }
  assert.deepEqual([...new Set(offences)].sort(), [],
    'The isolated authority job does not install these, so the step fails at '
      + 'load rather than on an assertion:\n  ' + [...new Set(offences)].sort().join('\n  '));
});

test('a step handed an account-wide management token is gated on main', () => {
  // `SUPABASE_ACCESS_TOKEN` is a Supabase PERSONAL access token: its scope is
  // the whole organisation, not one project. A staging database URL reaches one
  // database and is bad to leak; this reaches every project in the account.
  //
  // Excluding `pull_request` does not contain it. `workflow_dispatch` names no
  // branch, so a collaborator can dispatch a workflow against a ref they
  // control, `actions/checkout` takes that ref, and the step runs THEIR copy of
  // the script with the secret in its environment. The ref has to decide, not
  // the event.
  //
  // This is a ratchet rather than a review note because the property lives in
  // one `if:` line, and a later edit that widened it back would look like a
  // convenience and read as one.
  const offenders = [];
  for (const entry of readdirSync(join(process.cwd(), WORKFLOWS))) {
    if (!entry.endsWith('.yml') && !entry.endsWith('.yaml')) continue;
    const source = readFileSync(join(process.cwd(), WORKFLOWS, entry), 'utf8');
    for (const chunk of source.split(/\n\s*- (?=name:|uses:|run:)/)) {
      // Comments go first, and that is the point rather than tidiness: a step
      // split leaves the comments that PRECEDE a step at the end of the
      // previous chunk, so a prose mention of the token — like the one
      // explaining this very gate — reported the step above it. A check that
      // reads a file for a name has to say whether it means the code or the
      // page; this means the code.
      const step = chunk.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
      // An `env:` binding, not a mention.
      if (!/^\s*SUPABASE_ACCESS_TOKEN:\s*\S/m.test(step)) continue;
      // The gate must be the ref, and must name main exactly.
      if (!/if:\s*\$\{\{\s*github\.ref\s*==\s*'refs\/heads\/main'\s*\}\}/.test(step)) {
        offenders.push(`${entry}: ${(step.split('\n')[0] ?? '').trim().slice(0, 60)}`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    'every step receiving SUPABASE_ACCESS_TOKEN must be gated on '
    + "if: ${{ github.ref == 'refs/heads/main' }} — excluding pull_request is not enough, "
    + 'because workflow_dispatch can select any ref');
});
