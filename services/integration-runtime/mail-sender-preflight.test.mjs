import test from 'node:test';
import assert from 'node:assert/strict';
import { runMailAcceptance } from './operator-mail-acceptance.mjs';
import { loadConfig } from './runtime.mjs';

const base = () => loadConfig({ SUPABASE_URL: 'https://xsqobvvreaovwibxwyvv.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic',
  INTEGRATIONS_HASH_KEY: '1'.repeat(64), INTEGRATIONS_ENCRYPTION_KEY: '2'.repeat(64), SENDGRID_API_KEY: 'synthetic',
  NOTIFICATION_FROM_EMAIL: 'sender@example.test', RAILWAY_GIT_COMMIT_SHA: 'a'.repeat(40) });

for (const fromEmail of ['', undefined, null, 'not-an-email', 'a'.repeat(321), 'sender@example.test\r\nBcc: other@example.test']) {
  test(`bad sender ${String(fromEmail).slice(0, 30)} creates no irreversible acceptance receipt`, async () => {
    let reads = 0, requests = 0;
    await assert.rejects(() => runMailAcceptance({ ...base(), fromEmail }, {
      authorization: 'explicit-mail-sandbox-v1',
      store: { reserve() { reads++; assert.fail('sender validation must precede the reservation'); } },
      fetcher() { requests++; assert.fail('no provider or state requests before sender validation'); },
    }), error => ['INVALID_TEXT', 'INVALID_EMAIL'].includes(error.code));
    assert.equal(reads, 0); assert.equal(requests, 0);
  });
}

// The provider's answer about the sender, which is the only thing here that has
// asked one. Before this existed the report carried `senderConfigured`, a local
// regular expression over our own configuration, sitting where a reader would
// take it for verification.
import { readFileSync } from 'node:fs';
import { runPreflight, singleSenderVerified, domainAuthenticated,
  VERIFIED_SENDERS_URL, AUTHENTICATED_DOMAINS_URL,
  LIST_PAGE_SIZE, LIST_PAGE_BUDGET } from './preflight.mjs';

const mailConfig = (overrides = {}) => ({ ...loadConfig({
  SUPABASE_URL: 'https://xsqobvvreaovwibxwyvv.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic',
  INTEGRATIONS_HASH_KEY: '1'.repeat(64), INTEGRATIONS_ENCRYPTION_KEY: '2'.repeat(64),
  INTEGRATIONS_RELEASE: 'enabled-v1', INTEGRATIONS_ALLOWED_OPERATIONS: 'SendEmail',
  SENDGRID_API_KEY: 'synthetic', NOTIFICATION_FROM_EMAIL: 'sender@example.test',
  RAILWAY_GIT_COMMIT_SHA: 'a'.repeat(40),
}), ...overrides });

// Every other endpoint answers plausibly so a failure can only be the sender's.
const routed = ({ senders, domains, seen = [] } = {}) => async (url) => {
  seen.push(url);
  const { pathname, searchParams } = new URL(url);
  if (pathname === new URL(VERIFIED_SENDERS_URL).pathname) return typeof senders === 'function' ? senders(searchParams) : Response.json(senders ?? { results: [] });
  if (pathname === new URL(AUTHENTICATED_DOMAINS_URL).pathname) return typeof domains === 'function' ? domains(searchParams) : Response.json(domains ?? []);
  if (url.endsWith('/v3/scopes')) return Response.json({ scopes: ['mail.send'] });
  if (url.includes('/v1/models')) return Response.json({ data: [{ id: 'claude-sonnet-4-6' }] });
  if (url.includes('/bucket/')) return Response.json({ id: 'pennsync-external-integrations', public: false, file_size_limit: 8388608 });
  return Response.json(null);
};
const senderCheck = async routes => (await runPreflight(mailConfig(), routed(routes))).checks.sendgridSender;

