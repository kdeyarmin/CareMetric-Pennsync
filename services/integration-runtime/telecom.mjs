// The telecom provider adapter: fax and SMS, behind a switch that is off.
//
// The Base44 originals (`sendFax`, `sendSms` and their siblings) do four
// different jobs in one Deno function: authorize the caller, read the agency's
// settings and apply the cost controls, write the `FaxLog` or `SmsMessage`
// row, and then POST to Telnyx. Only the last of those belongs here, and the
// split is D67's: text arithmetic over caller-supplied input and every decision
// about what may be STORED belong on the record side, where the agency's own
// rows can be asked. This module is the provider call and the bounds on its
// arguments, and nothing else.
//
// **So what is deliberately NOT here**, because putting it here would mean
// answering a question this service cannot ask:
//
// - The agency's outbound line and office fax number. They live on
//   `AgencySettings`, which this runtime has no read of; the caller supplies
//   `from` and this module only checks its shape.
// - `isAllowedDestination` — the premium-prefix and blocked-area-code gate.
//   It takes the agency's settings, so it is the caller's. A copy here that
//   defaulted the settings to `{}` would be a cost control that admits
//   everything while reading as a control, which is worse than none.
// - The consent ledger. `SmsConsent` is a record, and whether a person agreed
//   to be texted is not something a transport can know.
//
// A caller that skipped any of those would send an unbounded message, so this
// module refusing is not what protects the recipient. What protects them today
// is that `SendFax` and `SendSms` are in `BROWSER_FORBIDDEN_OPERATIONS` — no
// browser may reach them at all, whatever the allowlist says — and that the
// release below is off.
//
// **The switch.** Two independent gates, both of which must open, and the
// refusal names which one is shut:
//
// 1. `INTEGRATIONS_TELECOM_RELEASE` must read exactly `enabled-v1`. Unset or
//    anything else and every send refuses before a credential is even read.
// 2. A provider credential must exist, with the resource id this operation
//    needs — `fax_connection_id` for a fax, `messaging_profile_id` for a text.
//
// A credential that could not be READ is reported as its own thing rather than
// as a missing one, which is `provider-credential.mjs`'s whole subject and the
// property three reverted regressions rode on.
//
// **Nothing here sends to a real person while the release is off**, and that is
// asserted rather than described: a test drives every path with a fetcher that
// fails if it is called with a Telnyx host.
import { E164, exactObject, fail, text } from './contracts.mjs';

/** The provider this adapter speaks to. One, as the credential's enum has one. */
export const TELECOM_PROVIDER = 'telnyx';

/** The exact value that opens the release. The house form, as `INTEGRATIONS_RELEASE` uses it. */
export const TELECOM_RELEASE_VALUE = 'enabled-v1';

export const TELECOM_OPERATIONS = Object.freeze(['SendFax', 'SendSms']);

/**
 * Which credential field each operation cannot run without.
 *
 * Read from the operation rather than checked once for "a credential exists":
 * the Base44 originals answer `fax_configuration_unavailable` separately from
 * `credential_store_unavailable`, because an API key with no fax connection id
 * is configured for texting and not for faxing, and telling an operator to
 * add a key they already have is the loop this domain keeps falling into.
 */
const REQUIRED_RESOURCE = Object.freeze({
  SendFax: 'faxConnectionId',
  SendSms: 'messagingProfileId',
});

/**
 * The endpoint for each operation, as a literal.
 *
 * Literals rather than anything assembled, which is how every other outbound
 * call in this service is written — `https://api.sendgrid.com/v3/mail/send` and
 * `https://api.anthropic.com/v1/messages`. There is no host allowlist here
 * because there is nothing for one to constrain.
 */
const ENDPOINT = Object.freeze({
  SendFax: 'https://api.telnyx.com/v2/faxes',
  SendSms: 'https://api.telnyx.com/v2/messages',
});

/**
 * Telnyx's own bound on `from_display_name`: letters, numbers, spaces and
 * `-_~!.+`. Ported from the original's comment rather than guessed, and checked
 * here because a value outside it fails the whole send at the provider.
 */
