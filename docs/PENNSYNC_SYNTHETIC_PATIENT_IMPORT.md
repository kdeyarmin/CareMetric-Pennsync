# Verified archive → synthetic patient business rows

`tools-pennsync-archive-import.mjs` imports a deliberately small, already verified archive into the **existing independent synthetic patient schema**. The resulting patients are readable by its current roster/detail RPCs. This is an operator tool with a private provenance receipt, not a new user API or a generic data landing store.

It never contacts Base44, creates Auth identities, creates agencies or memberships, assigns patients, imports files, alters release controls, or connects to a hosted database. It does not establish a complete app transfer, source snapshot, native enrollment, production authorization, or support for the rest of the clinical record.

## Exact supported source

The archive must have only source app `6a9881683dc68a0bd54f1ef7`, exactly these three collections, their required identity/agency maps, and **zero file descriptors**:

| Collection | Exact fields | Action |
| --- | --- | --- |
| User | `id`, `email` | Reconcile the four existing test-account registry identities against pre-existing native Auth UUIDs and immutable identity provenance. No account creation. A supported subset must contain the administrator of each imported agency. |
| Agency | `id`, `agency_name`, `status` | Reconcile an explicit map to existing `agency-a` or `agency-b`. Name/status must match exactly; current agency and admin membership must be active/trial and version 1. No agency or grant creation. |
| Patient | `id`, `agency_id`, `first_name`, `last_name` | Insert the original 24-hex ID into the mapped existing agency. Preserve the exact canonical name as `first_name + ' ' + last_name`. |

`first_name` must be exactly `Synthetic`. The combined name must start `Synthetic ` and contain only bounded ASCII letters, numbers, spaces and hyphens, with no leading/trailing or doubled spaces. No replacement or fallback name is invented. The original name components and exact JSONL bytes remain in the retained encrypted archive. The target's `synthetic=true`, `version=1`, and `status='active'` are explicit properties of this finite synthetic projection; arbitrary production status or omitted clinical fields are **not** represented as preserved.

User email/ID pairs use the same fixed four `info+pennsync-*` aliases as acquisition; the protected owner and every other User are unsupported. Target native UUIDs come only from explicit identity maps. All referenced native users must already be confirmed, nonanonymous, nondeleted and unbanned, and match existing enabled identity maps with valid verification evidence. The importer does not attest how those independent mappings were originally verified.

All extra fields, extra collections, files (including empty or unreferenced files), production/legacy sources, invalid or ambiguous mappings, name normalization and unsupported scope policies reject **before the target connection**. Bounds are 4 users, 2 agencies, 100 patients and 256 KiB total collection/map bytes. User/Agency policies are principal/agency-root; Patient has agency scope `/agency_id`. This slice accepts no additional reference/file/opaque policies.

## Verification, ownership and transactions

The operator must supply the expected SHA-256 of the exact raw archive plan. The existing archive verifier authenticates every frame and seal and checks all rows, mappings, file manifests and relationships before its new scoped callback starts. The callback's canonical path reader reauthenticates frames and rechecks full item bytes/hashes; changed descriptors and use after the callback closes fail. Its owned key and yielded buffers are cleared. Importers must await complete reads and copy a yielded buffer if retaining it.

Only two target forms are supported:

- `owned-stack`: the existing local test harness must prove its exact worktree/project/daemon ownership and fixed `127.0.0.1:54322/postgres` endpoint. No existing unowned stack may be adopted. PostgreSQL itself listens on 5432 inside that owned container.
- `native`: a pre-provisioned disposable database on literal `127.0.0.1`, port **54339** (desktop lab) or **5432** (CI service), user `postgres`, exact database name `pennsync_import_<32 lowercase hex>`, no URL query/fragment, and database comment `PENNSYNC_IMPORT_TARGET_V1:<SHA256 of the separately retained owner key>`. The importer never creates, drops, or takes ownership of a database. Unknown targets are refused. The native harness creates only its own random database and requires the three existing test roles; it never creates/deletes cluster roles.

Each operation takes the existing app-wide transaction lock under READ COMMITTED, locks current native identities and authority, and checks owned patient/receipt tables, exact column order, forced RLS, no policies/rules/user triggers and no browser/service table or column grants. It locks patient/receipt and the three expected dependent tables through the transaction, verifies the exact assignment/referral/visit patient FK columns and requires validated, nondeferrable NO ACTION or RESTRICT delete actions. A missing, extra or cascading patient FK refuses the operation. Source reads and mappings are completed before these transactions. Ordinary API replay behavior is unchanged.

All patients and the operator receipt commit in one transaction. The separate `pennsync_private.archive_patient_import_receipt` binds source app, exact plan hash, operator ownership digest, actual patient projection hash/count, canonical original patient IDs, database and database role. It has FORCE RLS, no allowing policy and no browser/service grants. It does not pretend the operator was a signed-in app user.

An exact retry reconciles current patient fields, versions and receipt; it performs no second insert. Unreceipted matching rows are not adopted. Different source bytes or mappings, a different owner, changed patient fields/status/version, or a receipt copied into a different database refuse. A connection error during COMMIT returns **unknown outcome**, with no automatic business retry, deletion or success claim. Run explicit `reconcile` with the same archive, keys and target. If no receipt exists, reconciliation reports not applied; it does not start a new import.

