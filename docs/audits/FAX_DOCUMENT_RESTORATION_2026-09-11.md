# Private document and fax queue restoration — 2026-09-11

## Root causes and corrections

The document upload path rejected Base44's `mp/private/<app-id>/...` storage URI and assumed legacy `created_by` email metadata. Hosted service-owned Document creation returns `created_by_id` for a platform service account instead. The protected binding now records that exact platform id separately from the authenticated human creator. Creation, exact reads, list reads and batch fax checks compare the same provenance; a missing or conflicting creator remains invalid. Existing private URI formats remain supported, and public URLs are still rejected.

Document creation previously used query/create contention and deleted the Document when binding acknowledgement or verification failed. An immutable binding could then point to a deleted document. Creation now reserves the existing protected Agency map before uploading, using the `document` key namespace. A saved binding carries the exact reservation token. Uncertain creates retain their reservation and Document; exact same-key replay releases only that owner. Upload errors before Document creation may release their reservation. Different request keys remain independent, and the shared map retains its 500-entry bound.

The document uploader accepted an explicitly enrolled platform owner while document reads rejected every owner enrollment and batch fax rejected the administrator role. An enrolled, configured platform owner now uses the same validated tenant membership and role in those paths. A revoked, unrelated, malformed or duplicate enrollment cannot fall back to global owner scope. An owner with no memberships retains the existing read-only owner behavior; fax delivery still requires an exact active membership. Other administrators do not gain the protected owner identity.

TelecomDestinationBinding no longer requires an SMS messaging profile for fax-only numbers. SMS routing still requires an exact active profile and consent scope. The production fax number was verified to have no messaging profile; no SMS profile or provider configuration is invented or changed.

Hosted queue validation also exposed HTTP 429 during the final reservation read after a successful queue create. Release now applies at most eleven seconds of bounded backoff for short throttles and retains the fence for longer Retry-After limits. Pending schedule verification or release returns an actionable 503. The same request id recovers the saved queue row rather than creating another.

## Validation and limits

All 170 focused contracts/security tests passed, covering hosted service-account provenance, malformed/missing/conflicting creator metadata, private URI forms, upload contention, lost binding acknowledgements, retained uncertain records, exact owner enrollment, absent fax-only SMS profiles, reservation throttling and cross-key preservation. Lint has zero errors/warnings; signal type checking has zero findings; build passed; 222 helper consumers and all 280 backend functions passed parity/transpilation.

Staging verified referral-document creation, exact authorized reads and replay with one saved Document (`6aa48128c303d5b4af7f377c`, under suspended synthetic Agency `6aa481254d5981abdf1bd156`). Synthetic patient-document queue fixtures reproduced rate limiting after a saved schedule. The final canonical-code proof, Agency `6aa4853cf2aaf058f9672fe6`, uploaded a private PDF, read it through the authorized broker, scheduled it with no SMS profile, recovered through the same request after throttling, and replayed with exactly one ScheduledFax and zero FaxLog/provider attempts. Its future schedule was cancelled and the binding, membership and agency retired. All failed-run schedules were also cancelled and their agencies suspended. Synthetic records contain no patient information. The metadata diagnostic helper is absent from the deployed function inventory, and the temporary queue diagnostic was replaced with repository code.

No provider test fax was sent. Production fax sender binding/configuration and controlled provider delivery validation remain rollout work. The receiving-disabled setting remains unchanged. Newly created Patient provenance and the signature package/finalization path are separate remaining work; this patch does not claim those paths are restored.

## Production outcome rollout completed

PR #160 merged as `1002dc6cdd07741196caca117da0ba2011e059db` after green CI, resolved review threads and a clean final review. Production Agency now retains all prior fields/read rules and denies direct create/update/delete; an administrator no-op mutation returned 403 with unchanged revision. The retired worker, V2 worker, dispatcher and result reader were deployed, and `OUTCOME_PIPELINE_RELEASE=enabled-v1` was set.

The first production invocation published the empty prior-day window for the single active agency; replay returned the saved generation, and the authorized reader returned zero metrics/KPIs. Native run `eaed2c72-911c-4c83-9934-32b76094fcdc` completed in 1.9 seconds. The existing daily 06:00 UTC workflow is active.

The inbound fax workflow was also restored after PR #158: native run `d02fe753-af0d-40e4-901b-e28484bc047b` completed, and its ten-minute schedule is active. The production frontend at revision `17cb8593f9624a7f39a592860b5dd1acd05dc099` was verified against all 519 assets on both published origins.
