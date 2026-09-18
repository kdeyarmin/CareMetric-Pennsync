# Explicit staging acquisition contract

`tools-pennsync-acquire.mjs` captures **only an explicitly enumerated synthetic fixture set** from staging app `6a9881683dc68a0bd54f1ef7`. It has no broad entity-list call, production/legacy target, service-role fallback, file download, source write, restore or release-control operation. This implementation has been exercised with synthetic SDK responses, not with customer records or an authenticated hosted entity capture.

The supported source call is `base44.entities[entity].filter({id: {$in: ids}}, 'id', 100, skip, fields)`. IDs and fields must come from the reviewed permit; empty ID inventories cause no request. The method, projected fields, sort and offset arguments are documented in the [Base44 entity reference](https://docs.base44.com/developers/references/sdk/docs/type-aliases/entities). The [CLI exec](https://docs.base44.com/developers/references/cli/commands/exec) route executes locally in Deno and supplies its already authenticated SDK. The inspected local CLI was 0.1.15; no new account token is copied or exported by this tool.

## Permit producer and trust

The producer is the operator/reviewer responsible for the existing synthetic fixture registry, source schema inventory and explicit target identity/agency decisions. That producer creates a JSON payload with exactly these keys:

```json
{
  "format": "pennsync-staging-capture-permit",
  "version": 1,
  "source_app_id": "6a9881683dc68a0bd54f1ef7",
  "data_environment": "prod",
  "privilege": "user",
  "producer": "reviewed-synthetic-fixture",
  "inventory": "explicit-fixture-ids",
  "valid_from": "<ISO timestamp>",
  "valid_until": "<ISO timestamp no more than 24 hours later>",
  "schema_sha256": "<hash of the separately reviewed source schema evidence>",
  "collections": [],
  "identities": [],
  "agencies": []
}
```

Each collection has exactly `entity`, `fields`, `ids`, `references`, `file_references`, `opaque_fields`, and `scope`. The last four use the [existing archive contract](PENNSYNC_EXTERNAL_ARCHIVE_FOUNDATION.md). `fields` is an explicit top-level projection including `id`; `ids` is a strictly increasing, unique list of immutable 24-character source IDs. Both User and Agency collections are mandatory. `identities` and `agencies` contain the archive's explicit mapping rows and decision hashes, with exactly one mapping for each listed principal/agency. No target identities are inferred or created. See the synthetic test fixture for an executable complete payload.

User acquisition is additionally pinned in code to the four existing staging test-account IDs and their exact `info+pennsync-*` aliases. A User projection must include `email`, and each observed ID/email pair must match that registry. The actual staging owner `6a98816d3dc68a0bd54f1ef8` and every other unapproved User ID are rejected before source reads, even if a permit is correctly signed. The unit tests use known test-account metadata with invented contents; they never fetch those accounts.

Serialize that payload with `JSON.stringify` to UTF-8 bytes, without a trailing newline, and sign those exact bytes using the producer's existing Ed25519 signing key. Supply an envelope containing only `payload_base64` and `signature_base64`. The verifier receives the trusted Ed25519 **public** SPKI DER key separately as base64; it never accepts a public key carried inside the envelope. Deliver that verification key through the operator's separately trusted launch configuration. Signing-key generation, private-key storage, assignment of approvers and approval of real fixture IDs remain operator responsibilities. The adapter supplies no default signer and never reads the signing private key.

This signature verifies the origin/integrity of the local acquisition specification. It does **not** confer Base44 access, verify the producer's factual assertions, prove a schema snapshot, establish that a row is synthetic, or authorize production cutover. The source app and user-mode RLS still decide whether reads succeed. `prod` here means the data environment of the explicitly pinned **staging app**, not the CareMetric production app.

## Capture, verification and archive bridge

Capture checks the signed permit and CLI runtime app/data-environment/privilege metadata before the first entity read. The archive builder and capture share the same policy validator: exact scope forms, reference descriptors, JSON-pointer syntax, duplicate classifications and policy-array bounds reject before creating output or reading source rows. This validates the supplied specification, not the existence/types of live schema fields or the referenced records. Actual row relationships, tenant scopes and required file bindings still must pass the archive builder's reconciliation before promotion can succeed. Only the documented projected `filter` method is used. It never switches to `asServiceRole` or adds `--privileged` after an access failure. Missing, additional, reordered, duplicate or wrong-source records reject the capture. The SDK response must contain only declared fields and valid JSON values; the archive's recursive credential and signed-URL guard runs before persistence.

The first pass writes each bounded page directly to AES-256-GCM encrypted frames, using a fresh capture ID/salt and HKDF-derived key. A second full pass across the same collection sequence must return byte-identical SDK-serialized JSONL pages, including null, absent and nested values. The terminal request for every nonempty ID list must be empty. Only then is an encrypted final manifest written. The manifest contains the signed permit, projection/ID inventories, mapping decisions, schema-evidence hash, read times, ordered page boundaries, hashes and counts. The public header contains only format/version and random capture ID/salt; frame names are numeric. No plaintext export directory is created.

The acquisition encoding is UTF-8 `JSON.stringify(record) + '\n'`, reflecting values represented by the SDK. It is not the original provider HTTP JSON encoding. Row/property representation and exact archived JSONL bytes are retained after that boundary. No private file bytes are captured by this version.

Two matching passes only establish that the enumerated fixture bytes matched at those observations. They can miss ABA changes, intermediate mutations, concurrent changes outside the projection, rows omitted from the approved ID list, and cross-table changes between reads. The signed schema hash is recorded provenance, not a live schema verification. The result therefore keeps snapshot, source-inventory, private-file-inventory, credential-migration, full-transfer and cutover claims **false**. It does not describe this process as a provider snapshot or durable cursor.

Verification authenticates the manifest and every frame, checks ordered inventory/hashes, revalidates the signed permit against its original capture interval, and rejects extra files, missing seals, corruption and wrong keys. A historical sealed capture remains verifiable after permit expiry. There is no partial resume, overwrite or deletion path; a failed capture leaves encrypted partial output and needs a new destination. This deliberately avoids resuming offsets against changed source data.

`promote` decrypts the sealed capture through a repeatable in-memory reader into the existing archive builder. The archive destination must be separate from the capture: identical, ancestor and descendant directories reject before writes, including a descendant reached through a directory alias. The builder still applies all original identity/agency maps, references, tenant scopes, file bindings and final verification checks. The archive format is unchanged. Any nonempty declared file reference rejects promotion because this adapter supplies no file bytes/manifests; there is no empty-file workaround. The final archive links the encrypted capture evidence by SHA-256 through its existing evidence-hash field, and still reports `source_snapshot_verified: false`. Retain **both** the capture and promoted archive plus their recovery key; the capture retains the signed specification and detailed acquisition evidence.

## Local execution

Node 24.18+, the existing local Base44 CLI installation/authentication, and Deno are required for a live staging capture. The launcher runs the local npm `npx-cli.js` entry with `--no-install`, exact `--app-id` and `--data-env prod`; it does not install a tool or open login. It requires the npm entry beside Node or in the conventional sibling `lib/node_modules` directory. No hosted capture has been run as part of these tests.

In the inspected CLI 0.1.15, the CLI supplies `BASE44_APP_ID` and `BASE44_DATA_ENV` to its Deno worker from those command arguments. An absent `BASE44_PRIVILEGED` means false in both the CLI's SDK wrapper and this worker. A conflicting privileged runtime fails before entity reads; the launcher does not replace runtime evidence with an assumed value.

Use only the launcher for authenticated acquisition; do not invoke the worker directly through a CLI that prints raw errors. Provide these through trusted process configuration:

- `PENNSYNC_CAPTURE_PERMIT_PATH`: the existing signed permit envelope regular file, needed for `capture`. Symlink and nonregular files reject. Reads use at most 64 KiB chunks and reject beyond 4 MiB even if the file grows after its initial metadata check.
- `PENNSYNC_CAPTURE_SIGNER_SPKI_BASE64`: the independently trusted Ed25519 public verification key.
- `PENNSYNC_CAPTURE_DIR`: a new destination for capture, or a sealed capture for verification/promotion.
- Exactly one existing archive key input: `PENNSYNC_ARCHIVE_KEY_BASE64`, or `PENNSYNC_ARCHIVE_KEY_FD` (including stdin descriptor 0). The key must be a recoverably stored random 32-byte key. It is never accepted on the command line or generated as an unrecoverable default.
- `PENNSYNC_ARCHIVE_DIR`: a new archive destination for `promote`.

```text
node tools-pennsync-acquire.mjs capture
node tools-pennsync-acquire.mjs verify
node tools-pennsync-acquire.mjs promote
pnpm run test:pennsync-transfer
```

The launcher sets production SDK logging mode and captures/discards both CLI output streams. It reports only a verified aggregate receipt or a fixed failure message, including when the child throws, emits non-JSON, prints a false success, or exceeds its output limit. Child output is never a success criterion: the parent independently verifies encrypted output. A five-minute child deadline terminates its owned process tree; individual SDK page reads have a 15-second acceptance deadline. The documented SDK does not supply an abort handle for that call, so a timed-out provider read may finish before the owned process exits; it is never accepted or retried. No uncertain mutation exists because the adapter has no mutation method.

Keys are transferred to the local child only through its private process environment, removed from owned environment objects and cleared from mutable buffers. JavaScript immutable strings, the caller's environment, and an administrator inspecting local process memory are outside erasure guarantees. No application token is read or printed by this module. POSIX file modes are requested but do not establish Windows ACL policy; use the operator's approved local destination and key-recovery process.

Bounds are 20 collections, 1,000 enumerated IDs per collection, 10,000 total IDs, 100 projected fields, 100 records/request, 1 MiB accepted page, 128 MiB total represented row bytes and 4 MiB encrypted-manifest plaintext. The SDK parses its HTTP response before returning it; these page/row acceptance limits are not a streaming HTTP-body memory limit. Unsupported oversized responses fail rather than truncate.

## Remaining source requirements

A live rehearsal still needs the actual reviewed synthetic fixture-ID/projection permit, a separately trusted signer key, recoverable encryption key/destination, and proof that the authenticated user can read every enumerated User/Agency/record under current RLS. Base44 documents stricter User access; an owner/editor session must not be assumed to read all four testing accounts without testing that supported read surface. The adapter fails if any expected row is unavailable and never weakens RLS.

Whole-app acquisition additionally needs a supported cross-entity snapshot/final-delta/deletion boundary and a complete object inventory including historical and unreferenced private files. The inspected SDK provides offset pagination and signing of known private handles, not those completeness contracts. This version intentionally does not fetch or sign a file. A separate supported file-byte/ownership acquisition path, all-source projections, reviewed legacy mappings, authentication enrollment/migration, and hosted restore/access verification remain required. None is inferred from the synthetic tests.

Synthetic verification covers multi-page reads, exact represented-value round trip through an independent decryptor and archive bridge, zero-row inventories, wrong/unsigned/tampered permits, runtime source and privilege mismatch, absent/duplicate/reordered rows, observed drift, nested credentials and signed URLs, incomplete/corrupt captures, wrong keys, reference/file-reconciliation failure, and suppression of child output. A local Deno run with **no network permission** also completed synthetic capture and promotion, confirming the local execution compatibility without contacting Base44.
