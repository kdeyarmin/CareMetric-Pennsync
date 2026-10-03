// The runtime's path to a telecom provider credential.
//
// Port of `resolveTelnyxCreds` and `telnyxCredsMessage`, which are generated
// into fourteen Base44 fax functions and their voice and SMS siblings from
// `base44/_shared/backendHelpers.mjs`. The helper's own header records why it
// is shaped the way it is, and that reason is carried here verbatim in effect:
//
//   a failed credential READ used to be reported as "credentials not
//   configured" — so an operator with a perfectly good key was told to add the
//   key, and the obvious next move was to set an env var.
//
// That is the whole reason `readError` is a separate category rather than a
// falsy credential, and it is why the `TELNYX_*` environment path was retired
// three times. Nothing in this module reads an environment variable for a
// credential, and `preflight.mjs` has no check for one, deliberately: there is
// no fallback to guard.
//
// **What this module does not do.** It performs no authorization. Who may set
// a credential and who may read its status are decided by the operator surface
// that calls in, exactly as `records.mjs` carries no authorization in
// `pennsync-api`. And it sends nothing — a credential in hand is not a send,
// and the provider adapter is a separate module behind its own switch.
//
// **Two recorded divergences from the original, both narrowings.**
//
// 1. The original's deterministic row selection is GONE, not reimplemented.
//    It sorted by `-updated_date` and preferred an active row with a non-empty
//    key because `IntegrationSecret` admitted two `provider: 'telnyx'` rows and
//    `saveTelnyxSecret` picked from the same unordered query, so the panel and
//    the senders could read different rows. `007_provider_credential.sql`
//    carries a partial unique index over active rows, so two active versions
//    cannot exist and there is nothing left to choose between. A preference
//    order kept here would be unreachable code asserting a hazard the schema
//    removed.
// 2. `credentialMessage` keeps the original's two branches and its load-bearing
//    distinction word for word in substance, and changes one noun: the
//    "not stored" branch no longer tells an operator the key lives on an
//    `IntegrationSecret` row, because on this side it does not. The sentence
//    that matters — that a read failure is not fixed by re-entering a key — is
//    unchanged.
import { fail, ID, IntegrationError, text } from './contracts.mjs';
import { seal, unseal } from './safety.mjs';

/** The providers this module will carry a credential for. One, as the original's enum has one. */
export const PROVIDERS = Object.freeze(['telnyx']);

/**
 * The one `readError` category, and the reason there is only one.
 *
 * A store that will not answer and a sealed blob that will not open are the
 * same thing to an operator: the credential could not be READ. Both are
 * reported here, because the guidance the category exists to deliver — this is
 * not a missing-key result, so re-entering the key will not help — is correct
 * for both. Splitting them would give the panel a category it does not know
 * and would be this port doing more than the original does.
 */
export const READ_ERROR = 'credential_store_unavailable';

/** The original's `pick`: coerce with `String(v)` rather than requiring a string. */
const pick = value => (value != null && String(value).trim() !== '' ? String(value).trim() : null);

/**
 * The AEAD context the key is sealed under.
 *
 * `app_id:provider` and nothing else. A job result is bound to its caller and
 * its job id because it is that caller's answer to that request; a credential
 * is the deployment's, so binding it to whoever happened to set it would make
 * it unreadable by the senders.
 */
const context = (config, provider) => `${config.appId}:credential:${provider}`;

const validProvider = provider => {
  if (typeof provider !== 'string' || !PROVIDERS.includes(provider)) fail(400, 'UNSUPPORTED_PROVIDER');
  return provider;
};

/**
 * Read the active credential for a provider.
 *
 * Returns the original's shape — the five values, the raw `record`, and
 * `readError` — and does NOT throw on a store failure, because the caller has
 * to be able to tell "could not read" from "not stored" and a thrown error
 * collapses them. A validation failure in the caller's own argument still
 * throws: that is a bug in the call, not a state of the store.
 */
export async function readCredential(config, store, provider = 'telnyx') {
  validProvider(provider);
  let row = null;
  let readError = null;
  try {
    row = await store.credentialActive({ p_app_id: config.appId, p_provider: provider });
  } catch {
    readError = READ_ERROR;
    // The original's catch was bare at first, so an unreadable credential left
    // no server-side breadcrumb and the only signal was a misleading "not
    // configured" reply. Unattended runs have nowhere else to say so. No
    // provider or SDK message is retained: one could carry a credential, a
    // request body or a tenant identifier.
    console.error('readCredential: provider credential lookup failed');
  }
  const record = row && typeof row === 'object' && !Array.isArray(row) ? row : null;
  let apiKey = null;
  if (record && !readError) {
    try {
      apiKey = pick(unseal(config.encryptionKey, context(config, provider), record.api_key_sealed));
    } catch {
      readError = READ_ERROR;
      console.error('readCredential: provider credential could not be opened');
    }
  }
  return {
    apiKey: readError ? null : apiKey,
    publicKey: pick(record?.public_key),
    messagingProfileId: pick(record?.messaging_profile_id),
    voiceConnectionId: pick(record?.voice_connection_id),
    faxConnectionId: pick(record?.fax_connection_id),
    record,
    readError,
  };
}

