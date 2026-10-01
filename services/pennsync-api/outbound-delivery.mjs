// The one gate every outbound delivery in this service asks.
//
// D97. Eleven capabilities answer `delivery_paused: true` today, and what
// actually stops them is not those flags: `SendEmail` is absent from
// `BROKERED_OPERATIONS`, so the integration capability refuses the operation
// before any network call. Two independent things had to give for a message to
// leave, which is why nothing has.
//
// That is a good property and this module keeps it while making the send
// buildable. `BROKERED_OPERATIONS` stays exactly as it was — it is D56's
// ratchet, an inventory of what the ports may ask for unconditionally — and
// `DELIVERY_OPERATIONS` is the strictly separate set an operator adds by
// setting one variable. Unset, this service reaches no mail provider at all
// and every sender answers what it answers today.
//
// **Why a gate of this service's own, rather than reading the runtime's.** The
// integration runtime has its own release (`INTEGRATIONS_RELEASE`) and its own
// operation allowlist, so mail cannot go out unless BOTH services permit it.
// A single switch on the runtime would have been enough to make every one of
// those eleven start sending the moment it flipped, including capabilities
// whose delivery nobody has reviewed. A switch here is what makes releasing
// mail a deliberate act on this side too, per capability, through
// `PENNSYNC_API_FUNCTIONS` as everything else in this service is released.
//
// **The value discipline is `PENNSYNC_API_RELEASE`'s and is deliberate.** An
// exact, untrimmed string comparison: unset, empty, `disabled`, `enabled-V1`
// and `" enabled-v1"` all read paused. A gate that trimmed would let a stray
// space in an operator's paste open a channel that sends to real people.
// `enabled-v1` is also the value the Base44 originals' own
// `OUTBOUND_DELIVERY_RELEASE` uses, so the two deployments read the same word.
//
// **It is deliberately route-agnostic.** A brokered `SendEmail` is not the
// only way a message could leave: an invitation's successor is plausibly a
// Supabase Auth invite, which reaches a provider without touching
// `integration` at all. So the gate is a property of the CONFIG rather than of
// the transport, and any path that delivers to a person asks
// `requireDeliveryReleased` before it does anything else.
import { fail } from './contracts.mjs';

export const DELIVERY_RELEASE_ENV = 'PENNSYNC_API_DELIVERY';
export const DELIVERY_RELEASE_VALUE = 'enabled-v1';

/**
 * The brokered operations that exist only while delivery is released. Kept
 * apart from `BROKERED_OPERATIONS` so the ratchet cannot quietly acquire one:
 * a reader of that list still sees exactly what an unreleased deployment may
 * ask the runtime for.
 */
export const DELIVERY_OPERATIONS = Object.freeze(['SendEmail']);

/** Exact and untrimmed, as `PENNSYNC_API_RELEASE` is read. */
export const deliveryReleased = (env = process.env) =>
  env[DELIVERY_RELEASE_ENV] === DELIVERY_RELEASE_VALUE;

/**
 * The five workforce staff notices' own release, and the reason it exists.
 *
 * `PENNSYNC_API_DELIVERY` was released on 2026-09-25 for the two account
 * emails, and a live `/readyz` read on 2026-10-01 reports it still true. The
 * five senders in `workforce-email.mjs` BRANCH on delivery rather than
 * refusing, so without a gate of their own they would have begun mailing real
 * managers, employees and agency administrators on the next deploy — no code
 * change, no further decision, and nothing in a release write to show it.
 * Releasing mail for an account-ready notice is not a decision about staff
 * notices, so the two are not one switch.
 *
 * **It is an AND and never an override.** Both flags must be explicitly true;
 * this one cannot open a channel `PENNSYNC_API_DELIVERY` has left shut, so it
 * narrows and can never widen. `BROKERED_OPERATIONS` is untouched and
 * `SendEmail` stays permitted at the broker while these stay closed — the
 * broker answers what this deployment MAY ask for, which is a different
 * question from whether a capability has been released to ask it.
 *
 * **Absent is the paused case, not a case nobody thought about.** `=== ` on
 * both sides means unset, empty, `true`, `"enabled-V1"` and `" enabled-v1"` all
 * read paused, and a config object missing the field entirely reads paused
 * through `?.`. The failure that matters here is silent and outward, so the
 * default has to be the safe one even when the field is simply forgotten.
 */
export const WORKFORCE_NOTICE_RELEASE_ENV = 'PENNSYNC_API_WORKFORCE_NOTICES';

/** Exact and untrimmed, and the same word, so an operator reads one discipline. */
export const workforceNoticesReleased = (env = process.env) =>
  env[WORKFORCE_NOTICE_RELEASE_ENV] === DELIVERY_RELEASE_VALUE;

/**
 * What each of the five asks before it hands anything to `integration`.
 *
 * A predicate rather than a `fail`, because these record their work first and
 * report the gap: a 503 here would throw away a time-off request or a
 * compliance decision the contract has already committed.
 */
export const workforceNoticeDeliverable = config =>
  config?.deliveryReleased === true && config?.workforceNoticesReleased === true;

/**
 * What a sender calls first. The refusal is the originals' own status and code,
 * so a migrated caller that already handles a paused deployment sees nothing
 * new. `fail` carries no detail object in this service, so the originals'
 * `channel` field is not carried: the code names the reason and the endpoint
 * names the channel.
 */
export function requireDeliveryReleased(config) {
  if (config?.deliveryReleased !== true) fail(503, 'OUTBOUND_DELIVERY_RELEASE_PAUSED');
}
