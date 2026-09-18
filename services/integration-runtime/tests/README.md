# Recovered integration migration verification

This separate test package checks the runtime's database foundation. It adds no runtime dependency or hosted operation. The source recovery is exact authenticated migration history, not guessed DDL or a replacement clinical database.

```sh
pnpm --dir services/integration-runtime/tests install --ignore-workspace --frozen-lockfile
PENNSYNC_TEST_PG_URL=postgresql://postgres@127.0.0.1:54339/postgres node --test services/integration-runtime/tests/postgres-bootstrap.test.mjs
```

Use an explicit, isolated PostgreSQL 17 test server whose operator has already provisioned `anon`, `authenticated` and `service_role` test roles. The script rejects non-loopback targets and creates uniquely named `pennsync_integration_bootstrap_*` databases, drops only those databases, and never resets the server or creates/changes cluster roles. Existing `anon`/`authenticated` roles must not be superusers or bypass RLS. All inserted content is synthetic. No Base44, provider, customer or production service is contacted. Missing infrastructure fails the suite instead of skipping it.

Eight tests prove historical SQL hashes; complete 001–005 replay and installed-definition parity; browser CRUD/RPC denial; restrictive bucket policy despite another permissive policy; current claims, payload idempotency, pending/uncertain/completed states, safe retries and quotas; owner-bound file metadata and constraints; bounded ciphertext retention preserving tombstones/files; serialized duplicate reservations; and rejection of destructive reapplication. All tests retain unrelated synthetic sentinel data.

`platform-double.sql` provides only minimum Storage and cron catalogs/functions for native PostgreSQL. It does not implement object upload/download, signed links, a cron worker or hosted access. Its explicit service-role default table grants reproduce the installed project's observed historical ACLs; do not deploy this fixture or infer that every new Supabase project has identical defaults. The RPC bodies and integration DDL are the actual recovered and current repository migrations.

The current repository's 003 source registers `pennsync-integration-result-retention` at minute 17 hourly, reflecting the separately installed schedule. The native fixture records that metadata but runs no scheduler. No other Base44 schedules are migrated or enabled. Existing hosted resources, release controls, file bytes and package identities remain untouched.

## Actual isolated Supabase catalog smoke

After the existing owned local stack has started and its Auth acceptance suite has completed, run:

```sh
node --test services/integration-runtime/tests/http-bootstrap.test.mjs
```

This requires the authority test harness's valid local ownership marker, pinned local Docker daemon and current in-memory CLI status. It accepts only the existing fixed loopback API/database. It refuses an existing integration table/function, bucket, policy or cleanup job instead of replacing anything. Storage catalogs and native Auth must actually exist; no fixture catalog is created. If the image bundles and preloads `pg_cron`, the test initializes that real extension in its owned disposable database. Otherwise it fails with a precise prerequisite error. It verifies real scheduler metadata and immediately pauses its new retention job. It does not claim cron-worker execution or object-byte restoration.

The owned stack enables the real local Storage service and its catalog migrations, using the CLI's local file backend. S3 protocol, vector storage and image transformation remain disabled. The original Auth-only stack excluded Storage and failed this smoke's platform prerequisite; fixed per-prerequisite error codes now distinguish missing catalogs from an occupied namespace. This config changes only disposable local tests. No object bytes are uploaded.

The real gateway tests use the modern local secret key only in this Node fixture runner and the publishable key for anonymous denials. Keys remain in memory. The suite checks reserve/complete/replay, exact file ownership and cleanup RPC behavior without invoking a provider or uploading a file. Only an anonymous schema-cache miss is retried; uncertain mutations are never retried. Always run the authority harness's scoped `stop` afterward, including on failure. No hosted project is linked or changed. Actual Docker-backed success must be recorded separately; passing the eight native tests is not a substitute.

The local Storage policy migration executes as the existing managed table owner, supabase_storage_admin, through a separate in-memory connection. Pinned CLI 2.109.1 supplies its Storage service with this role and the same disposable local database password. The runner verifies exact table ownership first and changes neither managed ownership nor role membership. This is local platform-owner setup, not evidence that a hosted postgres login can apply Storage policy DDL. All other recovered migrations use the original local postgres connection.

Actual local-platform rehearsal also verifies that all three integration tables deny direct CRUD to both browser roles and service_role. The fresh image has stricter defaults than the historical project, whose grants remain recorded and checked by the native parity fixture. Runtime createStore calls only named SECURITY DEFINER RPCs, so direct service_role table grants are unnecessary and are not added. The gateway smoke separately checks the exact five service-only function grants, trusted owners, and successful server reserve/finish/replay/file/cleanup calls.
