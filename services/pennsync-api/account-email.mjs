// sendAccountReadyEmail and sendWelcomeEmail, ported from
// base44/functions/sendAccountReadyEmail/entry.ts and
// base44/functions/sendWelcomeEmail/entry.ts.
//
// D86. Two capabilities whose ENTIRE work is one `Core.SendEmail`, so the port
// is the refusal and nothing else — the seventh and eighth of the shape D81
// last used. `generatePatientHandout` refuses one action of two; these have no
// second action to serve. What ships is the caller gate and the pause, which
// is what the originals answer today with `OUTBOUND_DELIVERY_RELEASE` unset.
//
// Why the send stays refused is D56, and it is not a code decision: releasing
// it hands personnel and invitee names to an outside provider, and which
// vendor may hold names is the owner's call. `sendWelcomeEmail` puts more than
// a name on the wire — its body carries a working temporary password
// (`entry.ts:196`) — so of everything in this queue it is the one that most
// belongs where D56 put it.
//
// The order of the two checks is the originals' order and is worth keeping:
// authorization first, the pause second. So a non-admin is refused 403 by a
// paused deployment exactly as by a released one, and an admin is told the
// channel is off rather than that their request was wrong.
//
// **What the release adds, so nobody reads this as finished.** The originals
// validate the body AFTER the pause — `email` for the first, `email`,
// `full_name` and `temporary_password` for the second — and then render a
// branded HTML message. None of that runs while the pause holds, so none of it
// is carried: an unreachable validation nobody can exercise is not a port, it
// is a claim. Releasing therefore means three things, and a fourth that a gate
// rather than a person asks for. The three: broker `SendEmail` in the
// integration runtime (`BROKERED_OPERATIONS`, `integrations.mjs`), carry the
// field checks and the renderer, and delete the two `fail` lines below. The
// flag flip is the owner's; the other two are a morning's work that would be
// waste if the answer is no.
//
// The fourth is the release ladder (`tools-pennsync-release-ladder.mjs`, the
// `check:release-ladder` gate), which reads `needsIntegration` off the
// registry. While the pause holds it places these two in the READ-ONLY wave,
// which is what the shipped code honestly is: they touch no store and reach no
// runtime. Releasing the send makes that placement wrong, so the release sets
// `needsIntegration: true` on both registry entries in the same change and they
// move to the integration wave. Otherwise the ladder would hand a deployment
// two outbound senders in the wave whose whole promise is that nothing in it
// writes or sends.
//
// That sentence said "a gate rather than a person asks for" before any gate
// did, which is D92: the ladder now derives the reach from whether each
// handler's `handle` destructures `integration` and refuses
// `LADDER_INTEGRATION_FLAG_DISAGREES` when that and the flag disagree. So
// taking `integration` here without moving the flag fails the build, and the
// fourth thing really is a gate's to ask.
import { exactObject, fail } from './contracts.mjs';

/**
 * Both originals gate on `user.role`, `user.account_type` or both, and D23
 * replaced all three: they are self-editable columns of the carried profile,
 * so a handler reading them gates on the caller's own assertion about
 * themselves. `tenantRole` comes from `pennsync_private.membership` through the
 * frozen actor projection and is the same question asked of the authority
 * store.
 *
 * The two originals disagree about who may send, and this takes the narrower
 * reading of the wider one rather than splitting them: `sendAccountReadyEmail`
 * admits a platform `admin`, a `super_admin` and an `agency_admin`
 * (`entry.ts:253`), while `sendWelcomeEmail` admits only a platform `admin`
 * (`entry.ts:154`). This service has no global scope — every request names one
 * agency and is authorized within it — so a platform-wide role has nowhere to
 * land, and `agency_admin` is the whole of what remains. That is a narrowing
 * for the first and a widening for the second, and it is the same narrowing
 * every other port in this service already made.
 */
const SENDER_ROLE = 'agency_admin';

function refuseSend(actor, params, allowed) {
  exactObject(params, allowed, 'INVALID_PARAMS');
  if (!actor || actor.tenantRole !== SENDER_ROLE) fail(403, 'ADMIN_REQUIRED');
  fail(503, 'OUTBOUND_DELIVERY_RELEASE_PAUSED');
}

/** The account-ready notice: an address and a display name reach the provider. */
export function sendAccountReadyEmail({ actor, params }) {
  return refuseSend(actor, params, ['email', 'full_name']);
}

/** The welcome notice, which also puts a temporary password in the message body. */
export function sendWelcomeEmail({ actor, params }) {
  return refuseSend(actor, params, ['email', 'full_name', 'temporary_password']);
}
