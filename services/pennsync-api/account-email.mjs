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
 * The account-ready notice: an address and a display name reach the provider.
 *
 * The original requires `email` and interpolates `full_name` without checking
 * it, so a call omitting the name greeted the recipient as "You're all set,
 * undefined!". Requiring it is a narrowing and is the port's, not the
 * original's.
 */
export async function sendAccountReadyEmail({ actor, params, config, integration }) {
  requireSender(actor, params, ['email', 'full_name']);
  requireDeliveryReleased(config);
  if (!address(params.email)) fail(400, 'EMAIL_REQUIRED');
  if (!shortText(params.full_name)) fail(400, 'FULL_NAME_REQUIRED');

  await integration('SendEmail', {
    to: params.email,
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
          rows: [['Your login email', params.email]],
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
  // caller's own input coming back, so it discloses nothing the request did not
  // already carry.
  return { success: true, message: `Account-ready email sent to ${params.email}` };
}

/** The welcome notice, which also puts a temporary password in the message body. */
export async function sendWelcomeEmail({ actor, params, config, integration }) {
  requireSender(actor, params, ['email', 'full_name', 'temporary_password']);
  requireDeliveryReleased(config);
  // The original refuses all three absences with one message; this names the
  // field, which is a widening of the error and of nothing else.
  if (!address(params.email)) fail(400, 'EMAIL_REQUIRED');
  if (!shortText(params.full_name)) fail(400, 'FULL_NAME_REQUIRED');
  if (!shortText(params.temporary_password)) fail(400, 'TEMPORARY_PASSWORD_REQUIRED');

  await integration('SendEmail', {
    to: params.email,
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
            ['Email', params.email],
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
