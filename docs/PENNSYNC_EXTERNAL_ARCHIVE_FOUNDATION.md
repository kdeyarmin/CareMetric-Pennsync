# Offline encrypted archive foundation

`tools-pennsync-archive.mjs` builds and validates an encrypted bundle from **already supplied, authorized local JSONL exports and file bytes**. It has no Base44 client, network access, record importer, customer enrollment, source deletion or production activation path. It is an executable foundation for the external migration, not a completed customer backup.

## Inventory and design decision

The existing September 3 runbook describes old PENNSync → CareMetric reconciliation. It is not the Base44 exit. Those apps have independent identity spaces, and their dated inventory had no overlapping User or Patient IDs. The supplied-export format therefore keys every record by `(source_app_id, entity, id)`.

The allowed sources are:

| Source | Exact app ID |
| --- | --- |
| Old PENNSync | `68ee80d98929370f9e8f2932` |
| CareMetric production | `694ec16e72e01b60d22f7cbf` |
| Synthetic staging | `6a9881683dc68a0bd54f1ef7` |

Old and current production may coexist in one bundle with distinct namespaces. Staging must be alone. Identical record IDs across the two production sources are preserved; duplicate IDs within one source/entity are rejected. Explicit target subject and agency maps are mandatory, and two source identities cannot silently collapse onto one target subject. Consolidation needs a separate reviewed implementation.

The current metadata review found 253 production entity schemas, including 119 with all direct CRUD RLS operations false. The local feature path already distinguishes private Base44 handles from external `cmfile` handles. This tool changes neither the schemas nor those runtime contracts.

Base44's documented table backups exclude app users and uploaded files; restore rewrites the selected production tables. Its CSV import appends rows and does not establish preservation of native identities or exact nested values. This foundation therefore accepts explicit exports instead of inventing a vendor snapshot/restore API. [Backup & Restore](https://docs.base44.com/Enterprise/backup-and-restore), [Managing app data](https://docs.base44.com/Building-your-app/Managing-your-app-data).

## Run locally

Use Node 24.18 or newer. No additional dependency is required.

```text
node --test tools-pennsync-archive.test.mjs
node tools-pennsync-archive.mjs build
node tools-pennsync-archive.mjs verify
node tools-pennsync-archive.mjs resume
```

The operation is the only command-line argument. Provide these through the trusted launch environment:

- `PENNSYNC_ARCHIVE_INPUT_DIR`: directory containing `plan.json` and supplied input files; required for build/resume.
- `PENNSYNC_ARCHIVE_DIR`: a new destination directory for build, or an existing sealed bundle for verify/resume.
- Exactly one key source: `PENNSYNC_ARCHIVE_KEY_BASE64` containing the canonical base64 encoding of a securely generated 32-byte key, or `PENNSYNC_ARCHIVE_KEY_FD` naming an inherited readable descriptor. Descriptor `0` reads from stdin, including an optional final newline. The launcher must close input after the key. Stdout/stderr descriptors are rejected.

Provision and retain the key using the operator's approved secret store and recovery process. Do not put it in an argument, source file, shell history or log. The CLI removes the key environment value and clears its owned key buffers; immutable strings and caller-owned process state cannot be guaranteed erased by JavaScript. Library callers supply a 32-byte Buffer and remain responsible for clearing their caller-owned copy. There is no default password or generated-and-lost key.

Input files already exist in plaintext before this tool runs. Keep them in the approved restricted/encrypted input location. The tool never creates a plaintext output copy. On Windows, POSIX mode requests do not establish an ACL policy; the encrypted output remains encrypted independently of filesystem access controls.

## Supplied-export contract

The exact `plan.json` top-level fields are:

```json
{
  "format": "pennsync-supplied-export",
  "version": 1,
  "source_apps": ["6a9881683dc68a0bd54f1ef7"],
  "snapshot_evidence_sha256": "<64 lowercase hexadecimal characters>",
  "collections": [],
  "identities": {"path": "identities.jsonl", "bytes": 0, "sha256": "<sha256>", "rows": 0},
  "agencies": {"path": "agencies.jsonl", "bytes": 0, "sha256": "<sha256>", "rows": 0},
  "files": []
}
```

