# Central administration read adapter

The candidate `centralAdminRead` function exposes a small SaaS metadata surface
to the CareMetric Hub. It is disabled unless the hosted
`CAREMETRIC_ADMIN_ENABLED` configuration is exactly `true`. This source change
does not deploy a function, configure a mapping, create an account, alter an
entity schema, change billing, or provision a native session.

## Verified runtime and supported transport

The production frontend workflow pins app `694ec16e72e01b60d22f7cbf` and API
`https://base44.app`. On 2026-09-11, protected Base44 CLI `functions list` against
that app succeeded, while `https://caremetricai.base44.app/` returned that same
app identity and frontend asset revision `b80bd5caf8d3`. An unauthenticated POST
to its existing read function `/functions/getMyTenantContext` returned the
handler's JSON 401 response. The new candidate endpoint is:

`https://caremetricai.base44.app/functions/centralAdminRead`

[Base44's HTTP function documentation](https://docs.base44.com/developers/backend/resources/backend-functions/overview)
supports direct external requests without a native authenticated user. The
hosted gateway supplies the credentials consumed by
[`createClientFromRequest`](https://docs.base44.com/developers/references/sdk/docs/functions/createClientFromRequest).
Its service role can bypass entity access rules and field restrictions; it
therefore belongs only in the hosted function. The adapter retains only the
hosted `Base44-Service-Authorization` and the exact expected `Base44-App-Id` for
the SDK. As in PennSync's existing staging preflight boundary, API URL, state,
function revision, user authorization and arbitrary request headers are not
propagated. The SDK uses its fixed default `https://base44.app` API. A non-prod
`X-Data-Env` is denied. No service token is configured in the Hub or frontend.

The Hub sends `Content-Type: application/json` and the fixed header
`X-CareMetric-Hub-Authorization: Bearer <token>`. Every nonempty browser Origin,
including literal `null`, is denied. There is no CORS grant. Accepted methods and body fields are
closed; no caller-controlled table, destination, header name, or query operator
is accepted.

Hosted transport rejections emit bounded console diagnostics because the provider may normalize
forwarded headers. Each function instance logs at most ten distinct category combinations, with
only a fixed event name, Origin category (`absent`, `empty`, `app_origin`, `platform_origin`,
`other`), Cookie category (`absent`, `empty`, `present`), and booleans indicating an exact request
origin match or literal `null` origin. Raw header values, request URLs, bodies, tokens and
identities are never logged. Diagnostic failures leave the same rejection response in place.
These categories are observations, not trusted authorization evidence. At 2026-09-11T17:39:07Z,
an anonymous Node POST sent no Origin, Cookie or Authorization header; the deployed diagnostic
at commit `7d3a0d095dee50cb55e227297e1b59b31f4bf453` observed an absent Origin and present Cookie.
Therefore Cookie presence is not a transport veto: the hosted gateway adds it even for server
calls. Cookies are ignored for authorization and omitted from both the Hub request and pinned
native SDK request. The mandatory custom Hub token, exact SMS operation binding, explicit
identity mapping and current protected native role remain authoritative. Missing or malformed
custom tokens return 401 with or without a hosted cookie; an injected cookie cannot create a session.

## Current authorization on every request

Two separate authorization paths are supported:

- A Hub access JWT is sent only to the fixed
  `https://xgauehtwksmnoqhgqegm.supabase.co/rest/v1/rpc/authorize_platform_admin`
  RPC, which must return a current `platform_admin` with `aal2`.
- An opaque SMS delegation `cmh_` followed by exactly 43 base64url characters is
  sent only to
  `https://support-hub-web-production.up.railway.app/api/internal/admin/pennsync/authorize`.
  This POST sends `{}` and the standard Bearer Authorization header. The Hub
  consumes its short-lived delegation once. Its response must contain exactly
  `user_id`, `role: platform_admin`, `method: sms`, and the complete authorized
  operation object. Native operation, normalized search, limit and offset must
  match with no additional or missing fields, independently of object key order.
  Invalid SMS tokens never fall through to JWT handling.

Both paths require a deployment-owned explicit Hub UUID to native User ID
mapping and a fresh projected native User lookup. That same native ID must still
have Base44's protected built-in `role: admin`. A recorded `is_active: false`
also denies access, but that self-editable custom field cannot grant access.
Neither email equality nor custom `account_type`, `agency_id`, `staff_role` or
other profile metadata establishes authority. Missing, duplicate, demoted or
deleted native users are denied. Errors are stable codes without native error
details or identity logs; responses cannot be cached.

**Privileged revocation:** PennSync's current native offboarding flow leaves the
protected admin role intact while changing a self-editable `is_active` flag and
revoking agency memberships. Offboarding alone is not reliable privileged
revocation. Remove the Hub-to-native mapping, demote the protected native role,
or remove the native account through an independently authorized platform
operation. Removing a Hub admin/session also prevents new Hub authorizations.
This adapter does not change the existing offboarding or paused deletion flows.

Hosted configuration:

- `CAREMETRIC_ADMIN_ENABLED`: absent, blank or `false` is disabled; only `true`
  enables the boundary. Disable this first for immediate rollback.
- `HUB_SUPABASE_PUBLISHABLE_KEY`: the fixed Hub project's public publishable key,
  used for the JWT RPC only. No Hub service key is needed.
- `CAREMETRIC_ADMIN_IDENTITY_MAP_JSON`: JSON object containing explicit Hub UUID
  keys and native IDs matching `^[0-9a-f]{24}$`. Maximum 100 one-to-one mappings;
  duplicates, empty maps and malformed IDs fail closed. Verify each native
  protected role separately; never manufacture a map from an email match alone.
- `CAREMETRIC_ADMIN_SOURCE_REVISION`: optional exact 40-character Git SHA for
  the deployed candidate; missing or malformed values report `null`.

## Data scope and contract

Success envelopes are `{contractVersion:1,product:'pennsync',operation,generatedAt,data}`.
All entity IDs retain their native 24-character lowercase hexadecimal value;
Hub actor identities remain UUIDs. Errors are `{error:{code}}` with an appropriate
HTTP status. The six implemented operations are:

| Operation | Source and response |
| --- | --- |
| `capabilities` | Authenticated `{apiVersion:1,operations,sourceRevision}`. |
| `overview` | `{organizationCount,activeUserCount:null,registeredUserCount,subscriptionCount}`. No authoritative active account metric is available. |
| `organizations.list` | Agency metadata `{id,name,slug:null,status,createdAt}`. Agency join codes, contact details and notes are excluded. Search matches name. |
| `users.list` | Current protected native admins plus existing users referenced by valid service-owned AgencyMembership rows. Pending/suspended/revoked membership history remains in the registered staff directory. Custom profile claims never add users. Fields are `{id,displayName,email,role,status:'registered',createdAt}`. Search matches email. |
| `billing.overview` | Local Subscription records `{source:'application_database',subscriptionCount,statusCounts:[{status,count}]}`. All native recorded statuses are represented. |
| `billing.subscriptions.list` | Local individual-user subscriptions with `{id,organizationId:null,organizationName:null,planCode:null,planName,status,providerStatus:null,providerCustomerId,providerSubscriptionId,currentPeriodEnd,updatedAt}`. The page includes `source:'application_database'`. Search matches cached provider subscription ID. |

Subscription records have a `user_email` association but no authoritative agency
ID. The adapter does not infer an organization by email, and never fetches that
billing email. The response is cached application metadata, not a live Stripe or
Apple balance, revenue calculation or entitlement recomputation. Provider status
is null because there is no distinct provider status column. No monetary values,
webhook bodies, credentials, patient data, clinical fields or media URLs are read
or returned. Patient entities are outside the entity allowlist.

List requests accept only operation, optional literal search (at most 100
characters), limit 1–50 and offset 0–10000. Search is literal local comparison,
not a native query expression. Default limit is 20. Responses include
`items,total,limit,offset`; total is the number matching the search.

The documented SDK has pagination and projection but no count aggregate. Scans
therefore read only fixed field projections, ordered by immutable ID, in pages
of at most 500 with a 10000-record ceiling and a final completion probe. Counts
come from completed scans; malformed, duplicated or unordered pages and scans
over the ceiling return 503, never a partial success count. Staff lookups use
bounded native ID batches through the documented `$in` filter. There is a shared
12-second deadline, no persistent data cache, and no parallel snapshot guarantee
across entities. SDK calls already in flight may finish after the handler stops
waiting because SDK entity methods do not accept AbortSignal.

## Validation and release boundary

For hosted authorization failures, `central_admin_request_failed` records only
the fixed request stage, public HTTP status, bounded numeric Hub/native HTTP
statuses when available, and closed categories for the native app header, data
environment and service credential shape. It never records header values,
credentials, identities, operation bodies or SDK exception text. Each handler
instance deduplicates these signatures and stops after 20 distinct signatures;
the diagnostic sink cannot change the public response. Routine anonymous input
and successful requests do not produce these failure events. Use the stage to
distinguish Hub transport/identity rejection from native credential, SDK factory,
current administrator and projected data failures. A diagnostic is evidence for
the next investigation; it does not authorize relaxing that stage's checks.
A closed failure-kind enum distinguishes timeout, abort, DNS, TLS, redirect,
permission, connection, invalid fetch receiver, signal-option, unsupported,
generic type-error and unknown failures. A boolean reports whether the incoming
request was aborted. Exception messages are only matched against fixed markers
inside the classifier; neither matched text nor native error codes are emitted.

The hosted runtime rejected callback fetches using `redirect: 'error'` before
an HTTP response, including safe invalid-capability probes to both fixed Hub
endpoints. Callback fetches use `redirect: 'manual'` and explicitly reject every
3xx or unexpectedly followed response. No Location is followed and no second
endpoint receives the administrator credential.

`pnpm run test:central-admin` runs native producer/authentication/transport tests
through the repository's esbuild-based TypeScript harness, including SMS
single-use rejection, exact operation binding, current role/mapping revocation,
projection, directory scope, literal search and scan ceiling failures. It is
wired into `pnpm test`. `deno check --no-lock
base44/functions/centralAdminRead/entry.ts` checks actual SDK types.

The Help consumer now uses the vendored 0.4 SDK and passes its existing static
route allowlist. Its verified-production activation and exact false rollback
override are preserved; producer tests exercise the actual package and button.
The live `b80bd5caf8d3` App bundle had the production app ID but no
`VITE_DEPLOY_ENV`, leaving the launcher disabled. The manual production site
workflow now supplies that deployment label and takes `VITE_CENTRAL_HELP_ENABLED`
from its manual `central_help_enabled` choice (default `true`). Select `false`
when rebuilding/publishing the site to roll back the launcher. This does not publish the
candidate or enable the independent backend adapter.

Deployment must use only this named function after review; do not run a full
resource deploy or alter entity schemas. The new hosted function and positive
Hub-to-native chain remain unverified until the Hub's matching parser, token
issuer, introspection consumer and operator mapping are released together.
Before activation, verify missing/forged tokens and direct browser requests are
denied on the actual hosted candidate, then verify each read with real Hub
authorization and confirm mapping revocation. Local fixtures are not proof of
production gateway behavior, SMS delivery, sign-in continuity or native writes.
