# Mobile asset preservation during the external integration migration

## User requirement

Keep the existing Apple/Google packages and files intact while moving Base44 integration execution outside the platform. A backend migration is not a request to create a replacement store listing, upload a new binary, change a signing key, or delete existing hosted documents/media.

## Source verification completed

Baseline production commit: `1ff6018cbd94d89c98dea9a95f9e48f340faf249`.
The migration proposal was checked through `78eaaad61e45296b6d9d4a09aae402b848b382f2`.

- All **25 tracked files under ios/ and public/** have the same raw Git content hashes as the pre-migration production release. The complete file inventory is unchanged: no additions, deletions or renames in those paths.
- Those paths include the iOS wrapper, Info.plist, privacy manifest, native app icon, PWA manifest/icons, and existing packaged manuals and logos.
- Apple bundle identifier remains `com.caremetric.ai`; the existing Apple listing reference remains `6757097720`.
- The existing Google Play package reference remains exactly `com.caremetic.ai`. The spelling is intentional. This repository does not contain the full Android native source/package, so a source comparison here is not a binary acceptance test for the Android listing.
- The iOS WKWebView still starts at `https://caremetricai.base44.app/`. Its existing native origin restrictions, hardware permissions, downloads and link handlers were not modified.

`tools-app-store-migration.test.mjs` adds two tests covering exact protected-file preservation and the identity/entry invariants. Both passed locally. The external integration CI workflow now runs the tests with full Git history so the immutable baseline is available. The comparison hashes raw file content without filters; it does not dump binary files or write Git objects.

## Fresh production and external-service checks

At `2026-09-16T18:18:29Z`, both `caremetricai.base44.app` and `app.caremetricai.com` still returned HTTP 200 and referenced `index-COmSvmXO-1ff6018cbd94.js`. Neither fresh HTML response contained the recording ingestion or rrweb reference.

The separate Railway integration service returned a healthy process response, but its readiness correctly remained false: `released:false`, `operations:[]`, `base44ExecutionDependency:true`, and `trafficCutoverVerified:false`. Its observed running runtime revision was `23b17097a93160a6d52145b7582063330ac555d3`. Do not confuse a running paused service with migrated production traffic.

The recovered migration branch and PR #186 exist remotely; the earlier failed shell push is no longer the only copy of the work. No new production frontend publication, store submission, signing-key change, existing-file move/delete, or traffic switch was performed as part of this mobile-preservation check.

## What preservation does not prove

An unchanged installed binary can still be affected by the remote web frontend, login callbacks, API response formats, file links, certificate/domain restrictions or subscription validation. In particular, the new external private-file adapters return `cmfile:` handles rather than existing permanent `file_url` values. They must not be substituted under old upload/download consumers without an explicit compatibility layer and acceptance test.

Keep old files and URLs readable under their existing access controls until a verified copy and consumer transition exists. Do not convert private files to public links to preserve appearances. Keep Apple/Google package identities and signing records unchanged. Test the current installed releases, not only a desktop browser, before the external cutover.

This check did not retrieve or inspect uploaded IPA/AAB/APK binaries from App Store Connect or Play Console. It establishes repository asset preservation and observed live routing, not unconditional approval of every installed-app workflow. Complete migration and zero-credit claims remain blocked by the documented authority, file-contract, provider and authenticated acceptance requirements in PR #186.
