// sendAccountReadyEmail and sendWelcomeEmail, ported from
// base44/functions/sendAccountReadyEmail/entry.ts and
// base44/functions/sendWelcomeEmail/entry.ts.
//
// D86 ported the refusal and nothing else, and said in its own words what
// releasing the send would take: broker `SendEmail`, carry the field checks and
// the renderer, delete the two `fail` lines, and move `needsIntegration` in the
// same change. **D97 does all four**, and the only difference from that plan is
// where the flag lives: the brokering is not unconditional. `SendEmail` reaches
// the runtime only while `PENNSYNC_API_DELIVERY` is `enabled-v1`
// (`outbound-delivery.mjs`), so an unreleased deployment answers exactly what it
// answered before this change — 403 to a non-admin, 503
// `OUTBOUND_DELIVERY_RELEASE_PAUSED` to an admin — and D56's ratchet is intact.
//
// The order of the checks is the originals' order and is still worth keeping:
// authorization first, the pause second, the body third. So a non-admin is
// refused 403 by a released deployment exactly as by a paused one, and an admin
// on a paused deployment is told the channel is off rather than that their
// request was wrong. The originals validate the body AFTER the pause, so a
// paused deployment cannot be used to probe which fields a sender wants.
//
// **D98 then bound the recipient.** A release review found that `requireSender`
// asks who the caller is and nothing asked who the message may go to, so an
// `agency_admin` could have sent either of these to any address on the
// internet. `agencyRecipient` below resolves the address against the caller's
// own agency roster; the reasoning is on that function and in D98.
//
// **What reaches the provider, stated plainly because it is the whole of the
// owner's decision.** `sendAccountReadyEmail` puts an address and a display
// name on the wire. `sendWelcomeEmail` puts a working temporary password in the
// message body (`entry.ts:196`), which is why D56 singled it out. Neither is a
// clinical record and both are personal data leaving the system, so releasing
// them is the owner's call and the switch is what makes that call an act.
import { exactObject, fail } from './contracts.mjs';
import { renderBrandedEmail } from './branded-email.mjs';
import { requireDeliveryReleased } from './outbound-delivery.mjs';

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

/**
 * The address ceiling is the shared claim helper's (320 characters and the
 * runtime's own `emailAddress` pattern) rather than a looser one of this
 * module's own, so a bad address is refused as `EMAIL_REQUIRED` here rather
 * than coming back as an opaque `INTEGRATION_REFUSED` from the runtime. The originals check only that `email` is truthy, so an address with a
 * newline in it reached SendGrid's payload builder; the runtime's
 * `validateMailParams` refuses it, and refusing here means the caller is told
 * which field is wrong instead of reading `INTEGRATION_REFUSED`.
 */
const address = value => typeof value === 'string' && value.length > 0 && value.length <= 320
  && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
/**
 * A name and a temporary password are interpolated into the message. The
 * renderer escapes both, so the ceiling is about a usable message rather than
 * about injection: 200 characters is the shared helpers' identifier bound.
 */
const shortText = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 200;

function requireSender(actor, params, allowed) {
  exactObject(params, allowed, 'INVALID_PARAMS');
  if (!actor || actor.tenantRole !== SENDER_ROLE) fail(403, 'ADMIN_REQUIRED');
}

