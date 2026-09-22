import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EXIT_STAND_DOWN, decideHostedGate, runHostedGateCli } from './tools-pennsync-hosted-gate.mjs';

/**
 * The hosted gate, which decides whether main goes red.
 *
 * This suite exists because the logic it covers was wrong three times while it
 * lived as a shell block in the workflow, and each time it was checked by hand
 * and looked right. The cases below are those three plus the ones they imply,
 * and the table is the point: every combination of (url, token, required) has
 * a row, so a fourth boundary cannot be moved without a row changing.
 */

// Not `URL`: that shadows the global class, and this file needs `new URL()`
// to locate the workflow. The first draft did shadow it and test 8 threw
// `URL is not a constructor` rather than failing its assertion.
const TARGET = 'supabase://xxtyweswohkvgkprimwa';
const TOKEN = 'sbp_example_token';

/**
 * Every input combination, with the action each must produce.
 *
 * `required` governs ONE thing: what an absent configuration means. It appears
 * in both states on every row where it could matter, so a change that let it
 * reach a broken configuration fails here.
 */
const CASES = [
  // Nothing configured. Benign until the measurement is declared expected.
  { url: '', token: '', required: 'false', action: 'skip', code: 'HOSTED_GATE_NOT_CONFIGURED' },
  { url: '', token: '', required: 'true', action: 'fail', code: 'HOSTED_GATE_REQUIRED_BUT_ABSENT' },

  // A token left behind by a URL that was renamed or deleted. PARTIAL, so
  // broken, so fatal in both states — this is the case that shipped green.
  { url: '', token: TOKEN, required: 'false', action: 'fail', code: 'HOSTED_GATE_PARTIAL_CREDENTIALS' },
  { url: '', token: TOKEN, required: 'true', action: 'fail', code: 'HOSTED_GATE_PARTIAL_CREDENTIALS' },

  // A target that cannot be reached from a runner allowed outbound HTTPS only.
  { url: 'postgres://host/db', token: TOKEN, required: 'false', action: 'fail', code: 'HOSTED_GATE_TARGET_UNUSABLE' },
  { url: 'postgres://host/db', token: TOKEN, required: 'true', action: 'fail', code: 'HOSTED_GATE_TARGET_UNUSABLE' },
  // Checked before the token, so an unusable target names itself rather than
  // being reported as a missing credential.
  { url: 'postgres://host/db', token: '', required: 'false', action: 'fail', code: 'HOSTED_GATE_TARGET_UNUSABLE' },

  // The mirror of the partial case: a management target with no token.
  { url: TARGET, token: '', required: 'false', action: 'fail', code: 'HOSTED_GATE_TOKEN_MISSING' },
  { url: TARGET, token: '', required: 'true', action: 'fail', code: 'HOSTED_GATE_TOKEN_MISSING' },

  // Complete. Measured whatever the flag says, so the job starts working the
  // moment the secrets land rather than waiting for somebody to remember.
  { url: TARGET, token: TOKEN, required: 'false', action: 'run', code: 'HOSTED_GATE_READY' },
  { url: TARGET, token: TOKEN, required: 'true', action: 'run', code: 'HOSTED_GATE_READY' },
];

test('every credential combination decides the same way every time', () => {
  for (const { url, token, required, action, code } of CASES) {
    const decision = decideHostedGate({ url, token, required });
    assert.equal(decision.action, action,
      `url=${JSON.stringify(url)} token=${token ? 'set' : 'unset'} required=${required}`
        + ` decided ${decision.action} (${decision.code}), expected ${action}`);
    assert.equal(decision.code, code);
  }
});

test('a broken configuration is never rescued by HOSTED_MEASUREMENT_REQUIRED', () => {
  // The rule stated as a property rather than as rows: `required` may turn an
  // ABSENT configuration into a failure and may never turn a BROKEN one into a
  // pass. Every case that fails with the flag off must fail with it on.
  for (const { url, token } of CASES) {
    const off = decideHostedGate({ url, token, required: 'false' });
    if (off.action !== 'fail') continue;
    const on = decideHostedGate({ url, token, required: 'true' });
    assert.equal(on.action, 'fail',
      `url=${JSON.stringify(url)} fails when the measurement is optional and passes when required`);
  }
});

test('only a genuinely absent configuration may stand down', () => {
  // The inverse, and the one the second mistake broke: nothing may skip except
  // the case where neither credential is set.
  for (const { url, token, required } of CASES) {
    const decision = decideHostedGate({ url, token, required });
    if (decision.action !== 'skip') continue;
    assert.equal(url, '', 'a configuration with a target stood down');
    assert.equal(token, '', 'a configuration with a token stood down');
  }
});

