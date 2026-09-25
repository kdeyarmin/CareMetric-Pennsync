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
 * What a sender calls first. The refusal is the originals' own status and code,
 * so a migrated caller that already handles a paused deployment sees nothing
 * new. `fail` carries no detail object in this service, so the originals'
 * `channel` field is not carried: the code names the reason and the endpoint
 * names the channel.
 */
export function requireDeliveryReleased(config) {
  if (config?.deliveryReleased !== true) fail(503, 'OUTBOUND_DELIVERY_RELEASE_PAUSED');
}