/**
 * The recipient, resolved against the caller's own agency roster.
 *
 * **D98, and the reason it is not the caller's string that reaches the
 * provider.** D40's widening replaces a platform `admin` with an
 * `agency_admin`, and its standing instruction is to re-read what the platform
 * tier was STRUCTURALLY preventing rather than what it permitted. Here that is
 * the whole finding: one trusted operator sending branded mail is not the same
 * capability as every tenant administrator sending it, and `requireSender`
 * asks only who the caller is. With an unbound `email` these two endpoints are
 * a PennSync-branded relay to any address on the internet — and
 * `sendWelcomeEmail` puts a working temporary password in the body, so the
 * relayed message is a credential notice carrying the product's own branding.
 * That is D44's shape exactly: the check the role gate makes necessary.
 *
 * `caller_roster(p_agency)` is the population, through `listAgencyRoster`,
 * because it is already the answer to "who is in the agency I am acting in" —
 * active memberships in that agency, with the verified address the carried
 * `user` table has no column for (D41). So there is no scope to build here and
 * nothing to derive: the contract's own gate and the policies decide, and a
 * caller who does not hold the agency never gets past them.
 *
 * Three properties are deliberate. The page walk is BOUNDED, the way
 * `generateUserRosterPDF`'s is, so a contract answering a cursor equal to its
 * own input cannot spin. And what reaches `to` is the ROSTER's address, not the
 * request's: the two differ only in case, and taking the store's copy means the
 * address the provider sees is one this store vouches for rather than one a
 * caller typed.
 *
 * The third came from review and is about what a refusal MEANS. A bound has two
 * ways to end and they are not the same answer: the roster ran out, or the
 * budget did. `RECIPIENT_NOT_IN_AGENCY` asserts a fact about the agency, so it
 * may only be raised on the first — a walk that stopped with `next` still set
 * did not finish looking, and saying "not in your agency" there would state
 * something this code never established. That case is the service's own
 * incapacity and answers 503 `RECIPIENT_LOOKUP_INCOMPLETE`. The ceiling is
 * `PAGE_BUDGET` times `contract_roster_list`'s own default page (200), so
 * 40,000 active memberships in one agency; the distinction costs nothing and
 * is worth having anyway, because a bound that reports the wrong reason is how
 * a real member's refusal gets read as policy.
 *
 * The exact lookup that would remove the bound is not available without a new
 * contract: `contract_roster_get` resolves by user id and refuses anything that
 * is not 24 hex, and these two capabilities are handed an address. A
 * by-address roster read belongs beside it, in a migration, not in a wider
 * walk here.
 */
const PAGE_BUDGET = 200;
async function agencyRecipient(contract, requested) {
  const wanted = requested.trim().toLowerCase();
  let after;
  for (let page = 0; page < PAGE_BUDGET; page += 1) {
    const answer = await contract('listAgencyRoster', after === undefined ? {} : { after });
    const entries = Array.isArray(answer?.entries) ? answer.entries : [];
    const match = entries.find(entry =>
      typeof entry?.email === 'string' && entry.email.trim().toLowerCase() === wanted);
    if (match) return match.email;
    // The roster ended, or the contract answered its own cursor back. Either
    // way the walk saw the whole of what there is to see, so the refusal below
    // is a fact rather than a guess.
    if (!answer?.next || answer.next === after) {
      // Refused rather than answered, and named for what is wrong: an address
      // nobody in this agency holds is not a field error, it is the one thing
      // this capability may not do.
      fail(403, 'RECIPIENT_NOT_IN_AGENCY');
    }
    after = answer.next;
  }
  // The budget ran out with pages left. Nothing about the agency was
  // established, so nothing about the agency is asserted.
  fail(503, 'RECIPIENT_LOOKUP_INCOMPLETE');
}

/**
 * The account-ready notice: an address and a display name reach the provider.
 *
 * The original requires `email` and interpolates `full_name` without checking
 * it, so a call omitting the name greeted the recipient as "You're all set,
 * undefined!". Requiring it is a narrowing and is the port's, not the
 * original's.
 */