const DISPLAY_NAME = /^[A-Za-z0-9 \-_~!.+]{1,30}$/;

/** The longest text a single send carries. The original sends one message and does not segment. */
export const MAX_SMS_TEXT = 1600;

export function validateTelecomParams(operation, params, config) {
  if (!TELECOM_OPERATIONS.includes(operation)) fail(409, 'INTEGRATION_NOT_MIGRATED');
  if (operation === 'SendFax') {
    exactObject(params, ['to', 'from', 'media_url', 'from_display_name', 'webhook_url']);
    // The media is a URL the provider fetches, so the caller mints it — on the
    // owned path through `CreateFileSignedUrl`, whose links live sixty seconds.
    // Whether that is long enough for the provider to fetch a document is
    // UNMEASURED, and extending the lifetime would be a change to a reviewed
    // value rather than a fix, so it is reported rather than adjusted.
    if (typeof params.media_url !== 'string' || !isOwnedMediaUrl(params.media_url, config)) {
      fail(400, 'FAX_MEDIA_NOT_OWNED');
    }
    if (params.from_display_name !== undefined
      && (typeof params.from_display_name !== 'string' || !DISPLAY_NAME.test(params.from_display_name))) {
      fail(400, 'FAX_DISPLAY_NAME_INVALID');
    }
    if (params.webhook_url !== undefined && !isOwnedWebhookUrl(params.webhook_url, config)) {
      fail(400, 'FAX_WEBHOOK_NOT_OWNED');
    }
  } else {
    exactObject(params, ['to', 'from', 'text', 'webhook_url']);
    text(params.text, MAX_SMS_TEXT);
    if (params.webhook_url !== undefined && !isOwnedWebhookUrl(params.webhook_url, config)) {
      fail(400, 'SMS_WEBHOOK_NOT_OWNED');
    }
  }
  // Both ends, both strict. The destination is somebody's fax machine or phone,
  // and `contracts.mjs` records why this is the narrow answer of the two the
  // original carries.
  for (const field of ['to', 'from']) {
    if (typeof params[field] !== 'string' || !E164.test(params[field])) fail(400, 'TELECOM_NUMBER_INVALID');
  }
}

/**
 * The media URL must be one of OURS.
 *
 * A caller-supplied URL is a request for this service to make the provider
 * fetch an arbitrary address, and the Base44 original guards exactly that with
 * `isSafeFetchUrl` over `FILE_URL_ALLOWED_HOSTS` — Base44's own storage host.
 * The owned equivalent is this service's own storage origin, which is pinned in
 * `runtime.mjs` and cannot be configured to anything else.
 */
export function isOwnedMediaUrl(value, config) {
  if (typeof value !== 'string' || !value || value.length > 16000) return false;
  let url;
  try { url = new URL(value); } catch { return false; }
  return url.protocol === 'https:' && !!config.supabaseUrl && url.origin === config.supabaseUrl
    && url.pathname.startsWith('/storage/v1/object/sign/') && !url.username && !url.password && !url.hash;
}

/**
 * The status webhook must be one of ours too, for the same reason in reverse:
 * it is where the provider will post delivery state, and a caller-chosen
 * address would hand a third party our fax and message ids.
 */
export function isOwnedWebhookUrl(value, config) {
  if (typeof value !== 'string' || !value || value.length > 2000) return false;
  let url;
  try { url = new URL(value); } catch { return false; }
  return url.protocol === 'https:' && config.origins.includes(url.origin)
    && !url.username && !url.password && !url.hash && !url.search;
}

/**
 * The provider payload, built from the original's own field set.
 *
 * `quality: 'high'` and the `from_display_name` masking are the original's and
 * are carried rather than chosen here: the display name presents the OFFICE fax
 * number so a recipient dials the office machine back rather than the blind
 * outbound line, which is a product decision the original made and recorded.
 */