/**
 * The caller-facing message for a credential that is missing or unreadable.
 *
 * Distinguishing "could not read" from "not stored" is the whole point: the
 * first is not fixed by entering a key, and telling an operator to enter one is
 * what caused the reverted environment-variable regressions.
 */
export function credentialMessage(creds, what) {
  const label = what || 'credentials';
  if (creds && creds.readError) {
    return `Could not read ${label} — the credential store is temporarily unavailable. `
      + 'This is NOT a missing-key result, so re-entering it will not help. '
      + "Retry and check the service's credential-store access if it persists.";
  }
  return `${label} not configured — set the provider credential through the operator surface `
    + '(environment variables are not read).';
}

/**
 * The status answer: whether a credential is configured, and nothing of it.
 *
 * Field for field the original `getTelnyxSecretStatus` reply, including two
 * quirks that are ported rather than tidied. `source` is `'config'` or
 * `'none'` and never names an environment variable, because the environment
 * path is retired. And `updated_at` is null whenever the key is unset, even
 * when a row exists — the original reads `isSet(rec.api_key) ? rec.updated_date
 * : null`, and a panel that showed a timestamp beside "Not configured" would be
 * reporting a credential nobody can use.
 *
 * It reads the status projection, which does not select the sealed column at
 * all, so this function cannot return the key even if it tried.
 */
export async function credentialStatus(config, store, provider = 'telnyx') {
  validProvider(provider);
  let row = null;
  let readError = null;
  try {
    row = await store.credentialStatus({ p_app_id: config.appId, p_provider: provider });
  } catch {
    readError = READ_ERROR;
    console.error('credentialStatus: provider credential lookup failed');
  }
  const record = row && typeof row === 'object' && !Array.isArray(row) ? row : null;
  const lastFour = pick(record?.api_key_last_four);
  const configured = !readError && lastFour !== null;
  return {
    provider,
    configured,
    read_error: readError,
    source: configured ? 'config' : 'none',
    api_key_last_four: configured ? lastFour : null,
    public_key_configured: !readError && record?.public_key_configured === true,
    public_key_source: !readError && record?.public_key_configured === true ? 'config' : 'none',
    messaging_profile_configured: !readError && record?.messaging_profile_configured === true,
    voice_connection_configured: !readError && record?.voice_connection_configured === true,
    fax_connection_configured: !readError && record?.fax_connection_configured === true,
    updated_by: configured ? pick(record?.updated_by) : null,
    updated_at: configured ? (pick(record?.recorded_at) ?? null) : null,
    version: configured && Number.isSafeInteger(Number(record?.version)) ? Number(record.version) : null,
  };
}

/**
 * The resource ids a credential may carry, and the bound each one is checked
 * against before it is stored.
 *
 * Checked HERE as well as in the table's CHECK constraints, because a raw
 * constraint violation reaching the HTTP boundary is a 500 the caller cannot
 * act on, and because the last four has to be derived from the key rather than
 * accepted from a caller.
 */
const RESOURCE_FIELDS = Object.freeze(['publicKey', 'messagingProfileId', 'voiceConnectionId', 'faxConnectionId']);

/**
 * Record a new credential version, retiring the active one.
 *
 * The key is sealed here and the plaintext never leaves this function. The
 * last four is derived from the key that was sealed, so the panel and the
 * senders cannot disagree about which credential is in use — the state the
 * original's unsorted read could reach and could not report its way out of.
 */
export async function putCredential(config, store, input, { randomUUID }) {
  const provider = validProvider(input?.provider ?? 'telnyx');
  const apiKey = typeof input?.apiKey === 'string' ? input.apiKey.trim() : '';
  // Bounds only. What a provider's key looks like is the provider's business,
  // and a shape check here would refuse a valid rotated key the day the
  // provider changes its prefix. The original stores whatever is entered.
  if (!apiKey || apiKey.length > 4096) fail(400, 'CREDENTIAL_KEY_INVALID');
  const updatedBy = typeof input?.updatedBy === 'string' ? input.updatedBy.trim() : '';
  if (!updatedBy || updatedBy.length > 254) fail(400, 'CREDENTIAL_ACTOR_INVALID');

  const resources = {};
  for (const field of RESOURCE_FIELDS) {
    const value = input?.[field];
    if (value == null || value === '') { resources[field] = null; continue; }
    if (field === 'publicKey') {
      resources[field] = text(value, 1024);
    } else {
      if (typeof value !== 'string' || !ID.test(value) || value.length > 200) fail(400, 'CREDENTIAL_RESOURCE_INVALID');
      resources[field] = value;
    }
  }

  const version = await store.credentialPut({
    p_id: randomUUID(),
    p_app_id: config.appId,
    p_provider: provider,
    p_api_key_sealed: seal(config.encryptionKey, context(config, provider), apiKey),
    p_api_key_last_four: apiKey.slice(-4),
    p_public_key: resources.publicKey,
    p_messaging_profile_id: resources.messagingProfileId,
    p_voice_connection_id: resources.voiceConnectionId,
    p_fax_connection_id: resources.faxConnectionId,
    p_updated_by: updatedBy,
  });
  if (!Number.isSafeInteger(Number(version)) || Number(version) < 1) fail(503, 'CREDENTIAL_WRITE_UNCONFIRMED');
  return { provider, version: Number(version), api_key_last_four: apiKey.slice(-4) };
}

export { IntegrationError };
