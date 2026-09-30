// The staff notices — the email halves of the workforce capabilities, ported
// from their Base44 originals. This change carries the first: the approver's
// email for `submitTimeOffRequest`
// (`base44/functions/submitTimeOffRequest/entry.ts:440-500`).
//
// D97 built the gate and `account-email.mjs` is its first instance. This is the
// second, and it differs in the one way that decides this whole module: there
// the send IS the capability, so a paused deployment refuses 503 and there is
// nothing else it could honestly do. Here the send is a SIDE EFFECT of record
// work that has already happened, and the originals do not refuse either — they
// skip the send and report `delivery_paused`. So the gate is a BRANCH here
// rather than a refusal, and `requireDeliveryReleased` is deliberately NOT
// called: a 503 would throw away a submitted time-off request because a channel
// is off, which no original does and no caller expects.
//
// **Two registry flags follow from that and neither is a matter of taste.**
// `needsDelivery` stays FALSE: its question is whether a released handler serves
// nothing without delivery, and these serve the record work, so flagging one
// would make a deployment that releases time off report NOT ready while it is
// doing its job. `needsIntegration` is TRUE, because `handle` reaches the
// runtime and D92's cross-check reads that off the destructuring in both
// directions. The existing D92 check for the other switch
// (`account-email.test.mjs`) ties `needsDelivery` to calling
// `requireDeliveryReleased`, so it still passes unchanged and still says the
// gating senders are the two it knows — this module gates nothing, by design.
// Its own equivalent is in `workforce-email.test.mjs`.
//
// **The recipient needed no roster walk, and that is worth reading twice.** D98
// had to resolve an address against the roster because the caller supplied it
// and `requireSender` asks only who the caller is. Here
// `contract_time_off_submit` already resolves the caller's `manager_email`
// through `pennsync_private.agency_colleague` and STORES the verified address,
// so what reaches the provider is the store's own copy of an address it
// vouches for, and a caller naming somebody outside their agency never gets a
// row created at all. The binding happened in SQL, one layer down, which is
// where it belongs.
//
// **What the fallback is for.** The original notifies a designated manager if
// there is one and otherwise the agency's administrators, so an unassigned
// request still surfaces. Dropping that would make a request with no manager
// named notify nobody — the shape D51 records about reminders addressed to no
// recipient — so it is ported, through the roster, filtering the authoritative
// `tenant_role` rather than the carried profile's self-editable labels (D23).
// The original's third recipient, `Deno.env.get('SUPER_ADMIN_EMAIL')`, is the
// platform tier D14 and D22 removed and is NOT carried.
//
// **The in-app notification is a recorded gap and not this change's.** Each
// original also creates a `Notification` row per approver, and the ported
// contract mints none — its header enumerates five divergences and does not
// mention this one. A notification is a row rather than a message (D51), so it
// is not delivery-gated and it is missing today. It wants either the existing
// `createNotification` contract called per recipient or a mint inside the
// contract's own transaction, which is a forward migration; recorded here
// rather than invented around, and left for the change that takes it.
import { renderBrandedEmail } from './branded-email.mjs';

/**
 * The same page budget as `account-email.mjs`'s, for the same reason: a
 * contract answering a cursor equal to its own input would spin, and the walk
 * has to end somewhere it can say why it ended.
 */
const PAGE_BUDGET = 200;

/**
 * The original's own ceiling (`WORKFORCE_RECIPIENT_LIMIT`, 500), kept. It is a
 * disclosure bound rather than a paging artefact: past it the message stops
 * being a notice to an approver and becomes a broadcast, so the cap stays where
 * the original put it instead of being deleted the way D50's paged-client
 * limits were.
 */
const APPROVER_LIMIT = 500;

/**
 * Every active `agency_admin` of the caller's own agency, by verified address.
 *
 * `tenant_role` is the authority store's answer through `contract_roster_list`,
 * not the carried profile's `account_type`, and `is_active` is derived from the
 * membership rather than read from the self-editable `is_active` column — both
 * are D23's rule, and the roster is already the answer to "who is in the agency
 * I am acting in".
 *
 * The caller is excluded, as the original excludes them
 * (`row.user_id !== caller.id`): an approver notice to the person who just
 * submitted the request is noise, and here the exclusion is by address because
 * that is what this layer holds.
 */
