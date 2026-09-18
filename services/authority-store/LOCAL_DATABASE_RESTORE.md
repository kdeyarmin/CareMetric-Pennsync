# Disposable local database backup and restore

This rehearsal adds a real PostgreSQL database dump and restoration to the existing SQL and private-file proofs. It creates both its source and destination databases from scratch on a deliberately supplied loopback PostgreSQL lab. It cannot adopt an existing source or target database, copy a hosted/customer database, configure cluster roles, or change production routing or release controls.

The retained proof is limited to **local synthetic database restoration**. It does not satisfy the offline cutover validator's `archive_restore`, `sessions`, `rollback` or `cutover` gates. Those require complete customer/source inventories, actual provider identities and files, write admission control, in-flight/final-delta reconciliation, deployment/routing recovery and independent operational receipts. The validator and existing acceptance plan remain unchanged.

## What is actually restored

The source is built from the tracked independent authority migrations and recovered integration-runtime migrations. Four local Auth test identities, two agencies, three synthetic patients, assignments and administrative receipts exercise the current authority contract. Three S4 saves produce Visit, history, conversion, audit and receipt records. Three S3 referrals retain one pending referral, two confirmed referrals and all five create/confirmation receipts. The runtime fixture includes three private-file metadata records with object paths and SHA-256 values, object catalog rows, four durable job states, quota state, a cron registration and an unrelated synthetic sentinel.

The test invokes real `pg_dump --format=custom` and `pg_restore --single-transaction --exit-on-error`, without schema/table filters, `--clean`, `--create`, `--no-acl`, or `--no-owner`. Source and destination use the same existing lab roles. A truncated native archive must fail with the destination still exactly empty, before the complete archive is restored.

The backup is encrypted with AES-256-GCM and a fresh one-run key. Only ciphertext is written to the owned temporary file; the database dump, decrypted bytes, key and connection credentials remain in process memory. The archive is bounded to 32 MiB for this synthetic fixture. Authentication and the expected dump SHA-256 are checked before any restore process receives decrypted bytes. Missing/truncated/modified envelopes, a wrong key and a wrong expected hash are rejected. The temporary ciphertext is deleted and primary plaintext/key buffers are cleared before the successful receipt is retained. No usable backup or encryption key is retained after the test: this demonstrates the operation, not key escrow or unattended disaster recovery.

## Reconciliation and security checks

Every ordinary table in every non-system schema is inventoried dynamically, including the local Auth, Storage and cron doubles. Canonical PostgreSQL JSONB row representations are sorted with the `C` collation. The retained manifest records table counts, a table SHA-256 and individual row SHA-256 values. Source and destination manifests must match exactly, retaining immutable IDs, identity/tenant mappings, clinical artifacts, request receipts and reference fields. A same-count record mutation must change the manifest hash.

The catalog comparison covers schemas, relation owners/effective grants/RLS flags, columns/defaults, function signatures/bodies/owners/grants/search paths, constraints, indexes, triggers, policies, default grants, domains and sequence state. PostgreSQL can restore an explicit owner-only ACL as its equivalent default ACL, and can rewrite redundant Boolean parentheses. The comparison uses effective default ACLs and PostgreSQL's own pretty constraint definition, preserving the permission and constraint meaning instead of treating those equivalent storage representations as a failure. It does not discard constraints or suppress mismatched hashes.

After restoration, the test checks all four rosters, exact Auth UUID/legacy mappings, eight foreign/unassigned-patient denials, exact S4 read/retry artifacts, changed-payload and stale administrative receipt denial, direct private-table denial, forced RLS after a rolled-back accidental SELECT grant, and current native-session/membership revocation. S3 checks retain exact current referral payloads and pending/confirmation replays, reject obsolete create receipts after confirmation, and reject nine assigned-clinician, unassigned-clinician and foreign-agency operations. The runtime probes verify file owner/app scope, unique object bindings, completed/uncertain/exhausted/expired job behavior, stale claim and payload conflict denial, preserved quota accounting, browser table/RPC denial and the restrictive storage policy. All verification mutations are rolled back; the final restored and source snapshots must remain unchanged.