This is a shape illustration, not a ready-to-use manifest. The tests construct and run complete synthetic manifests with User, Agency, Patient, Document, mappings and private binary bytes. Supplied evidence hashes are integrity bindings only; this tool does not authenticate the person or provider making the claim.

Every descriptor has a relative `path`, exact byte count and SHA-256. Paths are restricted to ASCII letters/digits, `_`, `-`, `.`, and `/`; absolute paths, dot segments, empty segments and symlinks beneath the chosen root are rejected. Select a stable operator-controlled input directory; this is not a hardened filesystem sandbox against a concurrently malicious local administrator.

Each collection additionally declares:

- `source_app_id`, `entity`, `rows`, and an exact allowlist of top-level `fields` (including `id`). A row may omit optional fields; it cannot contain undeclared fields.
- `references`: objects with `pointer` and target `entity`. Targets must exist in the same source namespace. If both endpoint records have an agency scope, their agencies must match. User principals and explicitly reviewed global records have no agency scope; their edges require target existence but do not establish tenant membership or runtime authorization. JSON Pointers support `*` for array elements, such as `/previous_versions/*/document_id`.
- `file_references`: JSON Pointers to file locator strings.
- `opaque_fields`: reviewed pointers that are identifiers/URLs but not record/file edges. This is an explicit classification, never evidence of authority.
- `scope`: `{ "kind": "principal" }` for User; `{ "kind": "agency_root" }` for Agency; `{ "kind": "agency", "pointer": "/agency_id" }` for a tenant record; or `{ "kind": "global", "decision_sha256": "<sha256>" }` for explicitly reviewed global content. Null or missing tenant authority is rejected.

Each source must include both User and Agency collections, even if an explicit zero-row export applies. Every imported User requires exactly one identity mapping JSONL row:

```json
{"source_app_id":"6a9881683dc68a0bd54f1ef7","user_id":"000000000000000000000001","target_subject":"external-user-1","decision_sha256":"<sha256>"}
```

Each Agency similarly requires `source_app_id`, `agency_id`, `target_agency_id`, and `decision_sha256`. Maps with extra fields, unknown users/agencies, duplicates, missing entries, malformed IDs or conflicting target identities fail. These are reference maps, not target user creation or proof of migrated passwords, OAuth identities, sessions or MFA.

Every file descriptor additionally declares `source_app_id`, `file_id`, original `access` (`private` or `public`), `agency_id`, `owner_user_id`, `original_name`, `source_locator`, and `bindings`. The original filename and exact durable source handle remain inside the encrypted plan, including for an unreferenced object. `file_id` is the producer-assigned immutable archive object ID, not an invented Base44 file API ID. A binding contains `entity`, `record_id`, exact non-wildcard `pointer`, and `locator_sha256`. The referenced field's exact string and the file descriptor's source locator must have that hash, and a tenant-scoped parent must match the file's agency. The owner and agency must exist. Every declared nonempty file field requires exactly one binding. An explicitly inventoried unreferenced object may have an empty bindings array but still requires its owner and agency. The source locator is never fetched. File bytes must already have been supplied through an authorized process.

Every `_id`, `_ids`, `_url`, `_urls`, `_uri`, or `_uris` field found recursively needs an explicit relation, file, opaque or scope classification. This is a naming tripwire, not full semantic discovery. Embedded JSON strings, arbitrary HTML, novel names and application-specific references still require the complete consumer/schema inventory. The output reports this limitation explicitly.

A descendant pointer only classifies ancestor fields that were actually traversed as objects or arrays. Traversing through a present scalar or null fails, so `/assigned_user_id/missing_child` cannot hide an unchecked scalar ID. Absent optional children, validated object containers and empty arrays remain supported; null reference leaves require a policy ending at that leaf.

## Credential exclusion

