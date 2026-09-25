# Version-bound browser transport (default off)

`src/lib/externalIntegrationTransport.js` supports the additive `/v2/integrations`
contract `cm.integrations.v2`. The existing `/v1/integrations` operator contract
is retained. A browser request supplies an **expectation**, not a permission:
its exact principal, agency, membership ID/version, role, and owner flag. The
server still independently obtains current authority at every existing gate and
rejects changed bindings before provider work or result disclosure.

The selected transport is wrapped **inside** the existing tenant SDK membrane.
It checks the in-memory trusted principal, captured session token and document
lease; logout, tenant/role transitions and cross-tab authority changes invalidate
pending and completed operations. No provider credential is shipped to the
browser. Redirects, foreign hosts, unexpected revisions or response contracts,
malformed output, and oversized input/output fail closed.

Build settings are nonsecret and must all be reviewed:

| Setting | Required value for a future opt-in |
| --- | --- |
| `VITE_EXTERNAL_INTEGRATIONS` | `enabled-v2`; the default is `disabled` |
| `VITE_EXTERNAL_INTEGRATION_ORIGIN` | `https://pennsync-integrations-production.up.railway.app` |
| `VITE_EXTERNAL_INTEGRATION_OPERATIONS` | Explicit comma-separated compatible operations |
| `VITE_EXTERNAL_INTEGRATION_REVISION` | Exact 40-character deployed external-service commit SHA |

There is no fallback to a Base44 paid operation after an external request.
Preparing one operation creates one request reference; explicit reconciliation
reuses its exact request bytes and reference, including after a lost response.
It does not automatically retry an uncertain provider outcome. A stale browser
revision must not be 'fixed' by silently assigning a new paid request ID.

`UploadFile` cannot be selected by the global SDK facade: its existing
`file_url` result is not a private `cmfile:` handle. Existing public links are
not replaced, copied, deleted, or expired by this patch. AI inputs that use old
file URLs, unsupported models or internet context, and email callers that expect
HTML semantics require explicit consumer migrations before enabling their
operation. Signed private links expire even when their completed result is
replayed; only a fresh signing request, not another upload, is appropriate.

A service and browser built from this source may still report
`base44ExecutionDependency: true`. This is intentionally accurate. Provider-only
synthetic tests and offline real-SDK composition tests are **not** authenticated
employee acceptance, an app-store submission, a full traffic cutover, or measured
zero integration-credit consumption. Do not enable traffic merely because these
tests pass.

Validation includes `pnpm run test:external-integrations`, the real installed
Base44 SDK composition in `externalIntegrationRealm.spec.js`, trusted-principal
clearing tests, existing realm-contract guards, and the complete application
suite. These are network-isolated synthetic checks; provider acceptance remains
a distinct, bounded operator procedure.

## Independent browser release

The server requires INTEGRATIONS_RELEASE=enabled-v1 plus the separate
INTEGRATIONS_BROWSER_RELEASE=enabled-v2 and a nonempty, duplicate-free
INTEGRATIONS_BROWSER_OPERATIONS subset of INTEGRATIONS_ALLOWED_OPERATIONS.
Enabling v1 alone does not release v2. Browser controls default off. The legacy
v1 endpoint continues to require an explicit agency, including for an owner.

Subset is a ceiling, not the whole rule. SendEmail is refused to the browser
route outright (BROWSER_FORBIDDEN_OPERATIONS in contracts.mjs): the service
refuses to start if the browser list names it, and a request naming it is
refused at dispatch. Until SendEmail joined the service list on 2026-09-25 the
subset ceiling happened to refuse a browser send for free, and releasing the
account emails would otherwise have turned that into two unset variables. A
browser send also reaches the provider without the recipient binding the
business API applies to its own senders, so the only bound on the recipient
would be what the caller typed.

The v2 durable payload hash binds contract, deployed revision, current caller
expectation and parameters. A repeated UUID after a membership version, role,
service revision or v1/v2 transition conflicts instead of rebranding old output.

## Timeout reconciliation

A private WeakMap carries an exact operation receipt through the existing tenant
membrane. The ordinary AI timeout error retains its requestId and a guarded,
non-enumerable reconcile() callback. Arbitrary similarly named SDK properties are
not trusted. No token, prompt or callback is serialized into that error.

Up to 32 uncertain operations are retained in memory per active realm. Repeating
the same AI input resumes its prior request, including after a late completion.
Explicit reference reuse rejects changed parameters. Capacity exhaustion blocks
new work rather than evicting an uncertain operation into another paid request.
Realm closure clears the registry, and retained callbacks independently deny
access. This is not cross-document persistent recovery, a refund, or proof that
a timed-out provider was cancelled. The scheduler still accounts for known
in-flight work until its original promise settles.
