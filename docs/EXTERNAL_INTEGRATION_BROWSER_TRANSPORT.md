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
