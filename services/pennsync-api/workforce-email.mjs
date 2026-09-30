// The staff notices — the email halves of the workforce capabilities, ported
// from their Base44 originals. Four of the five are here: the approver's email
// for `submitTimeOffRequest`
// (`base44/functions/submitTimeOffRequest/entry.ts:440-500`), the employee's
// outcome notice for `reviewTimeOffRequest`, the employee's decision notice for
// `reviewPersonnelCredential`, and the administrators' approval-needed notice
// for a RENEWAL submitted through `submitPersonnelCredential`. The fifth,
// `cancelTimeOffRequest`, is blocked on a field its contract does not return
// and the reason is recorded at the bottom of this header.
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
// **`cancelTimeOffRequest` is now here too, and the field it was waiting for
// arrived as a forward migration** — the header below says which and why. What
// follows is the note it was blocked by, kept because it is the reason the
// contract has a `previous_status` at all: Its original notifies the
// manager only when `emailEligible` — the request was `approved` BEFORE the
// cancellation, a manager is named, and the canceller is not that manager. The
// first of those cannot be evaluated here: `contract_time_off_cancel` updates
// the row and returns it, so the answer's `status` is always `cancelled` and
// the prior status is gone. Notifying whenever a manager exists would WIDEN the
// capability — a withdrawn `pending` request was never on anybody's plate, and
// the original says so by testing for `approved`. The eligible shape wants the
// contract to return the status it replaced, which is a forward migration, so
// the capability keeps its current answer until that change takes it.

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
 * **THE CALLER'S ADDRESS IS `actor.userEmail`, NOT `actor.email`.** `authority`
 * returns a frozen projection whose keys are camelCase (`authority.mjs:86`),
 * and there is no `email` on it at all. Three senders here read `actor?.email`
 * and got `undefined` every time: the submit fan-out, where a `??` fallback to
 * the row's `employee_email` made the answer accidentally right because the
 * contract writes the caller there; the credential decision, where it silently
 * printed an EMPTY "Approved by" row on a compliance document; and the
 * withdrawal notice, where it defeated the check that stops a manager being
 * told about a cancellation they performed. Only the third failed a test, and
 * only because that test compares two addresses rather than reading one — a
 * notice built from `undefined` renders and sends. The lesson is the fallback:
 * `actor?.email ?? request?.employee_email` cannot fail, so it cannot report
 * that its first operand is never a value.
 */

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
/**
 * The IN-APP row, which is the half these ports were missing entirely.
 *
 * **A notification is a row rather than a message (D51), so it is NOT
 * delivery-gated** — it is minted whether or not the deployment has released
 * outbound mail, which is what the originals do and the reason the gap was
 * invisible: a paused deployment answered `delivery_paused: true` and looked
 * like it was doing everything it could, while the row the dashboard reads was
 * never written at all.
 *
 * **It needs no contract change and no migration, which is worth reading
 * twice.** `createNotification` already exists and its gate
 * (`20260920320000_contract_notification_create.sql`) admits both of these
 * without widening: the submit fan-out's type is `info`, which is in the
 * non-admin allowlist, and its recipient is always an `agency_admin` or
 * `manager` because `contract_time_off_submit` refuses any other approver by
 * name (`PENNSYNC_TIME_OFF_APPROVER_INVALID`). The review notice's caller is an
 * `agency_admin` or the manager that same check pinned, so the contract treats
 * them as admin — which is what lets a DENIAL carry `compliance_alert`, a type
 * the non-admin allowlist does not hold. Both were checked against the SQL
 * rather than assumed, for the reason the email recipient needed no roster
 * walk: the binding was already one layer down.
 *
 * **One divergence, deliberate and in the direction of doing more.** Each mint
 * carries its own catch, so one recipient's refusal loses neither the other
 * recipients' rows nor the email. The originals put the whole fan-out in a
 * single `Promise.all` inside the same `try` as the send, so one failed row
 * there drops every row AND the email for an event that really happened. This
 * is not a narrowing and it changes nobody's access — both notices go to the
 * same addressee the original addresses — it changes only whether a failure in
 * one suppresses the other.
 */
