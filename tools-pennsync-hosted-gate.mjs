#!/usr/bin/env node
/**
 * Decide whether CI may measure the hosted store, must refuse, or may stand
 * down — before a credential is handed to anything.
 *
 * This lived as a shell block inside `.github/workflows/pennsync-authority.yml`
 * and got its boundary wrong THREE times, which is why it is a module with a
 * test now rather than a fourth careful edit:
 *
 *   1. the credentials were bound through an env-level
 *      `github.ref == 'refs/heads/main' && secrets.X || ''`, which contains the
 *      token perfectly well and hides the containment in an expression;
 *      `src/testRegistryContract.test.js` ratchets on a literal `if:` for
 *      exactly that reason;
 *   2. an absent credential on main was made FATAL, which is right for a check
 *      that has stopped checking and wrong for one that was never switched on
 *      — it turned main red on the first run after merge, because neither
 *      secret has ever been configured;
 *   3. and the repair then read "URL is empty" as "nothing is configured",
 *      so a token left behind by a renamed or deleted URL secret — a PARTIAL
 *      configuration, which is the broken case — took the green stand-down
 *      path.
 *
 * The distinction all three missed is the only idea here. An ABSENT
 * configuration is a decision nobody has taken yet; a PARTIAL or MALFORMED one
 * is a configuration that has broken. Only the first may pass quietly, and only
 * until `required` says the measurement is expected.
 *
 * It decides; it does not connect, read a credential's value, or run the suite.
 * `decideHostedGate` is pure so every branch is provable without a workflow,
 * and the CLI is the thin part.
 *
 * THE DECISION LEAVES BY EXIT CODE — 0 measure, 3 stand down, 1 refuse — so the
 * workflow step branches on this module's answer and never re-asks the
 * question. A step that tested a credential itself to decide whether to run the
 * suite would be a second copy of this logic, in the one place it cannot be
 * tested, which is how all three earlier versions went wrong.
 *
 * Node builtins only, deliberately: the job that runs this installs just
 * `services/authority-store`'s dependencies and does no root install, so a
 * third-party import here would fail at load.
 */

export const HOSTED_GATE_CONTRACT = 'cm.pennsync.hosted-gate.v1';

/** The transport the plan found reachable; see stage A. */
const MANAGEMENT_PREFIX = 'supabase://';

const present = value => typeof value === 'string' && value.trim() !== '';

/**
 * `{ action, code, message }`, where action is one of:
 *
 *   `run`   — credentials are complete and usable; measure.
 *   `skip`  — nothing is configured and nothing requires it yet. The caller
 *             should say so visibly and exit 0.
 *   `fail`  — the configuration is required-and-absent, partial, or malformed.
 *
 * `required` is the only input that can turn an absent configuration into a
 * failure, and it can never turn a broken one into a pass.
 */
export function decideHostedGate({ url, token, required } = {}) {
  const hasUrl = present(url);
  const hasToken = present(token);
  const expected = required === true || required === 'true';

  if (!hasUrl) {
    // A token with no URL is not an absent configuration. Somebody set these
    // and one of them is gone — renamed, deleted, or expired out of the
    // environment — which is the case the whole gate exists for. It fails
    // whatever `required` says, because `required` governs what NOT YET
    // CONFIGURED means and this is not that.
    if (hasToken) {
      return {
        action: 'fail',
        code: 'HOSTED_GATE_PARTIAL_CREDENTIALS',
        message: 'SUPABASE_ACCESS_TOKEN is configured but PENNSYNC_STAGING_DATABASE_URL is not.\n'
          + 'That is a broken configuration rather than an absent one — one of a pair went\n'
          + 'missing — so it fails whatever HOSTED_MEASUREMENT_REQUIRED says.',
      };
    }
    if (expected) {
      return {
        action: 'fail',
        code: 'HOSTED_GATE_REQUIRED_BUT_ABSENT',
        message: 'PENNSYNC_STAGING_DATABASE_URL is not configured, and this job requires it:\n'
          + 'the suite would report every hosted assertion skipped and go green having\n'
          + 'measured nothing.',
      };
    }
    return {
      action: 'skip',
      code: 'HOSTED_GATE_NOT_CONFIGURED',
      message: 'PENNSYNC_STAGING_DATABASE_URL is not configured, so the hosted staging store '
        + 'was not measured. Add it and SUPABASE_ACCESS_TOKEN, then set '
        + 'HOSTED_MEASUREMENT_REQUIRED to true in .github/workflows/pennsync-authority.yml. '
        + 'See docs/RAILWAY_GO_LIVE_PLAN_2026-09-21.md stage A.',
    };
  }

  if (!url.startsWith(MANAGEMENT_PREFIX)) {
    return {
      action: 'fail',
      code: 'HOSTED_GATE_TARGET_UNUSABLE',
      message: 'The hosted target must be supabase://<project-ref>: the direct host is\n'
        + 'IPv6-only and the poolers are unreachable from a runner allowed outbound\n'
        + 'HTTPS and nothing else.',
    };
  }

  if (!hasToken) {
    return {
      action: 'fail',
      code: 'HOSTED_GATE_TOKEN_MISSING',
      message: 'A supabase:// target is configured but SUPABASE_ACCESS_TOKEN is not.\n'
        + 'That is a broken configuration rather than an absent one, so it fails\n'
        + 'whatever HOSTED_MEASUREMENT_REQUIRED says.',
    };
  }

  return { action: 'run', code: 'HOSTED_GATE_READY', message: '' };
}

/** Stand down: nothing to measure, and nothing wrong. Distinct from 0 so the
 * caller can tell "measure now" from "there is nothing to measure". */
export const EXIT_STAND_DOWN = 3;

/**
 * The operator entry point. Exit 0 to measure, `EXIT_STAND_DOWN` to stand down,
 * 1 to refuse — and it prints the decision rather than the credentials, which
 * are never read here beyond whether they are set and what scheme the target
 * names.
 */
export function runHostedGateCli({ env = process.env, write = console.log, error = console.error } = {}) {
  const decision = decideHostedGate({
    url: env.PENNSYNC_HOSTED_DATABASE_URL,
    token: env.SUPABASE_ACCESS_TOKEN,
    required: env.HOSTED_MEASUREMENT_REQUIRED,
  });
  if (decision.action === 'fail') { error(decision.message); return 1; }
  if (decision.action === 'skip') {
    // A workflow command, so the stand-down is visible on the run's summary
    // rather than buried in a log nobody opens.
    write(`::notice title=Hosted store not measured::${decision.message}`);
    return EXIT_STAND_DOWN;
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = runHostedGateCli();
}
