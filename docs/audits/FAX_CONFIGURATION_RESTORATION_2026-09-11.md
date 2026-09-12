# Fax configuration restoration — 2026-09-11

PR #161 merged as `ff577b31f22076cd9453c329550f2bc7ed64cddb` with both CI checks successful and no review findings. Production DocumentTenantBinding has the two new provenance fields, TelecomDestinationBinding permits a missing SMS profile for fax-only numbers, and all five affected functions were deployed.

## Configuration defect inventory

- The existing AgencySettings row has no agency code. An exact conditional backfill to PENNHH is needed without changing any other setting.
- The configured Telnyx outbound number is owned, active and attached to the configured fax connection. It has no SMS profile. Local PhoneNumber inventory and TelecomDestinationBinding are absent.
- PhoneNumber has only available/assigned states. Creating a fax-only inventory row as available exposes it to the shared work-number pool, whose office-number exclusion depends on settings lookup. Add an explicit reserved state; reject ordinary assignment, release and removal of that state, and exclude it from automatic work-number allocation. A reserved row has no invented nurse assignment.
- The platform administrator has no tenant membership, and the existing membership-management broker intentionally disallows enrolling that identity. This is separate from the explicitly authorized platform configuration backfill; tenant fax and document brokers continue requiring an exact active membership. Membership policy consistency remains follow-up work.
- No provider fax has been sent. Controlled provider delivery awaits a test destination and authorization. Scheduled sends and automatic retries can be restored against verified configuration and empty production queues, with native zero-work runs. Provider delivery remains unverified. Signature reminders depend on completion of the signing flow.

The backfill must preserve fax receiving as false and leave SMS/voice authority disabled on the fax binding. It performs no provider writes or messages.

## Review corrections

All fax purchase/provisioning writers now reserve inventory, including an existing owned number whose stored provider id is already correct. Existing nurse assignments are rejected before provider routing changes. New nurse purchases remain available. Nurse assignment and fax conversion use conditional inventory transitions so a competing claim cannot overwrite the winner. Removal uses an exact conditional delete, and release/cleanup cannot reopen a concurrently reserved row. The pool UI excludes reserved inventory from its available count and hides ordinary mutation controls.

All 79 Telnyx/telecom contracts pass, including both fax producers and competing assignment/removal/release operations. Lint, signal checking, build and all 280 backend transpilation checks pass. These tests use fake provider calls; no real number was purchased or reconfigured.

Missing and null assignment fields both participate in conditional reservations. Manual assignment requires existing inventory. The shared writer recovers a lost User-write acknowledgement, conditionally releases a confirmed failure, and preserves uncertain or newer claims. A hosted staging proof rejected ordinary mutations of reserved inventory with zero provider calls; the synthetic row was deleted.

Inventory creation now uses a conditional per-number reservation on the unique Telnyx IntegrationSecret row. Manual additions, purchases (before ordering), and existing fax provisioning share it. An exact creation token reconciles a lost row acknowledgement; an unknown create keeps the reservation. Concurrent producer tests create only one inventory row and at most one provider order. The coordinator and PhoneNumber token fields require a schema update with existing service-only rules preserved.