test('a listed but unverified sender is not verified, which membership alone would miss', async () => {
  // `/v3/verified_senders` returns verified AND unverified senders together, so
  // a check that tested presence would call this one verified. That is the
  // whole reason the flag is read rather than the list length.
  const listed = { results: [{ from_email: 'sender@example.test', verified: false }] };
  assert.equal(singleSenderVerified(listed, 'sender@example.test'), false);
  assert.equal((await senderCheck({ senders: listed })).verdict, 'NOT_VERIFIED');

  const verified = { results: [{ from_email: 'sender@example.test', verified: true }] };
  assert.equal(singleSenderVerified(verified, 'sender@example.test'), true);
  const answer = await senderCheck({ senders: verified });
  assert.equal(answer.verdict, 'VERIFIED');
  assert.equal(answer.route, 'single_sender');
});

test('an authenticated domain verifies a sender that is on no sender list', async () => {
  // SendGrid's own guidance is that an authenticated sender domain is used
  // WITHOUT a single sender, and that single senders are not recommended for
  // API sending — so this is the configuration a sender-list-only check would
  // report as unverified, and it is the likely production one.
  const domains = [{ domain: 'example.test', valid: true }];
  assert.equal(domainAuthenticated(domains, 'sender@example.test'), true);
  const answer = await senderCheck({ senders: { results: [] }, domains });
  assert.equal(answer.verdict, 'VERIFIED');
  assert.equal(answer.route, 'authenticated_domain');
});

test('a domain that is authenticated but not valid verifies nothing', async () => {
  const answer = await senderCheck({ senders: { results: [] }, domains: [{ domain: 'example.test', valid: false }] });
  assert.equal(answer.verdict, 'NOT_VERIFIED');
  assert.deepEqual(answer.validDomains, []);
});

test('the domain match is exact, never a suffix', async () => {
  // Answering VERIFIED too readily is the expensive direction, so an
  // authenticated parent domain supports no claim about a subdomain.
  assert.equal(domainAuthenticated([{ domain: 'example.test', valid: true }], 'sender@mail.example.test'), false);
  const answer = await senderCheck({ senders: { results: [] },
    domains: [{ domain: 'example.test', valid: true }] });
  assert.equal(answer.verdict, 'VERIFIED'); // the config's own address matches exactly
  const sub = await runPreflight(mailConfig({ fromEmail: 'sender@mail.example.test' }),
    routed({ senders: { results: [] }, domains: [{ domain: 'example.test', valid: true }] }));
  assert.equal(sub.checks.sendgridSender.verdict, 'NOT_VERIFIED');
  // and the reading that would explain it is in the report rather than judged away
  assert.deepEqual(sub.checks.sendgridSender.validDomains, ['example.test']);
  assert.equal(sub.checks.sendgridSender.fromDomain, 'mail.example.test');
});

for (const [label, status] of [['forbidden', 403], ['unauthorized', 401]]) {
  test(`a ${label} read is NOT_MEASURED, never NOT_VERIFIED`, async () => {
    // A key without the scope to read a list has told us about the KEY. Calling
    // that "not verified" would be a verdict the provider never issued, which is
    // the same mistake in a new place.
    const refused = () => new Response('{}', { status });
    const onSenders = await senderCheck({ senders: refused });
    assert.equal(onSenders.verdict, 'NOT_MEASURED');
    assert.equal(onSenders.reason, 'PROVIDER_REFUSED_THE_READ');
    assert.equal(onSenders.measured, false);
    assert.notEqual(onSenders.verdict, 'NOT_VERIFIED');

    // and a refusal on the SECOND read is equally not a verdict, even though
    // the first read came back a clean negative
    const onDomains = await senderCheck({ senders: { results: [] }, domains: refused });
    assert.equal(onDomains.verdict, 'NOT_MEASURED');
    assert.equal(onDomains.reason, 'PROVIDER_REFUSED_THE_READ');
  });
}

test('an unrecognised shape and an unreachable provider are both NOT_MEASURED', async () => {
  assert.equal(singleSenderVerified({ unexpected: true }, 'sender@example.test'), null);
  assert.equal(domainAuthenticated({ unexpected: true }, 'sender@example.test'), null);
  assert.equal((await senderCheck({ senders: { unexpected: true } })).reason, 'UNRECOGNISED_RESPONSE');
  assert.equal((await senderCheck({ senders: () => Response.json('not-a-list') })).reason, 'UNRECOGNISED_RESPONSE');
  const thrown = await senderCheck({ senders: () => { throw new Error('socket'); } });
  assert.equal(thrown.verdict, 'NOT_MEASURED');
  assert.equal(thrown.reason, 'PROVIDER_UNREACHABLE');
});