export async function sendAccountReadyEmail({ actor, params, config, integration, contract }) {
  requireSender(actor, params, ['email', 'full_name']);
  requireDeliveryReleased(config);
  if (!address(params.email)) fail(400, 'EMAIL_REQUIRED');
  if (!shortText(params.full_name)) fail(400, 'FULL_NAME_REQUIRED');
  // After the pause, deliberately: a paused deployment answers 503 without
  // reading the roster, so it cannot be used to ask whether an address belongs
  // to an agency. The order is the originals' — authorization, pause, body —
  // with the recipient resolved last because it is the first step that reads
  // anything.
  const to = await agencyRecipient(contract, params.email);

  await integration('SendEmail', {
    to,
    from_name: 'PennSync by CareMetric',
    subject: 'Your PennSync by CareMetric account is ready — you can now sign in',
    content_type: 'text/html',
    body: renderBrandedEmail({
      preheader: 'Your account has been verified and activated. You can now sign in.',
      eyebrow: 'Account activated',
      title: `You're all set, ${params.full_name}!`,
      intro: 'Great news — your PennSync by CareMetric account has been fully verified and activated. You can now sign in any time.',
      sections: [
        {
          rows: [['Your login email', to]],
        },
        {
          paragraphs: [
            'If you set a password when you first signed up, use that to sign in. If you’ve forgotten it, use the "Forgot password" link on the login page to reset it.',
          ],
        },
        {
          heading: 'Getting started',
          bullets: [
            'Visit the PennSync by CareMetric login page and sign in with your email and password.',
            'Once signed in, you’ll have access to all features assigned to your role.',
            'Contact your administrator if you have any questions or run into any issues.',
          ],
        },
        {
          note: 'If you did not create this account or have any concerns, please contact your administrator immediately.',
        },
      ],
    }),
  });

  // The original's own answer, including the address in the message. It is the
  // caller's own input coming back — normalised to the roster's copy, which the
  // caller had to name to get this far — so it discloses nothing the request did
  // not already carry.
  return { success: true, message: `Account-ready email sent to ${to}` };
}

/** The welcome notice, which also puts a temporary password in the message body. */
export async function sendWelcomeEmail({ actor, params, config, integration, contract }) {
  requireSender(actor, params, ['email', 'full_name', 'temporary_password']);
  requireDeliveryReleased(config);
  // The original refuses all three absences with one message; this names the
  // field, which is a widening of the error and of nothing else.
  if (!address(params.email)) fail(400, 'EMAIL_REQUIRED');
  if (!shortText(params.full_name)) fail(400, 'FULL_NAME_REQUIRED');
  if (!shortText(params.temporary_password)) fail(400, 'TEMPORARY_PASSWORD_REQUIRED');
  // The credential half of D98, and the reason the binding is not optional: an
  // unbound recipient here is a branded message carrying a working password.
  const to = await agencyRecipient(contract, params.email);

  await integration('SendEmail', {
    to,
    from_name: 'PennSync by CareMetric',
    subject: 'Welcome to PennSync by CareMetric — your account is ready',
    content_type: 'text/html',
    body: renderBrandedEmail({
      preheader: 'Your PennSync by CareMetric account is ready — here are your sign-in details.',
      eyebrow: 'Account created',
      title: `Welcome to PennSync, ${params.full_name}!`,
      intro: 'Your account has been set up by your administrator. Here is everything you need to sign in and get started.',
      sections: [
        {
          heading: 'Your login credentials',
          rows: [
            ['Email', to],
            ['Temporary password', params.temporary_password],
          ],
        },
        {
          callout: {
            tone: 'warn',
            text: 'For your security, please change your password immediately after your first sign-in.',
          },
        },
        {
          heading: 'Getting started',
          bullets: [
            'Sign in on the PennSync by CareMetric login page with the credentials above.',
            'When prompted, replace your temporary password with a secure password of your choice.',
            'Explore the dashboard and the features available for your role.',
            'Contact your administrator any time you have questions.',
          ],
        },
        {
          heading: 'What you can do in PennSync',
          bullets: [
            'Patient Management — view and manage patient records.',
            'Smart Notes — AI-assisted clinical documentation.',
            'Compliance Monitoring — real-time Medicare compliance checks.',
            'Care Planning — automated care plan generation and tracking.',
            'Training & Development — training modules and resources for your role.',
          ],
        },
        {
          heading: 'Keep your account secure',
          bullets: [
            'Keep your password confidential and never share your login credentials.',
            'Log out when finished, especially on shared devices.',
            'Report any suspicious activity to your administrator.',
          ],
        },
        {
          note: 'If you did not request this account or have any questions, please contact your administrator immediately.',
        },
      ],
    }),
  });

  // The original says nothing about the address here and that is kept: a
  // welcome message carries a credential, so its receipt names no recipient.
  return { success: true, message: 'Welcome email sent successfully' };
}
