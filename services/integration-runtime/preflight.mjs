import { AUTHORITY_RPC, authorityKeyAccepted } from './authority.mjs';
import { BUCKET, createStore, validSender } from './runtime.mjs';
import { readJson } from './safety.mjs';

export const VERIFIED_SENDERS_URL = 'https://api.sendgrid.com/v3/verified_senders';
export const AUTHENTICATED_DOMAINS_URL = 'https://api.sendgrid.com/v3/whitelabel/domains';
/**
 * How many identities one page may hold.
 *
 * A FULL page is the only signal either endpoint gives that more may follow, so
 * the bound has to be one we SENT: inferred from a default page size we do not
 * know, "full" means nothing.
 */
export const LIST_PAGE_SIZE = 100;
/** At most this many pages, so a boot-time check cannot walk an account forever. */
export const LIST_PAGE_BUDGET = 10;

const lower = value => String(value ?? '').trim().toLowerCase();

/**
 * Whether one entry of a provider list is one we can read at all.
 *
 * This is the difference between "the provider says no" and "we did not
 * understand the answer". An entry missing the fields we read, or carrying them
 * with another type, is not a negative answer about the sender — it is a shape
 * we do not recognise, and calling it NOT_VERIFIED would issue a verdict nobody
 * gave, which is the class of answer this whole check exists to stop giving.
 */
const readableSender = entry => !!entry && typeof entry === 'object'
  && typeof entry.from_email === 'string' && typeof entry.verified === 'boolean';
const readableDomain = entry => !!entry && typeof entry === 'object'
  && typeof entry.domain === 'string' && typeof entry.valid === 'boolean';

/** true, false, or null for a list we cannot read. An EMPTY list is a real no. */
function interpret(entries, readable, matches) {
  if (!Array.isArray(entries)) return null;
  if (entries.length && !entries.some(readable)) return null;
  return entries.some(entry => readable(entry) && matches(entry));
}

/**
 * Whether the from-address is itself a verified single sender.
 *
 * `/v3/verified_senders` returns verified AND unverified senders together —
 * SendGrid's own description of the endpoint says so — so presence in the list
 * proves nothing and the `verified` flag is the entire answer. A check that
 * tested membership would report an unverified sender as verified.
 */
export function singleSenderVerified(data, fromEmail) {
  if (!data || !Array.isArray(data.results)) return null;
  return interpret(data.results, readableSender,
    entry => entry.verified === true && lower(entry.from_email) === lower(fromEmail));
}

/**
 * Whether the from-address's DOMAIN is authenticated and validated.
 *
 * This half is not thoroughness, it is the difference between a true and a
 * false answer. SendGrid's support documentation states that with the sender
 * domain authenticated an address may be used "without having to authenticate a
 * Single Sender email address", and that single senders are not recommended for
 * API sending at all — so the recommended production configuration is exactly
 * the one a sender-list check ALONE would report as unverified.
 *
 * The match is EXACT, never a suffix, and reads `domain` ALONE. SendGrid states
 * both halves of that. On the suffix: "You can only send email messages from
 * this domain specified. Subdomains don't inherit authentication permissions
 * from their parent domain." And on the neighbouring `subdomain` field, which
 * is return-path infrastructure rather than a sending identity: SendGrid
 * "creates a subdomain for your domain to handle bounce and unsubscribe
 * notices". So building `subdomain + '.' + domain` and matching on that would
 * answer VERIFIED on the strength of a record authorizing no such sender, and
 * answering VERIFIED too readily is the expensive direction to be wrong in. A
 * from-domain matching nothing is reported with the valid domains beside it, so
 * a subdomain setup is visible to whoever reads the report instead of being
 * silently judged.
 */
export function domainAuthenticated(data, fromEmail) {
  if (!Array.isArray(data)) return null;
  const domain = lower(String(fromEmail).split('@').pop());
  if (!domain) return false;
  return interpret(data, readableDomain,
    entry => entry.valid === true && lower(entry.domain) === domain);
}

/** The domains the provider says are authenticated, for a report a human reads. */
function validDomainNames(data) {
  return Array.isArray(data)
    ? data.filter(readableDomain).filter(entry => entry.valid === true).map(entry => lower(entry.domain))
    : [];
}

const unmeasured = (reason, extra = {}) =>
  ({ verdict: 'NOT_MEASURED', measured: false, valid: false, reason, ...extra });

/**
 * Ask the PROVIDER whether the configured from-address may send.
 *
 * Three verdicts, and they are deliberately different values. VERIFIED and
 * NOT_VERIFIED are answers SendGrid gave. NOT_MEASURED is the absence of one: a
 * key without the scope to read a list, a shape we cannot parse, or a page we
 * cannot prove was the last one has told us nothing about the sender, and
 * recording any of those as NOT_VERIFIED would be a verdict nobody issued. Only
 * once BOTH routes have really answered can absence mean anything.
 *
 * Reads only. Nothing here sends, and every failure is contained, because this
 * runs after `listen` and must not be able to fail a boot.
 */