test('the sender check reads only, and never reports the local regex as a sender fact', async () => {
  const seen = [];
  const report = await runPreflight(mailConfig(), routed({ seen,
    senders: { results: [{ from_email: 'sender@example.test', verified: true }] } }));
  assert.ok(seen.some(url => url.startsWith(VERIFIED_SENDERS_URL)));
  assert.ok(seen.every(url => !url.endsWith('/mail/send')), 'the preflight must never reach a send endpoint');
  assert.equal(report.paidCalls, 0);
  assert.equal(report.writes, 0);
  // the misleading field is gone, and its honest replacement does not claim to
  // be about verification
  assert.equal('senderConfigured' in report.checks.sendgrid, false);
  assert.equal(report.checks.sendgrid.fromAddressWellFormed, true);
});

test('a malformed address is not measured, and SendEmail not served is not applicable', async () => {
  const malformed = await runPreflight(mailConfig({ fromEmail: 'not-an-email' }), routed({}));
  assert.equal(malformed.checks.sendgridSender.verdict, 'NOT_MEASURED');
  assert.equal(malformed.checks.sendgridSender.reason, 'FROM_ADDRESS_MALFORMED');
  assert.equal(malformed.checks.sendgridSender.required, true);

  const seen = [];
  const noMail = await runPreflight({ ...mailConfig(), operations: ['InvokeLLM'] }, routed({ seen }));
  assert.equal(noMail.checks.sendgridSender.verdict, 'NOT_APPLICABLE');
  assert.equal(noMail.checks.sendgridSender.required, false);
  assert.equal(noMail.checks.sendgridSender.valid, true);
  assert.ok(seen.every(url => !url.startsWith(VERIFIED_SENDERS_URL)), 'no sender read when mail is not served');
});

// Three findings from the Codex review of this file's first version, all P2 and
// all one root cause: the check could answer "no" from a read that had not
// really looked. A negative verdict is now reachable only from a list we could
// read AND could prove was the last one.

test('a list we cannot read is NOT_MEASURED, never a negative verdict', async () => {
  // The container was recognised and the ENTRIES were not, and both helpers
  // answered false — a verdict nobody issued, out of a read that understood
  // nothing. If SendGrid ever renames a field, this is the shape it arrives in.
  assert.equal(singleSenderVerified({ results: [{}] }, 'sender@example.test'), null);
  assert.equal(singleSenderVerified({ results: [{ from_email: 'sender@example.test', verified: 'yes' }] },
    'sender@example.test'), null);
  assert.equal(domainAuthenticated([{}], 'sender@example.test'), null);
  assert.equal(domainAuthenticated([{ domain: 'example.test', valid: 'true' }], 'sender@example.test'), null);

  // An EMPTY list stays a real answer, which is what keeps NOT_VERIFIED
  // reachable at all — the fix must not swallow the verdict it exists to guard.
  assert.equal(singleSenderVerified({ results: [] }, 'sender@example.test'), false);
  assert.equal(domainAuthenticated([], 'sender@example.test'), false);
  // and one readable entry is enough to read the list, so a stray extra is not fatal
  assert.equal(domainAuthenticated([{}, { domain: 'example.test', valid: true }], 'sender@example.test'), true);

  const onSenders = await senderCheck({ senders: { results: [{}] } });
  assert.equal(onSenders.verdict, 'NOT_MEASURED');
  assert.equal(onSenders.reason, 'UNRECOGNISED_RESPONSE');
  const onDomains = await senderCheck({ senders: { results: [] }, domains: [{ unexpected: true }] });
  assert.equal(onDomains.verdict, 'NOT_MEASURED');
  assert.equal(onDomains.reason, 'UNRECOGNISED_RESPONSE');
});