export async function agencyAdminRecipients(contract, excludeEmail) {
  const skip = typeof excludeEmail === 'string' ? excludeEmail.trim().toLowerCase() : '';
  const found = [];
  let after;
  for (let page = 0; page < PAGE_BUDGET; page += 1) {
    const answer = await contract('listAgencyRoster', after === undefined ? {} : { after });
    const entries = Array.isArray(answer?.entries) ? answer.entries : [];
    for (const entry of entries) {
      if (entry?.tenant_role !== 'agency_admin' || entry?.is_active !== true) continue;
      if (typeof entry.email !== 'string' || entry.email.trim() === '') continue;
      if (entry.email.trim().toLowerCase() === skip) continue;
      found.push(entry.email);
      // Stops at the ceiling rather than collecting and then refusing: the
      // original throws past 500 and loses the notice entirely, and a notice
      // to the first 500 administrators of an agency is the same notice.
      if (found.length >= APPROVER_LIMIT) return found;
    }
    if (!answer?.next || answer.next === after) return found;
    after = answer.next;
  }
  // The budget ran out with pages left. Unlike `account-email.mjs`'s walk this
  // asserts nothing about the agency and refuses nothing — the notice is
  // best-effort in every original, so an incomplete look answers with what it
  // found rather than failing a request that has already been recorded.
  return found;
}

/**
 * The approver's message, field for field from the original's own
 * `renderBrandedEmail` call. The rows are conditional there and stay
 * conditional here: a request with no reason prints no Reason row rather than
 * an empty one.
 *
 * `employee_name` is an ADDRESS and not a name. All three time-off originals
 * write `user.full_name || user.email` and the carried `user` table has no
 * `full_name` column, so the fallback is the only branch that can run — the
 * contract's header records this and the message inherits it rather than
 * printing an empty greeting.
 */
export function timeOffSubmittedMessage(request) {
  const requester = request?.employee_name || request?.employee_email || '';
  const prettyType = String(request?.request_type ?? '').replace(/_/g, ' ');
  const days = String(request?.total_days ?? '');
  const span = `${request?.start_date ?? ''} → ${request?.end_date ?? ''}`;
  const summary = `${days} day(s) of ${prettyType} (${span})`;
  return {
    subject: `Time-off request from ${requester}`,
    body: renderBrandedEmail({
      preheader: `${requester} has requested time off and needs your review.`,
      eyebrow: 'Time-off request',
      title: `New time-off request from ${requester}`,
      intro: `${requester} has requested time off and needs your review.`,
      sections: [
        {
          rows: [
            ['Type', prettyType],
            ['Dates', span],
            ['Business days', days],
            ...(request?.reason ? [['Reason', String(request.reason)]] : []),
            ...(request?.coverage ? [['Coverage', String(request.coverage)]] : []),
          ],
        },
        { note: 'Review it in PennSync under Time Off → Approvals.' },
      ],
    }),
    summary,
  };
}

/**
 * The sends themselves, best-effort per recipient exactly as the originals are:
 * a provider refusing one address does not fail the request and does not stop
 * the other addresses. `email` is whether ANY send was accepted, which is the
 * original's `deliveryResults.some(Boolean)`.
 *
 * Accepted, not delivered. The runtime's own answer means the provider took the
 * message, and nothing here observes an inbox — `account-email.mjs` says the
 * same and it is the whole difference between a send and a delivery.
 */
export async function deliverNotices({ integration, recipients, subject, body }) {
  const results = await Promise.all(recipients.map(to => integration('SendEmail', {
    to,
    from_name: 'PennSync by CareMetric',
    subject,
    content_type: 'text/html',
    body,
  }).then(() => true).catch(() => false)));
  return results.some(Boolean);
}

/**
 * The approver notice for a submitted request.
 *
 * `delivery_paused` is the ORIGINAL's computation and not a constant, which is
 * the one behavioural change a caller can see: the original answers
 * `recipients.length > 0 && !outboundDeliveryReleased()`, so a request nobody
 * would have been emailed about reports `false` — there was no delivery to
 * pause. The port answered a flat `true`, which told a caller a message was
 * waiting on a channel when no recipient existed.
 *
 * Everything after the record work is inside one catch, as the original's is:
 * the row is the source of truth and a notification failure may not turn a
 * recorded request into an error.
 */
export async function notifyTimeOffSubmitted({ request, actor, config, integration, contract }) {
  let email = false;
  let deliveryPaused = false;
  try {
    const manager = typeof request?.manager_email === 'string' && request.manager_email.trim() !== ''
      ? [request.manager_email]
      : await agencyAdminRecipients(contract, actor?.email ?? request?.employee_email);
    deliveryPaused = manager.length > 0 && config?.deliveryReleased !== true;
    if (manager.length > 0 && !deliveryPaused) {
      const message = timeOffSubmittedMessage(request);
      email = await deliverNotices({
        integration, recipients: manager, subject: message.subject, body: message.body,
      });
    }
  } catch {
    // Best-effort, and the same silence the original keeps: the dashboard is
    // the source of truth for a request that exists.
  }
  return { email, delivery_paused: deliveryPaused };
}