test('whitespace is not a configuration', () => {
  // A secret set to an empty-looking value is unset, not a usable target:
  // treating it as set would send `   ` at the management transport. The rule
  // has to be the SAME for both, which is what this pins — a first draft
  // expected a blank token to read as a partial configuration, and a blank
  // token is no more configured than a blank URL.
  assert.equal(decideHostedGate({ url: '   ', token: '', required: 'false' }).code,
    'HOSTED_GATE_NOT_CONFIGURED');
  assert.equal(decideHostedGate({ url: '', token: '  ', required: 'false' }).code,
    'HOSTED_GATE_NOT_CONFIGURED');
  // And a blank token beside a real target is still a missing token.
  assert.equal(decideHostedGate({ url: TARGET, token: '   ', required: 'false' }).code,
    'HOSTED_GATE_TOKEN_MISSING');
});

test('required is the literal string true and nothing else', () => {
  // It is read out of a workflow `env:`, so it arrives as text. Anything else
  // must read as "not required" rather than as truthy, or a typo silently
  // arms the refusal.
  for (const required of ['false', '', 'TRUE', 'yes', '1', undefined]) {
    assert.equal(decideHostedGate({ url: '', token: '', required }).action, 'skip',
      `HOSTED_MEASUREMENT_REQUIRED=${JSON.stringify(required)} armed the refusal`);
  }
  assert.equal(decideHostedGate({ url: '', token: '', required: 'true' }).action, 'fail');
  assert.equal(decideHostedGate({ url: '', token: '', required: true }).action, 'fail');
});

test('the CLI exits 0 to measure, 3 to stand down, and 1 to refuse', () => {
  const run = env => {
    const out = [];
    const err = [];
    const code = runHostedGateCli({ env, write: line => out.push(line), error: line => err.push(line) });
    return { code, out: out.join('\n'), err: err.join('\n') };
  };

  const skipped = run({ PENNSYNC_HOSTED_DATABASE_URL: '', SUPABASE_ACCESS_TOKEN: '', HOSTED_MEASUREMENT_REQUIRED: 'false' });
  assert.equal(skipped.code, EXIT_STAND_DOWN);
  // A stand-down has to be VISIBLE, because a job that quietly measures
  // nothing is the failure this gate is for.
  assert.match(skipped.out, /^::notice title=Hosted store not measured::/);

  const refused = run({ PENNSYNC_HOSTED_DATABASE_URL: '', SUPABASE_ACCESS_TOKEN: TOKEN, HOSTED_MEASUREMENT_REQUIRED: 'false' });
  assert.equal(refused.code, 1);
  assert.match(refused.err, /broken configuration rather than an absent one/);

  const ready = run({ PENNSYNC_HOSTED_DATABASE_URL: TARGET, SUPABASE_ACCESS_TOKEN: TOKEN, HOSTED_MEASUREMENT_REQUIRED: 'false' });
  assert.equal(ready.code, 0);
  assert.equal(ready.out, '', 'a ready gate printed something for the log to bury');
});

test('no decision quotes a credential', () => {
  // The messages reach a public Actions log. They may name which variable is
  // unset and never what either one holds.
  for (const { url, token, required } of CASES) {
    const { message } = decideHostedGate({ url, token, required });
    assert.ok(!message.includes(TOKEN), 'a decision quoted the token');
    assert.ok(!message.includes('xxtyweswohkvgkprimwa'), 'a decision quoted the project ref');
  }
});

test('the workflow calls this gate rather than carrying its own copy', () => {
  // The whole reason this module exists is that the logic was unreviewable
  // inside the YAML. A step that grew its own `if [ -z ... ]` back would be the
  // same mistake with a test sitting beside it proving nothing.
  const workflow = readFileSync(new URL('./.github/workflows/pennsync-authority.yml', import.meta.url), 'utf8');
  const at = workflow.indexOf('- name: Measure the hosted staging store');
  assert.ok(at > 0, 'the hosted measurement step is gone');
  // To the next step at the same indentation, or the end of the file: this is
  // the last step of the last job today, so an unbounded slice is correct and a
  // cleverer delimiter was what made the first version of this test pass
  // vacuously over one line.
  const next = workflow.indexOf('\n      - ', at + 1);
  const body = next === -1 ? workflow.slice(at) : workflow.slice(at, next);
  const code = body.split('\n').filter(line => !/^\s*#/.test(line)).join('\n');
  assert.match(code, /node tools-pennsync-hosted-gate\.mjs/,
    'the hosted step no longer invokes the gate module');
  // The step may branch on the gate's exit code; it may not ask about a
  // credential itself, which would be this logic in the one place no test
  // reaches it.
  assert.ok(!/PENNSYNC_HOSTED_DATABASE_URL:-|SUPABASE_ACCESS_TOKEN:-/.test(code),
    'the hosted step has grown its own credential test again');
});
