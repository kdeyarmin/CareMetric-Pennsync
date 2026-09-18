# Independent synthetic browser acceptance

This isolated test build drives real Chromium against the owned local Supabase stack. It uses the unchanged strict `createStagingAuthorityClient`, actual password sign-in and signed Auth sessions, and real named context/patient RPCs. Four users are created through the supported local Auth Admin API; only independent synthetic authority tables are seeded by SQL. These local users do not prove hosted enrollment or migrate the existing Base44 accounts.

The test-only esbuild alias replaces `@/api/base44Client` **only in this bundle**. It allows the unchanged `listAuthorizedPatients` wrapper's roster/page contract and `getAuthorizedPatient` wrapper's display contract. Unsupported functions, purposes, filters and operations fail. Cursor identity and membership revisions are rechecked against current authority. The existing patient-name formatter renders a roster and patient name. The synthetic `display_name` is split into synthetic first/last names without manufacturing clinical fields. This is not the existing full Patients/PatientDetails route, a clinical chart, or a production adapter.

The browser asserts all four role rosters, pagination, permitted patient names, foreign patient/agency denial, logout, immediate visible-state clearing, native old-token denial, principal switching, delayed genuine responses, network failure, and fresh-context sign-in. The delay/failure hooks share a POST-only predicate with focused tests rejecting OPTIONS, other methods and unrelated destinations. Delayed responses must contain the expected signed actor, authority contract, scope and exact synthetic patient projection before the race proceeds; their API bytes are delivered unchanged. Browser service workers are blocked; HTTP and WebSocket routes reject and count every non-allowlisted destination, including every Base44 request. A single attempted forbidden request fails acceptance. The bundle graph also refuses production SDK/client imports.

Preflight generation remains the browser's responsibility. An explicit JavaScript `fetch` using method OPTIONS is a separate anonymous RPC request, not proof of a POST preflight, and the test does not require that request to succeed. The pinned [CLI 2.109.1 REST gateway](https://github.com/supabase/cli/blob/v2.109.1/apps/cli-go/internal/start/templates/kong.yml) uses the CORS plugin from [Kong 2.8.1](https://github.com/Kong/kong/blob/2.8.1/kong/plugins/cors/handler.lua), which short-circuits OPTIONS only when both Origin and Access-Control-Request-Method are present. The predicate regression proves hook selection; actual Auth/API behavior still requires the full browser CI run.

The separate credential-free `browser-boundary.test.mjs` launches Chromium without Auth and deliberately attempts two Base44 URLs and an undeclared local resource. Routing must abort all three before delivery. These intentional negative probes do not run inside the real Auth acceptance scenario, which requires zero forbidden attempts.

Passwords remain in the test process and password form transiently. Keys/tokens, CLI output, Auth bodies and Playwright call logs are never printed. The browser gets only its modern publishable key; the local admin key remains in Node. Traces, screenshots, videos, HAR, storage-state files and browser console forwarding are absent. Debug logging is refused before credentials are generated. The form clears passwords on submit; the client stores tokens in memory only. Exceptions emit a fixed phase label rather than raw Playwright errors. No customer data, hosted target, email, production selectors, current route behavior, package identities, URLs or release controls change.

## Run

Use a fresh dedicated Docker job: the existing HTTP suite intentionally mutates/revokes its fixtures and must not run first in this same stack. The lifecycle wrapper validates and pins the local daemon and refuses pre-existing project containers/volumes or linked projects. Install root dependencies using the [central local setup](../../../CONTRIBUTING.md#local-setup) linked from the [root README](../../../README.md#github-and-contributing), then install and run the isolated harness below. This harness supplies its own local configuration and server.

```sh
pnpm --dir services/authority-store install --ignore-workspace --frozen-lockfile
pnpm exec playwright install --with-deps chromium
node --test services/authority-client/browser/browser-boundary.test.mjs
node services/authority-store/tests/http-local-stack.mjs start
node --test services/authority-client/browser/browser-acceptance.test.mjs
node services/authority-store/tests/http-local-stack.mjs stop
```

The dedicated `pennsync-browser.yml` job always performs scoped stop, including on test failure. It uses the same verified CLI 2.109.1 archive and both binaries as the HTTP job. The harness binds only `127.0.0.1:4179`, refuses to reuse a listener, serves three exact resources from memory and has no general filesystem server. The local API remains pinned to `127.0.0.1:54321`; the database URL is obtained only through validated owned-stack status.

## Limits

The full browser claim requires the dedicated Docker-backed CI job to pass. Bundle/lint checks or SQL tests alone do not satisfy it. Races cover authenticated patient reads, not a password sign-in still creating a provider session; reconciling uncertain session creation is separate work. The test does not implement production AuthContext/tenant realm selection, cross-tab sessions, idle/offline recovery, all patient purposes, full chart data, hosted URLs, native WebViews/devices, clinical writes or customer migration. A successful run establishes the bounded independent browser read slice only. Existing production behavior and external release/browser controls remain unchanged.

The routing and genuine-response delay use the supported [Playwright network APIs](https://playwright.dev/docs/network), with service workers blocked so requests cannot bypass browser-context routing.
