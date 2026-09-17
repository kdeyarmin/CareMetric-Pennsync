# Provider CSV import without a built-in storage integration

## Change

The provider-directory CSV importer previously uploaded the file through
`Core.UploadFile`, then immediately downloaded that copy in `importProvidersCsv`
solely to parse its text. The updated browser reads the selected UTF-8 CSV locally
and sends `csv_text` directly to the same authorized import function.

No copy is created in paid integration storage by the updated UI. The existing
privileged importer, field mapping, NPI/name-fax matching, and directory writes
are unchanged. The legacy `file_url` request remains accepted so already-open
older clients and existing hosted files are not silently broken. Old files and
URLs are not deleted, moved or rewritten.

The 10 MiB file limit remains. The browser verifies actual bytes and valid UTF-8;
the server independently verifies the direct text byte size and requires exactly
one input source. Malformed JSON, invalid direct text, and dual-source requests
are rejected before directory reads/writes. The user must re-export non-UTF-8
CSV files instead of importing replacement characters in names.

Only one UI import runs at a time. Current tenant authority is checked before
reading, before submission, and before displaying success. Unmounts and stale
responses cannot trigger a late directory-refresh callback. Failed/uncertain
submissions do not retry via a paid upload; the message tells the user to refresh
the directory before retrying. This change does not make partial directory
mutations transactional or claim that an interrupted import rolled back.

## Verification before release

- 21 actual-handler tests (transpiled TypeScript with synthetic SDK/store/fetch)
  passed. These cover direct/legacy parity, update matching, no direct-path
  download or Core invocation, malformed and oversized input, UTF-8 byte limits,
  authorization refusal and preserved redirect guards.
- 13 UI/accessibility tests passed, including exactly one csv_text invocation,
  no Core-upload fallback, file validation, stale/unmounted reads, duplicate
  submission suppression, malformed result handling, and safe error messages.
- Full application tests passed, including 1,714 component assertions across
  220 files. A shallow-checkout prerequisite initially lacked the native-asset
  comparison baseline; fetching that exact baseline repaired the validation
  environment without changing the preservation test or app dependencies.
- Lint, high-signal typecheck, 282 backend target/syntax checks and 225 generated
  helper checks passed. The informational type baseline is not claimed clean.
- The hosted-style build passed; 500 generated JavaScript files were inspected
  without diagnostic findings. Dependency versions/lockfile and native/public
  package files were not changed.

## Scope limits

This removes one unnecessary built-in integration from the provider CSV workflow.
The final authorized import function still runs on Base44 and can incur its
ordinary function-execution charge. Other upload/import paths remain separate
migration work. No claim of complete zero-credit migration, actual billed-credit
savings, a real administrator import or hosted maximum-size acceptance is made
from these synthetic/source tests. Do not add a silent paid storage fallback.