`rollback` deletes only the unchanged patients in that exact verified batch, under the same lock. Verified assignment/referral/visit foreign keys refuse deletion when dependent work exists; it never cascades. A terminal `rolled_back` receipt retains the patient IDs, so lost rollback acknowledgements can be reconciled. Every different plan that overlaps any prior receipt's patient IDs refuses, even when the old batch was rolled back, only evidence bytes changed, patient fields changed or the new batch overlaps partially. It does not undo unrelated Auth, agency, membership or source data. This model assumes trusted local migration administrators; it is not protection against a superuser forging receipts or disabling constraints.

## Running

Install the existing isolated PostgreSQL dependency with `pnpm --dir services/authority-store install --ignore-workspace --frozen-lockfile`. No new dependency is added.

```text
node tools-pennsync-archive-import.mjs import
node tools-pennsync-archive-import.mjs reconcile
node tools-pennsync-archive-import.mjs rollback
```

The action is the only command-line argument. Supply configuration through a trusted launcher:

- `PENNSYNC_ARCHIVE_DIR`: existing sealed archive directory.
- `PENNSYNC_IMPORT_PLAN_SHA256`: independently selected exact raw-plan hash.
- `PENNSYNC_IMPORT_TARGET`: `owned-stack` or `native`.
- `PENNSYNC_IMPORT_DATABASE_URL`: required only for the restricted native target.
- Exactly one `PENNSYNC_ARCHIVE_KEY_BASE64` or `PENNSYNC_ARCHIVE_KEY_FD`.
- Exactly one `PENNSYNC_IMPORT_OWNER_KEY_BASE64` or `PENNSYNC_IMPORT_OWNER_KEY_FD`.

Both keys are separately retained random 32-byte values; no insecure or unrecoverable default exists. FD 0 or an inherited readable FD ≥3 is accepted. Close each input after the canonical base64 key and optional newline; do not feed both keys through the same consumed descriptor. Never put keys or passwords in command-line arguments or logs. The CLI clears owned key buffers/environment values. JavaScript strings and caller-owned copies cannot be guaranteed erased; library callers own their key buffers.

There is no plaintext extraction directory, dump, row-valued stdout or raw provider-error logging. Only the intended synthetic business rows are stored in PostgreSQL. Before any parameter-bound query, fixed SQL `SET LOCAL` statements disable statement/parameter error logging, and the importer verifies the exact settings or refuses. These are intentionally absent from connection startup options: the pinned Supabase image [demotes postgres from superuser](https://github.com/supabase/postgres/blob/17.6.1.143/migrations/db/migrations/10000000000000_demote-postgres.sql), while its [Supautils configuration permits selected logging settings](https://github.com/supabase/postgres/blob/17.6.1.143/ansible/files/postgresql_config/supautils.conf.j2) through SQL SET. No privilege grant or logging fallback is used; external administrator-controlled logging is outside the tool's control. The source archive is retained byte-for-byte and must remain available with its recovery key for reconciliation/rollback. The importer never edits or removes it.

## Executable evidence and limits

```text
node --test tools-pennsync-archive-import.test.mjs
node --test tools-pennsync-archive-import.postgres.test.mjs
node --test services/authority-store/tests/http-archive-import.test.mjs
```

The first suite needs no database and runs in `test:pennsync-transfer`. It covers fully verified callback timing, exact bytes, late/corrupt reader refusal, finite source rejection including files, target URL restrictions and CLI redaction.

The native suite requires `PENNSYNC_TEST_PG_URL` identifying the explicit local `/postgres` lab. It proves before/after **real PostgreSQL RPC** roster/detail behavior, two-agency/unassigned denials, concurrent exact replay, row/receipt interruptions, lost import and rollback acknowledgements, current authority, ownership refusal, target drift, dependent-record rollback refusal and receipt RLS. Its Auth tables are explicitly isolated local doubles; it is not real-provider authentication evidence.

The dedicated CI job additionally runs the HTTP companion after the existing owned Auth suite. It uses supported generated-link/verify operations only for the four already-created native test identities, imports fresh synthetic archive patients, checks actual signed-session roster/detail access and denials, then rolls back and reconciles. It checks the local mail sink remains empty, binds each new signed session to its native row, and logs out only those new sessions. Cleanup verifies their removal and preservation of the exact prior session baseline; failed cleanup fails the suite. No new accounts or fixture grants are made. Desktop Docker is unavailable, so actual HTTP success must be established by this CI run; local native/unit results do not substitute for it.

The restore rehearsal separately preserves a representative import receipt and its patient projections, verifies their hash and access denials, and retains the original database binding. That fixture is accurately labeled synthetic provenance, not execution of the importer or permission to replay into a restored database. A future explicit restore rebind process is still required.

Patient clinical fields, documents/private bytes, assignments, other entities, other apps and full source consistency remain unsupported. This slice makes its declared synthetic patient projection usable by the current app; it does not make the whole application migrated.
