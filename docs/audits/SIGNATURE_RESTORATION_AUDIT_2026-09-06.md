# E-signature restoration audit — 2026-09-06

## Release decision

**INACTIVE.** `dispatchScheduledSignatureReminders/function.jsonc` declares the exact 15-minute schedule and explicitly sets `is_active: false`. The issuer, validator, submit broker, reminder scheduler, and reminder dispatcher also have source-level `false` release gates that return a no-store 503 before request parsing, environment reads, SDK construction, service-role access, uploads, signed-URL creation, or email.

This is a deliberate release boundary, not a claim that the queue is empty or that signing has completed.

## Rebuilt dormant brokers

| Function | Restored security boundary |
| --- | --- |
| `generateSignerToken` | Exact User/AgencyMembership/Agency/package/patient/private-document authority; package issuance lease; SHA-256 token persistence; deadline cap; server-side delivery to the canonical signer; no plaintext token or link in the requester response; provider-ambiguous delivery is non-active and requires reconciliation. |
| `validateSignerToken` | Exact hashed active token lookup; immutable package, creator membership, patient, signer roster, source digest, and private `DocumentTenantBinding` checks; short one-time review grants; 60-second signed review URLs returned only in the response; keyed network metadata; exact agreement-text digest binding. |
| `submitSignerSignature` | Exact token/review/document binding; server-generated per-invocation and per-document conditional claims; stale-lease takeover; strict PNG/JPEG bytes and 1 MiB limit; canonical signer-name match; private upload only; immutable artifact binding; resumable response-loss reconciliation; append-only provenance; single-use review grant and token transitions. Signature capture remains nonterminal as `signatures_collected`. |
| `scheduleSignatureReminders` | Exact authenticated tenant role and immutable package/document/signer/private-source authority before a server-owned queue row can be created. |
| `dispatchScheduledSignatureReminders` | Exact scheduler authority, conditional row claim, live requester/creator/tenant/patient/signer/private-source reauthorization, token hashing, canonical recipient derivation, one provider attempt, and terminal `indeterminate` handling instead of automatic duplicate delivery. |

All five use the repository-pinned `npm:@base44/sdk@0.8.46` import.

## Server-only entity model

Direct read/create/update/delete remains denied for `DocumentSignature`, `DocumentPackage`, `DocumentPackageToken`, `ScheduledSignatureReminder`, `SignerReviewGrant`, `SignatureArtifactBinding`, and `SignatureAuditEvent`.

New authority-bound rows carry immutable agency, actor/membership, signer, private binding, content digest, authority revision, idempotency, claim-owner, and audit provenance fields. Bearer tokens and review nonces are stored only as SHA-256 digests. Signature images use private file URIs; signed source-document URLs are short-lived response values and are never persisted. Raw IP addresses, user agents, typed names, signature bytes, and public URLs are not persisted by the rebuilt path.

## Residual functions kept as unconditional static 503s

| Family | Functions | Exact reason |
| --- | --- | --- |
| Request/package creation | `bulkCreateDocumentPackages`, `generateDocumentPackageFromTemplate` | No reviewed broker yet creates every package/signature row with the new immutable authority snapshots and private source binding. |
| Alternate token/reminder paths | `notifySignerOfPackage`, `sendSignatureReminder`, `sendAutomatedSignatureReminders`, `checkPendingSignatureRequests`, `sendDocumentReminderEmails` | These duplicate capability issuance/delivery and could bypass hashing, canonical recipient derivation, conditional claims, or provider-ambiguity containment. They must be retired or made thin calls into one reviewed broker. |
| Alternate submit path | `submitDocumentSignatures` | Legacy in-person/browser payload and artifact semantics do not meet the private artifact, reviewed agreement, replay, or provenance contract. |
| Final signed-document production | `stampSignatureOnPDF`, `embedAnnotationsToPDF`, `signatureIntegrity`, `generateSignatureCertificate`, `archiveSignedDocument` | Field placement, immutable signed composite PDF, integrity proof, certificate contents, retention, and private archival have not been implemented and approved as one atomic/reconcilable finalization pipeline. |
| Completion hooks | `onDocumentSigned`, `notifyAdminOfSignedDocument` | A capture must not claim legal document completion or notify completion until the private finalization pipeline succeeds exactly once and resolves a current tenant-authorized recipient. |

