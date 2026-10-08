import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, matchesGlob } from 'node:path';
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

/**
 * The CLOSURE: every test-looking file has at least one home.
 *
 * The three tests above check three populations under two rules, and the gap
 * between them is not a file anybody would notice. `collectNodeTests` defaults
 * to `/\.test\.js$/` for `src` and `base44`, and the services test asks only
 * for `/\.test\.mjs$/`, so a whole grid of (root × extension) pairs is in NO
 * population at all. Some of them, as examples rather than an enumeration:
 *
 *   src/**\/*.test.mjs        base44/**\/*.test.mjs      src/**\/*.spec.mjs
 *   services/**\/*.test.js    services/**\/*.spec.js     base44/**\/*.spec.js
 *
 * No count is written here on purpose: the grid grows with every extension and
 * directory the project gains, so a figure would be stale before it was useful,
 * and the ones above were the cells somebody happened to probe. There are no
 * such files today, which is exactly why a reading in a document could not hold
 * this: the hole is invisible until somebody lands the first one, and then it
 * looks wired. Widening one pattern would close one cell and leave the grid, so
 * this asserts the PROPERTY instead — a file is bound, or it is named here as
 * unbound. A new runner, extension or directory lands in
 * neither bucket and fails BY NAME, which is what survives a change where a
 * widened regex would not. The same shape tools-record-migration-coverage.mjs
 * uses: publish no figure, assert that nothing falls outside the known set.
 *
 * Each home is DERIVED from the thing that owns it — the script bodies, and the
 * runner configs IMPORTED rather than retyped — because a second copy of a glob
 * here is a copy that can disagree with the runner while this still passes.
 */
test('every test file has a home: a script, a runner glob, or a workflow step', async () => {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
  const scripts = Object.entries(pkg.scripts)
    .filter(([name]) => name.startsWith('test:'))
    .map(([, body]) => body)
    .join(' ');
  const workflows = readdirSync(join(process.cwd(), WORKFLOWS))
    .filter((entry) => /\.ya?ml$/.test(entry))
    .map((entry) => readFileSync(join(process.cwd(), WORKFLOWS, entry), 'utf8'))
    .join('\n');

  // The runners' own globs, read off the configs. `path.matchesGlob` is used
  // rather than a hand-rolled matcher because a `*` that is allowed to cross a
  // `/` silently swallows a nested directory — the error that once reported the
  // four `browser/` suites as covered.
  const vitest = (await import('../vitest.config.js')).default?.test ?? {};
  const playwright = (await import('../playwright.config.js')).default ?? {};
  const playwrightDir = String(playwright.testDir ?? '').replace(/^\.\//, '');

  const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-ssr', 'coverage', 'vendor', 'ios', 'public', 'docs', '.pnpm-store']);
  const TEST_FILE = /\.(?:test|spec)\.(?:js|mjs|cjs|jsx|ts|tsx)$/;
  const walk = (dir, out = []) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p, out);
      else if (TEST_FILE.test(entry.name)) out.push(p.slice(process.cwd().length + 1).replace(/\\/g, '/'));
    }
    return out;
  };

  const homeless = [];
  for (const rel of walk(process.cwd()).sort()) {
    // A script names the file outright, or covers its directory with a glob.
    if (scripts.includes(rel)) continue;
    if (scripts.includes(`${rel.replace(/\/[^/]+$/, '')}/*${rel.replace(/^.*(\.(?:test|spec)\.[a-z]+)$/, '$1')}`)) continue;
    // Vitest collects it by glob (its own include, minus its own exclude).
    const vitestExcluded = (vitest.exclude ?? []).some((bad) => rel === bad || rel.startsWith(`${bad}/`));
    if (!vitestExcluded && (vitest.include ?? []).some((glob) => matchesGlob(rel, glob))) continue;
    // Playwright collects it by testDir + testMatch.
    if (playwrightDir && (rel === playwrightDir || rel.startsWith(`${playwrightDir}/`))
      && (playwright.testMatch instanceof RegExp ? playwright.testMatch.test(rel) : true)) continue;
    // A services suite may live in a workflow step instead; that rule is the
    // second test's and is not widened here.
    if (rel.startsWith(`${SERVICE_ROOT}/`) && workflows.includes(rel)) continue;
    homeless.push(rel);
  }

  assert.deepEqual(homeless, [],
    'These test files are collected by NOTHING — no test:* script names them, no '
    + 'runner glob matches them, no workflow step runs them. They pass when invoked '
    + 'by hand and never run again. Register each one, or widen the runner that '
    + 'should own it (and prove the widening bites):\n  ' + homeless.join('\n  '));
});