export async function mintNotifications(contract, notifications) {
  let minted = 0;
  for (const notification of notifications) {
    try {
      await contract('createNotification', { notification });
      minted += 1;
    } catch {
      // Per recipient, and silent as the original is. The row is a courtesy and
      // the record is the source of truth.
    }
  }
  return minted;
}

/**
 * The approver's in-app row, field for field from `submitTimeOffRequest`'s
 * original. `metadata.employee_email` is the row's, which is the store's copy
 * of the requester — the original writes `user.email`, the same person.
 */
export function timeOffSubmittedNotification(request, recipient) {
  const requester = request?.employee_name || request?.employee_email || '';
  const { summary } = timeOffSubmittedMessage(request);
  return {
    user_email: recipient,
    title: 'New time-off request',
    message: `${requester} requested ${summary}.`,
    type: 'info',
    priority: 'medium',
    action_url: '/TimeOff',
    action_label: 'Review request',
    metadata: {
      time_off_request_id: request?.id ?? null,
      employee_email: request?.employee_email ?? null,
    },
  };
}

/**
 * The employee's in-app row for a reviewed request. The type carries the
 * decision — `info` for an approval and `compliance_alert` for a denial, as the
 * original has it — and both the decision and the reviewer are read from the
 * ROW rather than from the caller's parameters, for the reason the message is.
 */
export function timeOffReviewedNotification(request) {
  const approved = request?.status === 'approved';
  const prettyType = String(request?.request_type ?? '').replace(/_/g, ' ');
  const span = `${request?.start_date ?? ''} → ${request?.end_date ?? ''}`;
  const note = typeof request?.review_notes === 'string' ? request.review_notes.trim() : '';
  return {
    user_email: request?.employee_email,
    title: approved ? 'Time off approved' : 'Time off denied',
    message: `Your ${prettyType} request (${span}) was ${request?.status ?? ''}${note ? `: ${note}` : '.'}`,
    type: approved ? 'info' : 'compliance_alert',
    priority: 'medium',
    action_url: '/TimeOff',
    action_label: 'View request',
    metadata: {
      time_off_request_id: request?.id ?? null,
      reviewed_by: request?.reviewed_by ?? null,
    },
  };
}