export function telecomPayload(operation, params, credential) {
  if (operation === 'SendFax') {
    const payload = {
      connection_id: credential.faxConnectionId,
      from: params.from,
      to: params.to,
      media_url: params.media_url,
      quality: 'high',
    };
    if (params.from_display_name) payload.from_display_name = params.from_display_name;
    if (params.webhook_url) payload.webhook_url = params.webhook_url;
    return payload;
  }
  const payload = {
    messaging_profile_id: credential.messagingProfileId,
    from: params.from,
    to: params.to,
    text: params.text,
  };
  if (params.webhook_url) payload.webhook_url = params.webhook_url;
  return payload;
}

/**
 * Read the provider's acceptance.
 *
 * The id is the whole answer, and it is the thing a retry needs: the originals
 * record it on the row so a second send can be told from a first. No provider
 * message is returned, following the original's own note — the recipient
 * number and the media URL are PHI, and a provider error body can carry both.
 */
function acceptance(operation, body) {
  const id = body?.data?.id;
  if (typeof id !== 'string' || !id || id.length > 200) fail(502, 'TELECOM_ACCEPTANCE_UNREADABLE');
  // A message's status is per recipient: Telnyx's message payload carries it on
  // data.to[0].status and has no top-level status (the Base44 senders read it
  // there too). A fax's status is top-level. The top-level read stays as the
  // message fallback so an answer of the older shape is still labelled.
  const recipient = operation === 'SendSms' && Array.isArray(body?.data?.to) ? body.data.to[0] : null;
  const raw = recipient && recipient.status !== undefined ? recipient.status : body?.data?.status;
  const status = typeof raw === 'string' && raw.length <= 64 ? raw : null;
  return {
    accepted: true,
    delivered: false,
    provider: TELECOM_PROVIDER,
    provider_id: id,
    provider_status: status,
    operation,
  };
}

/**
 * Send, or refuse and say which gate is shut.
 *
 * `readCredential` is passed in rather than imported so this module does no
 * store access of its own: the provider layer already holds the store, and a
 * second path to a credential is a second thing to keep in agreement.
 */
export async function sendTelecom(operation, params, { config, readCredential, fetcher, readJson }) {
  validateTelecomParams(operation, params, config);
  // The release is read FIRST, before any credential is touched. An operator
  // who has not released this gets the same refusal whether or not a
  // credential exists, so the refusal discloses nothing about the credential.
  if (!config.telecomReleased) fail(503, 'TELECOM_DELIVERY_RELEASE_PAUSED');
  const credential = await readCredential();
  if (credential?.readError) fail(503, 'TELECOM_CREDENTIAL_STORE_UNAVAILABLE');
  if (!credential?.apiKey) fail(503, 'TELECOM_CREDENTIAL_NOT_CONFIGURED');
  const resource = REQUIRED_RESOURCE[operation];
  // Separate from the key's absence, deliberately: a key with no fax
  // connection id is configured for texting and not for faxing, and one
  // refusal for both is what sends an operator to re-enter a key they have.
  if (!credential[resource]) {
    fail(503, operation === 'SendFax' ? 'FAX_CONFIGURATION_UNAVAILABLE' : 'SMS_CONFIGURATION_UNAVAILABLE');
  }
  let response;
  try {
    response = await fetcher(ENDPOINT[operation], {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(telecomPayload(operation, params, credential)),
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    // The original answers 502 "Failed to reach fax provider" here and marks
    // its row failed. Whether the provider received the request is unknown, so
    // this is NOT reported as a refusal the caller may simply retry — the
    // durable reservation above this call is what decides that, and it already
    // distinguishes an uncertain outcome.
    fail(502, 'TELECOM_PROVIDER_UNREACHABLE');
  }
  const body = await readJson(response, 65536).catch(() => ({}));
  if (!response.ok) {
    // Logged server-side and never echoed: the original's own comment says the
    // recipient number and URL are PHI, and a provider error body carries the
    // request back. Only the status and the provider's error code go to the log.
    const first = Array.isArray(body?.errors) ? body.errors[0] : null;
    console.error('sendTelecom: provider refused', { operation, status: response.status, code: first?.code ?? null });
    fail(502, 'TELECOM_NOT_ACCEPTED');
  }
  return acceptance(operation, body);
}
