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

Source reconciliation: verified against the pinned revision. Build and runtime verification: pending at record creation. Static frontend publication: not performed or verified by this record. Installed mobile device, signing, purchase/restore and privacy-declaration acceptance remain separate.

The connected Base44 action catalog provides sandbox editing, schemas and checkpoints, but exposes no static-site Publish action or workspace API-key creation action. No additional CLI login or device code was requested. The absence of a CLI workspace key does not prevent a signed-in owner from using the editor's native Publish control; it does block the separate GitHub publishing workflow until a valid credential is securely configured.