export async function notifyTimeOffSubmitted({ request, actor, config, integration, contract }) {
  let email = false;
  let deliveryPaused = false;
  try {
    const manager = typeof request?.manager_email === 'string' && request.manager_email.trim() !== ''
      ? [request.manager_email]
      : await agencyAdminRecipients(contract, actor?.userEmail ?? request?.employee_email);
    // The row first and ungated, in the original's order. A paused deployment
    // still writes it, because a notification is a row (D51).
    await mintNotifications(contract,
      manager.map(recipient => timeOffSubmittedNotification(request, recipient)));
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

/**
 * The employee's message when a request is reviewed, field for field from
 * `reviewTimeOffRequest`'s original.
 *
 * The decision is read from the row's `status` rather than from the caller's
 * `decision` parameter, for the reason the recipient is read from the row: the
 * contract is what decided, and a message built from the request would say what
 * was asked for rather than what happened. `review_notes` is the contract's
 * stored copy, already truncated at 2000 as the original truncates it, so the
 * note in the message is the note in the record.
 */
export function timeOffReviewedMessage(request) {
  const approved = request?.status === 'approved';
  const prettyType = String(request?.request_type ?? '').replace(/_/g, ' ');
  const span = `${request?.start_date ?? ''} → ${request?.end_date ?? ''}`;
  const reviewer = request?.reviewer_name || request?.reviewed_by || '';
  const note = typeof request?.review_notes === 'string' ? request.review_notes.trim() : '';
  return {
    subject: approved ? 'Your time off was approved' : 'Update on your time-off request',
    body: renderBrandedEmail({
      preheader: `Your ${prettyType} request for ${span} was ${request?.status ?? ''}.`,
      eyebrow: approved ? 'Request approved' : 'Request reviewed',
      title: approved ? 'Your time off was approved' : 'Your time-off request was not approved',
      intro: `Your ${prettyType} request for ${span} was ${request?.status ?? ''} by ${reviewer}.`,
      sections: [
        {
          callout: approved
            ? { tone: 'success', text: 'Your time off has been approved. Enjoy your time away!' }
            : { tone: 'warn', text: 'Your request was not approved. Please reach out to your reviewer if you have questions.' },
        },
        ...(note ? [{ rows: [['Note from reviewer', note]] }] : []),
        { note: 'View the details in PennSync under Time Off.' },
      ],
    }),
  };
}

/**
 * The outcome notice for a reviewed request.
 *
 * No roster read: the recipient is the employee named on the row the contract
 * just updated, and the contract has already refused a reviewer who is not an
 * `agency_admin` or `manager` of that agency, and refused a reviewer reviewing
 * their own request. So the address is the store's copy of a colleague of the
 * caller's own agency, which is exactly what `agencyRecipient` goes looking
 * for elsewhere.
 *
 * `delivery_paused` is the original's computation again — `!!employee_email &&
 * !released` — so a row with no employee address reports `false` rather than
 * claiming a paused channel.
 */
export async function notifyTimeOffReviewed({ request, config, integration, contract }) {
  let email = false;
  let deliveryPaused = false;
  try {
    const to = typeof request?.employee_email === 'string' && request.employee_email.trim() !== ''
      ? [request.employee_email]
      : [];
    await mintNotifications(contract, to.map(() => timeOffReviewedNotification(request)));
    deliveryPaused = to.length > 0 && config?.deliveryReleased !== true;
    if (to.length > 0 && !deliveryPaused) {
      const message = timeOffReviewedMessage(request);
      email = await deliverNotices({
        integration, recipients: to, subject: message.subject, body: message.body,
      });
    }
  } catch {
    // Best-effort, as the original is: the decision is recorded either way.
  }
  return { email, delivery_paused: deliveryPaused };
}

/**
 * The employee's message when a credential is reviewed, from
 * `reviewPersonnelCredential`'s original. Approval and revision are two
 * different documents there rather than one with a branch in it, and they stay
 * two here: the revision notice carries `tone: 'urgent'`, projects no
 * expiration and no approver, and puts the reason in a callout.
 *
 * `fmtDate` in the original formats the expiration for display; the stored
 * value is already a date string, so it is printed as stored — recorded because
 * a reader comparing the two would look for the formatter.
 *
 * `Approved by` is the original's `user.full_name || user.email`, and the
 * carried `user` table has NO name column (D38), so it is only ever the
 * address here. Substituting nothing else: an empty cell would read as an
 * anonymous approval on a compliance document.
 */
export function credentialReviewedMessage(credential, reviewer) {
  const approved = credential?.status === 'approved';
  const title = credential?.title ?? '';
  const who = credential?.user_name || credential?.user_id || '';
  const reason = credential?.rejection_reason ?? '';
  return {
    subject: approved
      ? `Credential approved — ${title}`
      : `Credential needs revision — ${title}`,
    body: renderBrandedEmail(approved
      ? {
        preheader: `Your ${title} credential has been approved.`,
        eyebrow: 'Credential approved',
        title: `Hello ${who},`,
        intro: 'Your credential submission has been approved.',
        sections: [
          {
            rows: [
              ['Credential', title],
              ['Type', credential?.item_type ?? ''],
              ['Expiration', credential?.expiration_date ?? ''],
              ['Approved by', reviewer ?? ''],
            ],
          },
          { paragraphs: ['Your personnel file has been updated. You can view your current credentials in the Personnel File section.'] },
        ],
      }
      : {
        preheader: `Your ${title} submission needs revision.`,
        eyebrow: 'Action required',
        tone: 'urgent',
        title: `Hello ${who},`,
        intro: 'Your credential submission requires revision.',
        sections: [
          {
            rows: [
              ['Credential', title],
              ['Type', credential?.item_type ?? ''],
            ],
          },
          { callout: { tone: 'warn', text: `Reason: ${reason}` } },
          { paragraphs: ['Please re-upload a corrected document in your Personnel File. If you have questions, please contact your supervisor.'] },
        ],
      }),
  };
}

/**
 * The decision notice for a reviewed credential.
 *
 * **The recipient is the row's `user_id`, and that is not a misreading.** The
 * original sends `to: credential.user_id`, and this store agrees with it: the
 * submit contract writes `caller_email()` there and both the ownership check
 * and the list predicate compare that column with `lower(v_email)`. So the
 * column holds the submitter's VERIFIED address, which is the store's own copy
 * of a colleague of the reviewer's agency — the contract has already refused a
 * reviewer outside it, and refused a reviewer reviewing their own credential.
 *
 * `delivery_paused` is the original's, which here is `!released` with no
 * recipient test, because a credential cannot exist without the column its
 * owner is identified by. The guard is kept anyway and the answer follows it:
 * an unaddressable row reports no paused delivery rather than claiming one.
 */
export async function notifyCredentialReviewed({ credential, actor, config, integration }) {
  let email = false;
  let deliveryPaused = false;
  try {
    const to = typeof credential?.user_id === 'string' && credential.user_id.trim() !== ''
      ? [credential.user_id]
      : [];
    deliveryPaused = to.length > 0 && config?.deliveryReleased !== true;
    if (to.length > 0 && !deliveryPaused) {
      const message = credentialReviewedMessage(credential, actor?.userEmail);
      email = await deliverNotices({
        integration, recipients: to, subject: message.subject, body: message.body,
      });
    }
  } catch {
    // Best-effort: the original's own words are that the decision stands even
    // if the email fails, and that the gap is reported rather than raised.
  }
  return { email, delivery_paused: deliveryPaused };
}

/**
 * The approval-needed message for a submitted credential RENEWAL, from
 * `submitPersonnelCredential`'s original.
 */
export function credentialRenewalMessage(credential) {
  return {
    subject: `Credential renewal submitted — ${credential?.title ?? ''}`,
    body: renderBrandedEmail({
      preheader: `${credential?.user_name ?? ''} submitted a credential renewal for approval.`,
      eyebrow: 'Approval needed',
      title: 'Credential renewal submitted',
      intro: 'A credential renewal has been submitted and is waiting for review.',
      sections: [
        {
          rows: [
            ['Employee', credential?.user_name ?? ''],
            ['Credential', credential?.title ?? ''],
            ['Type', credential?.item_type ?? ''],
            ['New expiration', credential?.expiration_date ?? ''],
          ],
        },
        { paragraphs: ['Review it under Pending Credential Approvals in the admin console.'] },
      ],
    }),
  };
}

/**
 * The renewal notice, and the one sender here whose condition is read from the
 * REQUEST rather than from the row.
 *
 * **The original sends only for a renewal** — `renews_credential_id &&
 * renews_credential_id !== credential_id` — and that is a test over the
 * caller's own parameters, which this layer holds, so no contract change is
 * needed to evaluate it. A first reading of the contract said the port could
 * not know whether a submission was a renewal, because the writable field set
 * of the `credential` object has no such key; the top-level parameter is a
 * different thing and `p_renews_id` has been there all along. Recorded because
 * the wrong conclusion was one grep away from being shipped.
 *
 * The recipients are the agency's administrators, which is what the original's
 * own comment says it wants: it filters a five-thousand-row `User.list` by
 * `role`, `account_type` and `agency_name` because an earlier version emailed
 * staff names and credential titles to every tenant's admins. That
 * reconstruction is D41's and D43's to DELETE — `agencyAdminRecipients` asks
 * the roster, and the policies decide which agency the caller holds.
 *
 * The submitter is NOT excluded here, unlike the time-off fan-out: the original
 * excludes nobody from this one, and an `agency_admin` renewing their own
 * credential is exactly the case D40 created and D44 says to leave visible to
 * the other administrators.
 */
export async function notifyCredentialRenewal({ credential, params, config, integration, contract }) {
  let email = false;
  let deliveryPaused = false;
  try {
    const renews = typeof params?.renews_credential_id === 'string'
      && params.renews_credential_id.trim() !== ''
      && params.renews_credential_id !== params?.credential_id;
    if (!renews) return { email, delivery_paused: deliveryPaused };
    const admins = await agencyAdminRecipients(contract, null);
    deliveryPaused = admins.length > 0 && config?.deliveryReleased !== true;
    if (admins.length > 0 && !deliveryPaused) {
      const message = credentialRenewalMessage(credential);
      email = await deliverNotices({
        integration, recipients: admins, subject: message.subject, body: message.body,
      });
    }
  } catch {
    // Best-effort: the original logs and answers, and the credential stands.
  }
  return { email, delivery_paused: deliveryPaused };
}

/**
 * The manager's message when an APPROVED request is withdrawn, from
 * `cancelTimeOffRequest`'s original. `who` is the employee on the row, which is
 * the original's `request.employee_name || request.employee_email` and, since
 * the carried `user` table has no name column (D38), only ever the address.
 */
export function timeOffCancelledMessage(request) {
  const who = request?.employee_name || request?.employee_email || '';
  const prettyType = String(request?.request_type ?? '').replace(/_/g, ' ');
  const span = `${request?.start_date ?? ''} → ${request?.end_date ?? ''}`;
  return {
    subject: `Time off cancelled by ${who}`,
    body: renderBrandedEmail({
      preheader: `${who} cancelled their previously approved ${prettyType}.`,
      eyebrow: 'Time off cancelled',
      title: `Time off cancelled by ${who}`,
      intro: `${who} has cancelled their previously approved ${prettyType} for ${span}.`,
      sections: [
        { rows: [['Employee', who], ['Type', prettyType], ['Dates', span]] },
        { note: 'View the team calendar in PennSync under Time Off.' },
      ],
    }),
  };
}

/**
 * The manager's in-app row for the same event. `priority` is `low`, which is
 * the only one of the five notices where it is not `medium` — the original's,
 * and a withdrawal is information rather than an ask.
 */
export function timeOffCancelledNotification(request) {
  const who = request?.employee_name || request?.employee_email || '';
  const prettyType = String(request?.request_type ?? '').replace(/_/g, ' ');
  const span = `${request?.start_date ?? ''} → ${request?.end_date ?? ''}`;
  return {
    user_email: request?.manager_email,
    title: 'Time off cancelled',
    message: `${who} cancelled their ${prettyType} (${span}).`,
    type: 'info',
    priority: 'low',
    action_url: '/TimeOff',
    action_label: 'View calendar',
    metadata: { time_off_request_id: request?.id ?? null },
  };
}

/**
 * The withdrawal notice, and the one sender whose eligibility was UNANSWERABLE
 * until the contract changed.
 *
 * **`previousStatus` is the whole reason this exists.** The original's
 * `emailEligible` is three terms — the request was `approved` BEFORE the
 * cancellation, a manager is named, and the canceller is not that manager — and
 * the first could not be evaluated from an answer whose `status` the contract
 * had just set to `cancelled`. `20260920680000_time_off_cancel_previous_status.sql`
 * answers it from the row the contract locks, so the value is the store's at
 * the moment of the change rather than anything a caller or an earlier read
 * supplied.
 *
 * **BOTH halves are behind that one condition, which is why they ship
 * together.** The original's `Notification.create` and its `Core.SendEmail` are
 * inside the same `if (emailEligible)` block, so a withdrawn `pending` request
 * notifies nobody in Base44 and must notify nobody here — the in-app row is
 * ungated on DELIVERY (D51) and is not ungated on eligibility.
 *
 * The canceller is compared against the manager the way the original does it,
 * on the address, and the caller's own is taken from the actor rather than from
 * the row: a `pending` request the employee withdraws never reaches this, and
 * an `agency_admin` cancelling somebody else's approved leave is the case the
 * third term is for.
 */
export async function notifyTimeOffCancelled({
  request, previousStatus, actor, config, integration, contract,
}) {
  let email = false;
  let deliveryPaused = false;
  try {
    const manager = typeof request?.manager_email === 'string' && request.manager_email.trim() !== ''
      ? request.manager_email
      : '';
    const canceller = typeof actor?.userEmail === 'string' ? actor.userEmail : '';
    const eligible = previousStatus === 'approved' && manager !== ''
      && manager.toLowerCase() !== canceller.toLowerCase();
    if (!eligible) return { email, delivery_paused: deliveryPaused };
    await mintNotifications(contract, [timeOffCancelledNotification(request)]);
    deliveryPaused = config?.deliveryReleased !== true;
    if (!deliveryPaused) {
      const message = timeOffCancelledMessage(request);
      email = await deliverNotices({
        integration, recipients: [manager], subject: message.subject, body: message.body,
      });
    }
  } catch {
    // Best-effort, as the original is: the cancellation is recorded either way.
  }
  return { email, delivery_paused: deliveryPaused };
}