test('a page that may have a successor cannot answer no', async () => {
  // SendGrid's cursor for the sender list is a token whose field name we have
  // not confirmed, so a full page is read as "the configured address could be
  // on the next one" rather than as an absence.
  const senders = size => ({ results: Array.from({ length: size },
    (unused, n) => ({ from_email: `other-${n}@example.test`, verified: true })) });
  const truncated = await senderCheck({ senders: senders(LIST_PAGE_SIZE), domains: [] });
  assert.equal(truncated.verdict, 'NOT_MEASURED');
  assert.equal(truncated.reason, 'SENDER_LIST_TRUNCATED');

  // One short of full is the last page, and then no IS an answer.
  const complete = await senderCheck({ senders: senders(LIST_PAGE_SIZE - 1), domains: [] });
  assert.equal(complete.verdict, 'NOT_VERIFIED');
});

test('the domain list is walked to its end, and the walk is bounded', async () => {
  const filler = page => Array.from({ length: LIST_PAGE_SIZE },
    (unused, n) => ({ domain: `p${page}-${n}.example.test`, valid: true }));

  // Ours is on the SECOND page. A one-shot read would have called it unverified.
  const offsets = [];
  const answer = await senderCheck({ senders: { results: [] }, domains: query => {
    const offset = Number(query.get('offset'));
    offsets.push(offset);
    return Response.json(offset === 0 ? filler(0) : [{ domain: 'example.test', valid: true }]);
  } });
  assert.equal(answer.verdict, 'VERIFIED');
  assert.equal(answer.route, 'authenticated_domain');
  assert.deepEqual(offsets, [0, LIST_PAGE_SIZE]);

  // An account that never stops giving full pages is NOT_MEASURED rather than
  // walked forever, because this runs on every boot of a live service.
  let reads = 0;
  const endless = await senderCheck({ senders: { results: [] },
    domains: () => { reads += 1; return Response.json(filler(reads)); } });
  assert.equal(endless.verdict, 'NOT_MEASURED');
  assert.equal(endless.reason, 'DOMAIN_LIST_TRUNCATED');
  assert.equal(reads, LIST_PAGE_BUDGET);
});

test('the domain read excludes subusers, whose domains this account cannot send from', async () => {
  // The expensive direction. With a parent key the list otherwise carries
  // subusers' domains, and the send sets no On-Behalf-Of header, so it runs as
  // the key's own account: an unfiltered match would answer VERIFIED for an
  // address that account cannot use.
  const seen = [];
  await senderCheck({ seen, senders: { results: [] }, domains: [] });
  const domainReads = seen.filter(url => url.startsWith(AUTHENTICATED_DOMAINS_URL));
  assert.ok(domainReads.length, 'the domain route must actually be read');
  for (const url of domainReads) {
    assert.equal(new URL(url).searchParams.get('exclude_subusers'), 'true');
  }

  // The send is the reason, so pin the send. providers.mjs sits in this same
  // directory, which is the whole build context, so reading it is safe here.
  const send = readFileSync(new URL('./providers.mjs', import.meta.url), 'utf8');
  assert.equal(/on-behalf-of/i.test(send), false,
    'if the send ever acts as a subuser, this read has to follow it there');
});

test('a provider that rejects our paging parameters still answers, and claims no less', async () => {
  // A parameter is a belief about somebody else's service. A refused one must
  // not turn a working check into an unmeasurable one — and must not then let
  // an unbounded page be mistaken for the last one either.
  const queries = [];
  const refusesParams = body => query => {
    queries.push(query.toString());
    return query.has('limit') ? new Response('{}', { status: 400 }) : Response.json(body);
  };
  const answer = await senderCheck({
    senders: refusesParams({ results: [{ from_email: 'sender@example.test', verified: true }] }) });
  assert.equal(answer.verdict, 'VERIFIED');
  assert.deepEqual(queries, [`limit=${LIST_PAGE_SIZE}`, '']);

  const noMatch = await senderCheck({ domains: [],
    senders: refusesParams({ results: [{ from_email: 'other@example.test', verified: true }] }) });
  assert.equal(noMatch.verdict, 'NOT_MEASURED');
  assert.equal(noMatch.reason, 'SENDER_LIST_TRUNCATED');
});