Never supply password hashes, service keys, OAuth/access/refresh tokens, session cookies, MFA seeds, recovery codes or a credentials export. Secret/token/session/credential/OAuth-like entity names are unsupported. The recursive field guard rejects credential-like property names, including escaped or differently punctuated spellings; signed credential URLs, credential parameters in URL fragments and URLs with embedded username/password are rejected too. URL strings requiring whitespace or control-character normalization are rejected instead of rewritten. Durable file locators must already be trimmed and contain no control characters. Duplicate JSON keys and invalid UTF-8 are rejected rather than interpreted ambiguously.

These checks are defense in depth. They cannot classify secret material hidden in arbitrary prose, an encoded string or opaque binary bytes. The export producer must supply reviewed credential-free entity projections and intended customer files. Unsupported entities/fields must remain accounted for separately, never silently counted as transferred. This archive format deliberately cannot establish a complete authentication backup.

## Encryption, bounded processing and restart behavior

- Each archive uses a fresh random salt and archive identifier. HKDF-SHA-256 derives a distinct AES-256-GCM key from the operator-provided 32-byte key.
- JSONL/file bytes are read in bounded chunks and retained exactly, including original whitespace, CRLF, omitted/null fields and binary bytes. Records are never serialized back over their supplied bytes.
- Each encrypted frame has a fresh 96-bit nonce, a 128-bit authentication tag, and authenticated context binding the archive identity, slot and byte count. The final encrypted manifest binds the exact input plan, item paths, hashes, sizes and ordered frame inventory.
- Only the non-sensitive format/version, random archive identifier and salt are plaintext. Row IDs, input paths, counts, file handles and original names remain in encrypted content. Directory filenames are numeric slots.
- Input integrity and references are checked before writing, inputs are hashed again while encrypting, and the sealed result is fully decrypted/revalidated in memory before success is returned. No plaintext extraction directory is created.
- Current bounds: 1 MiB JSONL lines and encryption frames, 2 MiB plan, 16 MiB final manifest, 128 MiB per supplied file, 2 GiB total input bytes, 100,000 entity rows, 500,000 declared relationship/file edges, 1,000 collections and 10,000 files. Identity and agency maps are independently bounded to 100,000 rows. Oversized inputs fail rather than truncate.
- Verification rejects missing/reordered/corrupt frames, a wrong key, changed header, absent final seal, unexpected directory entries, bad hashes and incomplete relationships.
- Build requires a new directory and exclusively creates every output file. Failure can leave encrypted partial output; it is never silently overwritten or deleted.
- `resume` means **idempotently reuse an already sealed archive only** after revalidating the current supplied inputs, exact plan hash and all encrypted content. Partial appends are not supported. A partial bundle requires a new destination and an operator retention decision for the incomplete bundle. This is not a vendor cursor, online export resume or cross-table snapshot guarantee.

Successful stdout contains aggregate counts and a fixed status only. Failures print a fixed message without source fragments, paths, IDs or key values. The library exposes errors to its caller; avoid logging arbitrary underlying I/O exceptions in integrations.

## What remains before a complete transfer

Every successful report deliberately retains `full_transfer_complete`, `source_snapshot_verified`, `credential_migration_verified`, `relationship_contract_coverage_verified` and `hosted_restore_verified` as **false**. The checks establish integrity of the supplied offline set, not completeness of Base44 source data or authorization of a target release.

Remaining independent work includes a supported consistent source snapshot/change boundary, all-source record and private-object census, reviewed legacy ownership mappings, an external authentication enrollment/migration strategy, reversible target database import, actual restore rehearsal, provider reconnection, two-agency access proof and web/native acceptance. Existing URLs, package identities, RLS, source apps, source data and integration release controls are untouched by this change.

Focused validation: the executable tests cover exact-byte round trip through an independent decryptor; separate-source same-ID preservation; wrong key/corruption/truncation/header substitution; missing seal and extra frames; sealed resume and changed inputs; missing identity/file manifests; duplicate IDs; wrong-source/orphan/cross-agency references; descendant-policy scalar traversal; ambiguous mappings; nested credentials, URL whitespace/control characters and fragment credentials; duplicate JSON keys; file owner/binding checks; empty reference arrays; explicitly unscoped principal/global references; bounded large-file frames; path/symlink refusal; and actual CLI stdin key delivery. This is synthetic evidence only.
