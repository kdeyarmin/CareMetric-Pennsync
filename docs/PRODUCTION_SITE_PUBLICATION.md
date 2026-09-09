# Production frontend publication

This runbook covers **static frontend publication only** for CareMetric-Pennsync,
Base44 production app `694ec16e72e01b60d22f7cbf`.
It does not authorize patient ownership changes, release clinical/outbound gates,
complete data migration, or establish authenticated tenant-isolation evidence.

## Current publishing path

`.github/workflows/publish-production-frontend.yml` is a manual GitHub Actions
workflow named **Publish production frontend (site only)**. It is restricted to
this repository's `main` branch and the `production` environment. It does not run
on a push, a pull request, a schedule, or the completion of another workflow.
Environment approval/protection rules remain in force.

A Base44 workspace publishing key authorized for the production app must be
stored securely as the `BASE44_API_KEY` secret in GitHub's `production`
environment (or as an applicable repository secret). Never paste the key into
chat, source files, issues, reports, or client-side VITE variables. The tooling
requires a workspace key rather than an expiring device-login session. It stops
locally before invoking the CLI when the key or manual-production context is
missing. Credential presence is not reported as valid authentication.

After the key is configured, an authorized release operator can select this
workflow in GitHub Actions, select `main`, and use **Run workflow**. No publication
has been executed or verified merely because this workflow file exists.

The workflow performs these stages in order:

1. Reject missing publishing access without starting a login or device-code flow.
2. Install the application's locked dependencies with its pinned Node/pnpm tools.
3. Run the existing lint, tests, worksheet, shared-helper, function-syntax and
   high-signal type-check gates.
4. Build once with the production app ID, production backend, published-function
   selector and exact workflow commit in the asset filenames.
5. Check the build identity and install the current Base44 CLI in an isolated
   temporary directory. Require a successful protected `functions list` read
   against the fixed production app before uploading. The CLI's `whoami` command
   only acknowledges the format of a workspace key locally and is not an
   authentication test. A successful metadata read proves read access, not
   site-write permission; the subsequent upload must independently succeed.
6. Execute only `site deploy --yes --no-build` against the fixed production app.
   It never substitutes the broader `base44 deploy` resource-synchronization
   command, which could also change schemas, functions, connectors or auth.
7. Compare every emitted static asset on **both** production addresses with the
   local build using SHA-256, then recheck the HTML entry to catch a release that
   changes during verification.

An upload timeout or failed verification is **not** a safe automatic rollback
signal. Check Base44's actual publication status before retrying or rolling back;
the provider could have accepted an upload before a connection failed. The
workflow never rolls back database records. Keep a previously tested build or
source revision available through the normal authorized rollback process.

## Standalone read-only verification

With the exact intended build in `dist`, run:

```sh
pnpm run check:live-frontend -- --json
```

The default checks `https://app.caremetricai.com` and
`https://caremetricai.base44.app`. An explicitly allowed staging/production origin
can be supplied as the sole positional argument; `--dist` selects a different
local build directory. Only intended HTTPS site roots are allowed. Requests are
unsigned GETs, without credentials or cross-origin redirects. No patient data,
accounts, authentication, integration configuration or DNS is read or changed.

The check returns:

- `0`: every emitted local file matched at all requested origins and the expected
  HTML entry/reference set remained stable during the check.
- `1`: observed stale or incomplete publication, including an old entry filename,
  changed bytes under the same filename, a missing asset, or a stale lazy chunk.
- `2`: verification could not complete because of an invalid/missing local build,
  invalid target, malformed HTML, network error, HTTP failure or safety limit.

Both nonzero exits are blocking. HTTP 200, a successful build, matching text
markers, an upload receipt alone, or a current entry with broken lazy chunks must
not be called verified publication. The JSON always keeps
`authenticated_workflows_verified` and `full_release_complete` false: those
claims require separate hosted evidence that this static check does not gather.

The only uploaded workflow artifact is the sanitized verification JSON. Raw CLI
authentication/deployment output stays in temporary runner storage because it
may contain account details or signed URLs. No credentials are printed by the
preflight or verifier.

## Verification coverage and limitations

`pnpm run test:release-tools` exercises exact matches, stale roots, stale lazy
chunks, missing assets, ambiguous/foreign HTML entries, changed releases, network
errors, missing builds, unsafe local paths, credential leakage prevention,
manual-workflow restrictions, missing keys and exact-commit matching. These
regressions are also registered in the normal core test command.

The authenticated publishing call itself cannot be tested without valid provider
credentials. Even successful frontend publication leaves the hosted tenant/RLS,
legacy ownership, real integrations and separately gated workflow requirements
in the existing release-recovery record outstanding.

## Provider references

- Base44 site-only deployment: https://docs.base44.com/developers/references/cli/commands/site-deploy
- GitHub sync versus publishing: https://docs.base44.com/developers/app-code/local-development/github
- Workspace-key support was inspected in installed Base44 CLI 0.1.14. Its auth
  middleware recognizes the `BASE44_API_KEY` workspace-key prefix and does not
  use the device-login fallback for that credential type. Its `whoami` action
  performs no provider request in workspace-key mode. The publication workflow
  therefore checks protected production metadata instead. The provider remains
  responsible for validating the key and its read and site-write permissions.
