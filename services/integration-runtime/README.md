# PennSync external integration runtime

Separate Railway service for direct Anthropic AI/document extraction, SendGrid email and Supabase private files. It does not replace PennTrain. Provider keys are private Railway references to existing authorized accounts; encryption/hashing keys remain private, persistent and distinct.

## Deployment and preserved identity

Service `pennsync-integrations` (`ce6259a3-b1b7-46e5-8cbf-253f66d39d5d`) runs independently in the CareMetric Train project. Its root is `/services/integration-runtime`, Dockerfile is `Dockerfile`, and healthcheck is `/healthz`. The non-root Node 24.18.0 image runs all standalone tests before serving requests. Configuration is held in Railway service settings, not deprecated railway.toml.

The first deployment succeeded on d5b1aa8aa773b6e93c33b59197390c37df9abb02; later revisions must be verified by their own health revision and deployment record. The public origin is https://pennsync-integrations-production.up.railway.app. Previous metadata-only preflight verified model-list access, SendGrid mail.send scope, private bucket and exact service-only file metadata RPC, plus distinct encryption/hash keys. Metadata checks are not provider delivery or authenticated business acceptance.

Production PennSync stays separate. ios/ and public/ files are guarded against the immutable pre-migration baseline by tools-app-store-migration.test.mjs. No store listing, signing identity, uploaded package or existing customer file is replaced by this runtime.

## Not yet a completed traffic cutover

INTEGRATIONS_RELEASE remains disabled and allowed operations empty. Health means a process is alive; readiness separately reports configuration/release state and `trafficCutoverVerified:false`.

**The authority adapter still invokes Base44 getMyTenantContext.** It is an explicitly retained Base44 execution dependency, not a zero-credit claim. The supported SDK does not permit exporting platform-injected service-role credentials to an external backend. Complete independence needs a supported, verified authority/data migration, not relaxed entity permissions.

## Provider compatibility

- InvokeLLM supports text and constrained structured results. Unsupported explicit models and internet search fail rather than silently substituting another behavior.
- ExtractDataFromUploadedFile accepts only owner-bound private handles created by this runtime, with validated PDF/image/text sizes and types. It never fetches arbitrary legacy URLs.
- SendEmail uses a fixed sender, bounded recipients and current privileged agency authority. Provider acceptance is not delivery. Existing HTML templates require explicit compatibility migration.
- UploadFile and UploadPrivateFile both return durable private cmfile handles, not permanent public file_url values. Existing clients must support that contract before switching.
- CreateFileSignedUrl validates the actual Supabase relative storage path and exact object/host/token. Its 60-second link lifetime also limits replay; expired links require a new signing request, never another paid upload.

Image generation, web search, telecom/fax, Stripe, signing workflows and external schedule execution are not delivered by these six adapters. Existing quarantined capabilities are not enabled by a healthy service. Old files and URLs remain intact until consumer-by-consumer migration and installed-client acceptance.

## Request and cost safeguards

Missing/malformed bearer credentials fail before body work. The body pool is separate from verified provider slots; input reads have size bounds and a five-second deadline. Per-token/process request and authority budgets bound this process's Base44 callbacks before the durable provider quota. Concurrent verified actors have separate caps. These are process-local controls, not a distributed WAF guarantee.

Current authority is checked before reserving work, before paid execution/replay disclosure and after execution. Client-supplied service/provider credentials or backend origins are never trusted. Errors are no-store and expose only safe codes.

SQL locks and unique keys preserve idempotency. Only confirmed pre-provider failures can reclaim the same job with a new ownership claim, at most three times and within the daily reservation budget. Pending, uncertain, completed and expired-success jobs cannot be reclaimed. No timeout guesses that a provider did not run. Completed responses are authenticated-encrypted, expire logically and have bounded scheduled ciphertext cleanup while preserving idempotency evidence.

Known unabortable SDK promises retain their browser scheduler slots after the UI times out until their actual promises settle. A directly rejected SDK AI_TIMEOUT also cannot be replayed by a permissive retry callback. This does not prove a provider stopped or refunded work.

## Database

The dedicated jobs/files/budget tables deny browser CRUD. RPCs have fixed search paths and service-only execute grants. The private bucket has an additional restrictive browser exclusion. No existing PennTrain tables/records were moved.

[migrations/README.md](migrations/README.md) distinguishes installed history from fresh-environment bootstrapping. The missing first two migration files have been recovered exactly from authenticated migration-history metadata, with provenance hashes. The complete five-file chain is tested against a fresh PostgreSQL database and installed-definition metadata. A separate actual local Supabase catalog/gateway suite checks platform prerequisites; its Docker-backed result must be recorded separately. This restores source and verification, without applying DDL to the existing shared database. The earlier hosted safe-retry transaction tested job reuse, stale-claim denial, retry/day limits, uncertainty preservation and completed-result replay, then rolled back. An argument-binding defect caught in the first test was corrected before rerunning successfully; all three new tables were empty afterward.

## Tests and release steps

1. `node --test services/integration-runtime/*.test.mjs src/lib/aiCall.test.js src/lib/aiScheduler.test.js tools-ai-drain.test.mjs tools-app-store-migration.test.mjs`
2. Run the full app's lint, high-signal typecheck, tests and hosted-style build on the exact proposed commit.
3. Verify deployment revision and provider configuration separately from source tests.
4. Require signed-in two-agency and current installed-client acceptance, model/file/HTML compatibility, retention/rotation checks and provider output/delivery evidence before traffic cutover.
5. Measure the Base44 usage ledger before claiming zero debits or savings.

The seven previously paused Base44 schedules remain separate dashboard state. Their definitions/queues/history were retained and no external replacement job is activated by this package. Recheck inactivity after future Base44 publications.

## Operator-only synthetic provider acceptance

`node operator-acceptance.mjs --execute-synthetic-v1` also requires private environment confirmation `INTEGRATIONS_SYNTHETIC_ACCEPTANCE=explicit-synthetic-v1` and a configured, paused runtime. The normal HTTP server never imports it and exposes no operator endpoint. It sends only hard-coded invented data: up to three short AI checks, one tiny CSV upload, owner-denial metadata lookup, private signing/download hash comparison, and SendGrid sandbox validation with delivery disabled. No customer record, real recipient, membership or Base44 function is used. Provider output is checked, not just status codes; output logs contain booleans/counts and no keys, signed URLs or model content.

Fixed idempotency references prevent another deployment/retry from repeating completed paid work. Pending/uncertain outcomes require reconciliation; the operator does not invent success or retry a potentially completed model request. A new short-lived file-signing request is allowed on rerun, without uploading the file again. Synthetic fixture receipts and one private CSV may remain in the dedicated integration namespace as test evidence; existing app files are untouched.

This verifies direct providers with synthetic data, not an authenticated employee, tenant cutover, email delivery, or all integration compatibility. A passing sandbox email response validates the request shape but does not deliver a message or validate delivery behavior. Remove the private confirmation and temporary pre-deploy invocation after the single acceptance run.

Operator-run tracking: configuring a pre-deploy hook and redeploying an older Railway snapshot did not execute the acceptance script (no operator event and no synthetic ledger rows). That attempted run is not counted as passed. For the next new-source deployment, the operator explicitly configured the same bounded CLI ahead of normal server startup, with restart retries off; this temporary service setting is to be restored after the run. Public operations remain disabled throughout.
