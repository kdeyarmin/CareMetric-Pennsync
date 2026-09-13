# Base44 connector setup — September 13, 2026

## Target and source

- Existing production app: CareMetric AI, `694ec16e72e01b60d22f7cbf`.
- Canonical merged source: `151520940da6250758b7e730ff34eef944501baa`.
- Canonical source tree: `7424520b25eb405831c5e499f4cf7508286a5ac5`.
- Original pre-setup checkpoint: `6aa72c4dd6e247fbd6d80f1b`, source revision `3ce1cb60ef1e32e439e93fbb0a9eb8df52fdbea3`.

The production sandbox was compared with the pinned GitHub main revision. The initial comparison found 34 missing or differing tracked files. A subsequent complete byte comparison found no remaining differences in compared repository source. Environment files and protected platform metadata were excluded; no secret values were read into this record.

## Additive schema setup

DocumentPackage adds the optional server-owned `reminder_creation_claims` field. ScheduledSignatureReminder adds optional `creation_claim_token` and `audit_write_operation_id` fields. Existing property definitions, required fields and deny-all direct-access rules were preserved. The production reminder inventory returned no records before this setup.

The DocumentPackage schema update reported `entity_schema_source_write_failed`; immediate metadata readback nevertheless confirmed the requested field and unchanged security rules. ScheduledSignatureReminder returned a successful schema update. Source schema files were reconciled to the exact canonical JSONC afterward. Metadata readback is not a substitute for a field-persistence or authenticated workflow test.

## Release boundaries

The merged reminder creation and dispatch release constants remain false. The new Hub grading adapter requires its separately configured enablement and internal credentials; this setup did not provision those values or enable the course-delivery cutover. No patient records, production fixture records, provider messages, domains, store records or signing identities were changed.

Permanent production origin remains `caremetricai.base44.app`, with `app.caremetricai.com` unchanged. Apple app ID `6757097720` / bundle `com.caremetric.ai` and Google package `com.caremetic.ai` are unchanged.

## Verification state

Source reconciliation is verified against the pinned revision and saved in the production app's native source history. The setup record was read back from native commit `af4826ba63eae5598beaac07c005822628b97476`; the file-write action had reported a generic BACKEND_ERROR even though the source save succeeded, so no success was inferred from the error response alone.

Using Node 24.18.0 and pnpm 11.9.0 with the frozen lockfile, the production-targeted build, lint, high-signal typecheck, 225 shared-helper checks, and all 281 backend syntax/target checks passed. All 29 focused component regressions passed with retries disabled. No fresh full authenticated workflow or physical-device acceptance is claimed.

An unsigned static publication check at `2026-09-13T23:14:50.202Z` returned exit 1 and `HTML_RELEASE_MISMATCH` on both `app.caremetricai.com` and `caremetricai.base44.app`. The intended entry was `/assets/index-CDfq72kl-151520940da6250758b7e730ff34eef944501baa.js` with 520 expected build assets. Both live sites still referenced `/assets/index-PiVJYBEQ-34bc0d3bb4ea2c7db941416733ad8d12f19ead1f.js`. The verifier stopped at the entry mismatch; it did not prove that every individual live asset is absent.

Static frontend publication has not been performed or verified. Installed mobile device, signing, purchase/restore and privacy-declaration acceptance remain separate.

## Continuation verification — 2026-09-13 23:28 UTC onward

- The saved Base44 source remained `f019329d255b2def69445f3a8e84007333349f55`, with no reported uncommitted changes at the initial continuation check. The prepared artifact entry still carries canonical code revision `151520940da6250758b7e730ff34eef944501baa`.
- Live asset verification repeated at `2026-09-13T23:28:35.426Z`. Both production origins still returned `HTML_RELEASE_MISMATCH` and referenced the older `34bc0d3bb4ea2c7db941416733ad8d12f19ead1f` entry. The publishing workspace key was still absent from the checked sandbox process environment. No production upload was attempted.
- GitHub CI run `34789316117` on the saved Base44 revision `f019329d255b2def69445f3a8e84007333349f55` completed successfully on September 13 at `23:22:08Z`. This verifies source testing, not publication.
- Chromium browser verification of the prepared production build passed all seven `e2e/a11y-public.spec.js` cases, with two workers and retries disabled: `/privacy`, `/privacy-policy`, `/privacypolicy`, `/join`, `/signer`, `/followup`, and `/consent`. Each case checked title, heading, one main landmark, and the configured serious/critical accessibility checks. An initial attempt could not launch Chromium because the sandbox lacked `libglib-2.0.so.0`; after installing the standard Playwright Chromium system dependencies, all seven cases passed. No application code was changed to obtain this result.
- These are local prepared-build public-route tests. They do not establish authenticated clinical behavior, successful production publication, live backend revisions, or physical iOS/Android acceptance. The no-token signing/telehealth tests verify the existing unavailable states, not feature activation.
- The Base44 connector action catalog was rechecked and still exposes no frontend Publish or workspace-key creation operation. A TinyFish browser connector was offered as a possible supported route to the existing editor control; its directory status still reports not installed. Browser sign-in/consent would remain user-controlled. No connector approval, publishing credential, or authenticated session has been invented or substituted.

The connected Base44 action catalog provides sandbox editing, schemas and checkpoints, but exposes no static-site Publish action or workspace API-key creation action. No additional CLI login or device code was requested. The absence of a CLI workspace key does not prevent a signed-in owner from using the editor's native Publish control; it does block the separate GitHub publishing workflow until a valid credential is securely configured.
