# Independent staging app entry

This opt-in build reuses the actual PennSync `App`, `SignInScreen`, `AuthProvider`, agency selector, `Patients` page, authorized-patient wrapper, query hooks and tenant membrane. It opens a synthetic names-only patient roster through the independent authority client. It is not a complete chart, production login migration or customer-data cutover.

Use the repository [setup and standard commands](../README.md) and the [owned local Auth stack](../services/authority-store/tests/http-acceptance.md). The mode requires these build-time values:

| Variable | Required value |
| --- | --- |
| `VITE_PENNSYNC_BACKEND` | `independent-staging` |
| `VITE_PENNSYNC_STAGING_PROJECT_REF` | `local-pennsync-authority`, or the exact dedicated staging reference `xxtyweswohkvgkprimwa` |
| `VITE_PENNSYNC_STAGING_PROJECT_URL` | Matching `http://127.0.0.1:54321` or `https://xxtyweswohkvgkprimwa.supabase.co` |
| `VITE_PENNSYNC_STAGING_PUBLISHABLE_KEY` | The selected target's modern publishable key; never a secret/service-role key |
| `VITE_PENNSYNC_STAGING_ACTORS` | JSON object mapping each of the four approved test aliases below to its independently provisioned native Auth UUID |

The four aliases are `info+pennsync-admin-a@caremetricai.com`, `info+pennsync-clinician-a@caremetricai.com`, `info+pennsync-clinician-empty@caremetricai.com`, and `info+pennsync-admin-b@caremetricai.com`. These are public actor identifiers, not passwords or authority grants. The server independently binds each native user to its verified legacy identity and current agency membership. The app ID remains the exact staging ID `6a9881683dc68a0bd54f1ef7`.

There is no URL, local-storage or caller-supplied hosted-project override. The dedicated hosted project above was created and independently verified on 2026-09-18 after explicit cost approval; its exact reference/URL pair is pinned in the shared client. All other hosted targets and mismatched pairs remain refused. Hosted actors must be independently enrolled and their current native UUID map supplied; the pin alone does not establish that enrollment or functional acceptance. The automated local acceptance runners still refuse hosted destinations. Missing or invalid selected-mode configuration fails closed before a Base44 client can be constructed. An omitted backend mode, or `base44`, retains the existing production path.

## Supported behavior and limits

The real form signs in through independent Auth, then the real tenant gate requires an explicit agency selection. The selected agency's roster uses current server authority and the existing authorized-list contract. The app shows only synthetic names and bounded pagination/search; it does not invent statuses, diagnoses, profile details or consent. Patient detail, edits, visits and other routes display no working clinical functionality in this mode. Existing production consent and workflow behavior remain on the production path.

The adapter exposes only current identity, membership/context reads and the names-only roster operation. Unsupported calls fail closed and do not fall back to Base44. The staging shell skips production navigation tracking, visual editing and remote app-settings discovery. The branded sign-in screen identifies the limited staging scope and hides Base44 signup/standard-sign-in handoffs.

New independent tokens remain in memory. This does not assert removal of pre-existing legacy app parameters or credentials from storage. Logout immediately clears local authority, tenant views and query state, then revokes known native sessions. The adapter retains at most four actor-client instances so a failed known-session cleanup can be retried before a later login. Each outer app continuation has its own generation fence in addition to the strict client's fence. A replaced attempt cannot revoke a newer session on the same actor client. The [client lifecycle limitations](../services/authority-client/README.md) still apply, including sessions whose grant was never received and cleanup interrupted by closing the app.

## Evidence

`IndependentStagingApp.spec.jsx` renders the actual app components with a modeled transport and proves login, agency selection, names-only roster, logout and stale-read removal while rejecting any Base44 SDK or public-settings client construction. Adapter tests cover configuration pins, exact projections, unsupported operations, current authority, cursor scope, outer continuation fencing, replacement login and retryable cleanup. These component tests do not establish real Auth/database behavior; the separate fresh-stack Chromium acceptance must provide that evidence before this entry is described as working against a real backend. Neither local test category establishes customer-data restoration, hosted enrollment or full-chart acceptance.