async function senderVerification(config, fetcher) {
  if (!config.sendgridKey) return unmeasured('NO_PROVIDER_KEY');
  if (!validSender(config.fromEmail)) return unmeasured('FROM_ADDRESS_MALFORMED');
  const fromDomain = lower(String(config.fromEmail).split('@').pop());

  async function get(url) {
    try {
      const response = await fetcher(url, {
        headers: { Authorization: `Bearer ${config.sendgridKey}` },
        redirect: 'error', signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        return { ok: false, status: response.status,
          reason: [401, 403].includes(response.status) ? 'PROVIDER_REFUSED_THE_READ' : 'PROVIDER_ERROR' };
      }
      return { ok: true, status: response.status, body: await readJson(response, 512000) };
    } catch { return { ok: false, reason: 'PROVIDER_UNREACHABLE' }; }
  }

  /**
   * Read one page, asking for a bounded one, and ask again WITHOUT our
   * parameters if the provider rejects them outright. Every parameter here is
   * documented, but a parameter is a belief about somebody else's service, and
   * a belief must not be able to turn a working check into an unmeasurable one.
   * `bounded` says whether the answer came back under our own page size, which
   * is what makes "this page was full" mean anything.
   */
  async function page(base, params) {
    const first = await get(`${base}?${new URLSearchParams(params)}`);
    if (first.ok || first.status !== 400) return { ...first, bounded: true };
    return { ...(await get(base)), bounded: false };
  }

  // Senders. SendGrid's cursor for this list is a token we would have to read
  // out of a response whose field name we have not been able to confirm, so
  // rather than guess at one, a page that may have a successor answers
  // NOT_MEASURED instead of "no" — the configured sender could be on it.
  const senderPage = await page(VERIFIED_SENDERS_URL, { limit: LIST_PAGE_SIZE });
  let sender = { answer: null, status: senderPage.status, reason: senderPage.reason };
  if (senderPage.ok) {
    const answer = singleSenderVerified(senderPage.body, config.fromEmail);
    const entries = Array.isArray(senderPage.body?.results) ? senderPage.body.results : [];
    const mayHaveMore = senderPage.bounded ? entries.length >= LIST_PAGE_SIZE : entries.length > 0;
    sender = answer === null ? { answer: null, status: senderPage.status, reason: 'UNRECOGNISED_RESPONSE' }
      : answer === false && mayHaveMore
        ? { answer: null, status: senderPage.status, reason: 'SENDER_LIST_TRUNCATED' }
        : { answer, status: senderPage.status };
  }
  if (sender.answer === true) {
    return { verdict: 'VERIFIED', measured: true, valid: true, route: 'single_sender', fromDomain };
  }

  // Domains. `limit` and `offset` are documented here, so this list can be
  // walked to its end rather than guessed at. `exclude_subusers` is not
  // tidiness: with a parent key the list otherwise carries domains belonging to
  // subusers, and the send in `providers.mjs` sets no `On-Behalf-Of` header, so
  // it runs in the parent's context — a subuser's domain would answer VERIFIED
  // for an address the account doing the sending cannot use.
  let domain = { answer: null, reason: 'PROVIDER_UNREACHABLE' };
  const seenDomains = [];
  for (let index = 0; index < LIST_PAGE_BUDGET; index += 1) {
    const result = await page(AUTHENTICATED_DOMAINS_URL,
      { limit: LIST_PAGE_SIZE, offset: index * LIST_PAGE_SIZE, exclude_subusers: 'true' });
    if (!result.ok) { domain = { answer: null, status: result.status, reason: result.reason }; break; }
    const answer = domainAuthenticated(result.body, config.fromEmail);
    if (answer === null) { domain = { answer: null, status: result.status, reason: 'UNRECOGNISED_RESPONSE' }; break; }
    if (answer === true) { domain = { answer: true, status: result.status }; break; }
    seenDomains.push(...validDomainNames(result.body));
    const entries = Array.isArray(result.body) ? result.body : [];
    const mayHaveMore = result.bounded ? entries.length >= LIST_PAGE_SIZE : entries.length > 0;
    if (!mayHaveMore) { domain = { answer: false, status: result.status }; break; }
    if (!result.bounded || index + 1 === LIST_PAGE_BUDGET) {
      domain = { answer: null, status: result.status, reason: 'DOMAIN_LIST_TRUNCATED' };
      break;
    }
  }
  if (domain.answer === true) {
    return { verdict: 'VERIFIED', measured: true, valid: true, route: 'authenticated_domain', fromDomain };
  }
  if (sender.answer === false && domain.answer === false) {
    return { verdict: 'NOT_VERIFIED', measured: true, valid: false, fromDomain,
      singleSenderVerified: false, domainAuthenticated: false, validDomains: seenDomains.slice(0, 20) };
  }
  const failed = sender.answer === null ? sender : domain;
  return unmeasured(failed.reason, { fromDomain, ...(failed.status ? { status: failed.status } : {}) });
}

export async function runPreflight(config, fetcher = fetch) {
  const checks = {};
  async function check(name, url, options, evaluate) {
    try {
      const response = await fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!response.ok) { checks[name] = { status: response.status, valid: false }; return; }
      checks[name] = { status: response.status, ...evaluate(await readJson(response, 512000)) };
    } catch { checks[name] = { valid: false, error: 'METADATA_CHECK_UNAVAILABLE' }; }
  }
  const needsAI = config.operations.some(name => ['InvokeLLM', 'ExtractDataFromUploadedFile'].includes(name));
  const needsEmail = config.operations.includes('SendEmail');
  if (config.anthropicKey) await check('anthropic', 'https://api.anthropic.com/v1/models?limit=100', {
    headers: { 'x-api-key': config.anthropicKey, 'anthropic-version': '2023-06-01' },
  }, data => ({ valid: Array.isArray(data.data) && data.data.some(model => model.id === config.model), model: config.model, hasMore: data.has_more === true }));
  else checks.anthropic = { valid: !needsAI, configured: false, notApplicable: !needsAI };
  checks.anthropic.required = needsAI;
  // `fromAddressWellFormed` is this process reading its own configuration with a
  // regular expression, and is named so that nobody can mistake it for the
  // provider's answer about the sender. The provider's answer is
  // `checks.sendgridSender` below, and it is the only thing here that has asked.
  if (config.sendgridKey) await check('sendgrid', 'https://api.sendgrid.com/v3/scopes', {
    headers: { Authorization: `Bearer ${config.sendgridKey}` },
  }, data => ({ valid: Array.isArray(data.scopes) && data.scopes.includes('mail.send') && validSender(config.fromEmail), fromAddressWellFormed: validSender(config.fromEmail) }));
  else checks.sendgrid = { valid: !needsEmail, configured: false, notApplicable: !needsEmail };
  checks.sendgrid.required = needsEmail;
  checks.sendgridSender = needsEmail
    ? await senderVerification(config, fetcher)
    : { verdict: 'NOT_APPLICABLE', measured: false, valid: true, notApplicable: true };
  checks.sendgridSender.required = needsEmail;
  if (config.supabaseUrl && config.supabaseKey) {
    await check('storage', `${config.supabaseUrl}/storage/v1/bucket/${BUCKET}`, {
      headers: { apikey: config.supabaseKey, Authorization: `Bearer ${config.supabaseKey}` },
    }, data => ({ valid: data.id === BUCKET && data.public === false && data.file_size_limit === 8388608 }));
    try {
      const result = await createStore(config, fetcher).fileGet({ p_id: '00000000-0000-0000-0000-000000000000', p_app_id: config.appId, p_subject: '0'.repeat(64) });
      checks.stateRpc = { valid: result === null };
    } catch { checks.stateRpc = { valid: false }; }
  } else { checks.storage = { valid: false, configured: false }; checks.stateRpc = { valid: false }; }
  // Independent authority: prove the fixed RPC exists and that the publishable
  // key alone is refused. A successful anonymous call would mean the caller's
  // own token is not what authorizes; that must fail the preflight.
  const needsAuthority = config.authorityMode === 'independent';
  if (needsAuthority) {
    try {
      const response = await fetcher(`${config.authorityUrl}/rest/v1/rpc/${AUTHORITY_RPC}`, {
        method: 'POST',
        headers: { apikey: config.authorityKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ p_app_id: config.appId, p_agency_id: 'preflight-anonymous-denial-probe' }),
        redirect: 'error', signal: AbortSignal.timeout(15000),
      });
      // A refusal is necessary and not sufficient: a REVOKED publishable key is
      // refused identically to a live one, so the status alone passes the check
      // in exactly the state it exists to catch. `authorityKeyAccepted` reads
      // the body for the SQLSTATE that only a request reaching the database
      // carries. Kept as its own field beside the refusal, as
      // `fromAddressWellFormed` is kept beside SendGrid's `valid`, so a failure
      // says which half failed.
      const anonymousDenied = [401, 403].includes(response.status);
      let keyAccepted = false;
      if (anonymousDenied) {
        try { keyAccepted = authorityKeyAccepted(await readJson(response, 65536)); } catch { keyAccepted = false; }
      }
      checks.authority = { status: response.status, valid: anonymousDenied && keyAccepted, anonymousDenied, keyAccepted };
    } catch { checks.authority = { valid: false, error: 'AUTHORITY_CHECK_UNAVAILABLE' }; }
  } else {
    checks.authority = { valid: true, notApplicable: true, mode: config.authorityMode || 'base44' };
  }
  checks.authority.required = needsAuthority;
  checks.resultEncryption = { valid: /^[a-f0-9]{64}$/.test(config.encryptionKey) };
  checks.identityHashing = { valid: /^[a-f0-9]{64}$/.test(config.hashKey) && config.hashKey !== config.encryptionKey };
  return { event: 'external_integration_preflight', paidCalls: 0, writes: 0,
    base44FunctionCalls: 0, checks, passed: Object.values(checks).every(check => check.required === false || check.valid === true) };
}