## Activation blockers

The following must all be closed before changing any release gate or `is_active` value:

1. **Legal/product acceptance:** approve the exact consent/attestation text and version, signer identity-assurance level, typed/drawn signature policy, witness/representative rules, certificate contents, retention, revocation, and evidence requirements. `SIGNATURE_AGREEMENT_TEXT` and its exact `SIGNATURE_AGREEMENT_SHA256` are required, but configuration does not substitute for legal approval.
2. **Signer identity:** the portal is still bearer-only. Define and implement the approved second factor or OTP/re-authentication policy, bounded validation/access count, lockout, revocation, and recovery. Repeated validation currently can create additional short grants while a token is active, so activation is blocked even though submission grants themselves are single-use.
3. **Secure creation broker:** create `DocumentPackage` and `DocumentSignature` rows from a current private `DocumentTenantBinding`, canonical signer roster, current membership, deadlines, and idempotency key. Existing/legacy URL-bearing or authority-incomplete rows are intentionally rejected.
4. **Private finalization pipeline:** render every placed field, produce one immutable signed composite document, bind its digest to the source and signature artifacts, generate the approved certificate/integrity evidence, archive privately, and only then transition document/package state to `completed`. The rebuilt submit broker intentionally stops at nonterminal `signatures_collected`.
5. **Signer UI:** replace the static `/signer` surface with the reviewed token validation, exact agreement display, short signed review URL, review nonce, private multipart submit, response-loss retry, expiry/revocation, and accessibility flows. The current startup token scrubber and static UI must stay in place until that review.
6. **Reminder durability:** make scheduler creation audit-first/non-dispatchable until audit confirmation, bind its deadline to package/document authority rather than caller input, prove duplicate schedule-key containment under concurrent creates, define stale `sending` recovery, take the same package issuance lease and block rotation while any token is claimed, and add an audited operator resolution path for provider-indeterminate delivery. Prove how hosted Base44 scheduled automations authenticate because `function_args: {}` cannot itself supply `x-internal-secret`. Inventory and remove/disable any legacy hosted automation with the same name because CLI omission/removal semantics are not yet proven.
7. **Key lifecycle:** add an HMAC key id and retained verification key ring for typed-name/network pseudonyms. Rotating `SIGNATURE_HMAC_SECRET` while grants or reconciliation are outstanding is currently a release blocker.
8. **Deadline and replay validation:** re-check token lifetime against current package/document deadlines at validation and submission time, CAS-increment and cap validation attempts/grant creation, add a final claim-owner fence immediately before private upload (including stale-lease takeover), and exercise expiry/revocation/claimed-token reminder interactions. Validate the complete immutable `DocumentTenantBinding` provenance expected from the future creation broker, not only its current id/tenant/patient/private URI/version/digest projection.
9. **Hosted evidence:** on isolated staging, prove positive and negative two-agency cases; private URI and 60-second signed URL behavior; no public URL persistence; token/review expiry, reuse, concurrent same/different request ids, process death after each write/provider boundary, exact retry reconciliation, membership/agency revocation, malformed image rejection, delivery ambiguity, and zero-data scheduled runs. Add runtime failure-injection tests for every conditional write, upload, audit, and provider boundary. Confirm required secrets and email integration capacity before any live attempt.
10. **Coordinated release:** use one reviewed release/version decision across issuer, validator, submit, scheduler, dispatcher, UI, and automation so a partial activation cannot send unusable links or expose a route without its finalization path.

## Contract evidence

- `node --test base44/functionTests/signatureRestorationContract.test.js base44/functionAutomationConfigContract.test.js base44/workflowMigrationContract.test.js`
- `node --test base44/securityGuardrails.test.js`
- `pnpm exec vitest run src/lib/signingQuarantineContract.spec.js src/pages/PausedPublicCapabilities.spec.jsx src/lib/tenantSdkRealmContract.spec.js`
- `pnpm run check:backend-transpile` (signature functions transpile; the latest full command can be independently blocked by unrelated concurrent wrapper work and must be rerun on the integrated tree)