## Running and retained receipt

Use the existing local test lab with `anon`, `authenticated`, and `service_role` already present. Browser roles must not have superuser/BYPASSRLS. The harness strips the older Auth-double role-provisioning block instead of creating missing roles. It requires a PostgreSQL 17 lab administrator and real PostgreSQL 17 `pg_dump`/`pg_restore` binaries. No dependency download, server startup, global role provisioning, database reset or hosted operation is part of the test.

```powershell
$env:PENNSYNC_TEST_PG_URL='postgresql://postgres@127.0.0.1:54339/postgres'
$env:PENNSYNC_TEST_PG_BIN='C:\Program Files\PostgreSQL\17\bin'
node --test services/authority-store/tests/restore-postgres.test.mjs
```

The URL must end with `/postgres`, have no query/fragment and use a loopback host. It identifies the administrator connection only. Both database names are generated internally with unique `pennsync_restore_source_...` / `pennsync_restore_restored_...` names. Cleanup drops only databases whose creation succeeded in this run. No forced connection termination, overwrite or unscoped deletion occurs. Child process diagnostics and failed SQL-tool output are suppressed behind fixed error codes; keys, connection strings and record values are never copied to those errors.

Successful sanitized receipts are written with exclusive creation under `work/restore-rehearsal/receipt-<random>.json`. They retain the Git revision/source-dirty flag, exact applied migration-byte hashes, tool/server versions, dump/ciphertext hashes, both complete hash manifests, executed assertions and explicit limits. Generated receipts and encrypted temporary files are local artifacts and must never be committed. A development run with uncommitted source is marked dirty; final evidence must be rerun on the reviewed immutable commit. The generated `work` directory is excluded from that source-dirty check.

## Boundaries that remain unproved

- Auth users/sessions are local SQL doubles. Preserving those rows cannot prove restoring a hosted Auth provider, provider signing keys, password/MFA state, recovery login, refresh tokens or real session invalidation across deployments.
- Storage rows are metadata only. The existing actual Storage HTTP single-file proof remains separate; this dump does not contain private object bytes or prove bulk object recovery.
- The runtime result is an explicitly synthetic opaque marker. Its preservation does not prove cached-result decryption, production encryption-key recovery or provider-side effect reconciliation.
- Cron is a catalog double, without a running worker. Global roles/configuration, extensions and provider services are not backed up or reconfigured by this rehearsal.
- The source is a quiescent owned fixture. No write freeze, concurrent admission, in-flight reconciliation, final delta, reverse migration, frontend/native artifact restoration or production rollback is claimed.
- Equal hashes are reproducible local comparisons, not an independent attestation or authority to enable integrations, change identities, delete sources or remove Base44.

The `Verify authority transactions` CI job runs this command sequentially after its existing native suites, using the same disposable PostgreSQL 17 service and an explicit loopback URL. Its Ubuntu runner installs only `postgresql-client-17` from the official signed PGDG repository for the runner's validated distribution codename and selects `/usr/lib/postgresql/17/bin`; it does not install/start another server or configure roles for the restore test. The harness checks both client major versions and records the actual versions in its receipt. The successful sanitized JSON receipt is retained as a CI artifact for seven days; ciphertext, keys and dump bytes are never uploaded.

Interfaces checked against PostgreSQL 17 documentation: [pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html), [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html) and the [official PGDG setup/package instructions](https://www.postgresql.org/download/linux/ubuntu/). PostgreSQL 17.10 tools are available in the current local lab. The [runner installer](https://github.com/actions/runner-images/blob/main/images/ubuntu/scripts/build/install-postgresql.sh) removes its PGDG source/key after building the image, so the CI setup adds that signed repository only when absent.
