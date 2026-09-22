import { readFile } from 'node:fs/promises';
import { describe, it, expect } from 'vitest';
import { createIndependentStagingAdapter, readIndependentStagingConfig } from './independentStagingAdapter';
import { bindTrustedTenantContext, clearTrustedTenantContext, getActiveTrustedTenantContext } from '@/lib/roles';
import { stagingApiUrl, stagingEmails, stagingEnv, stagingFixture } from '@/test/independentStagingFixture';

/** The principal AuthContext binds, which is where a ported call's tenant comes from. */
const boundUser = Object.freeze({ id: 'user-1', email: 'nurse@example.test' });
const boundContext = (overrides = {}) => ({
  user_id: 'user-1',
  user_email: 'nurse@example.test',
  membership_id: 'membership-1',
  membership_key: 'agency-a:user-1',
  membership_version: 3,
  agency_id: 'agency-a',
  tenant_role: 'clinician',
  membership_status: 'active',
  is_platform_owner: false,
  agency: { id: 'agency-a', name: 'Synthetic Agency', status: 'active' },
  ...overrides,
});

describe('finite independent app adapter', () => {
  it('preserves default backend and rejects foreign targets, secret keys and unbound actors before I/O', () => {
    expect(readIndependentStagingConfig({})).toBeNull();
    for (const replacement of [
      { VITE_PENNSYNC_BACKEND: 'typo' }, { VITE_PENNSYNC_STAGING_PROJECT_URL: 'https://foreign.supabase.co' },
      { VITE_PENNSYNC_STAGING_PUBLISHABLE_KEY: 'sb_secret_forbidden' }, { VITE_PENNSYNC_STAGING_ACTORS: '{}' },
    ]) expect(() => readIndependentStagingConfig({ ...stagingEnv, ...replacement })).toThrow();
  });
  it('projects exact legacy authority and synthetic names without clinical/profile claims or generic operations', async () => {
    const fixture = stagingFixture();
    const adapter = createIndependentStagingAdapter(readIndependentStagingConfig(stagingEnv), { fetchImpl: fixture.fetch });
    await adapter.auth.signIn(stagingEmails[0], 'Synthetic-accepted-password');
    expect(await adapter.authority.me()).toEqual({ id: '6aac58fe36c13a1c49ba7cf8', email: stagingEmails[0] });
    const listed = await adapter.authority.listMyTenantMemberships();
    expect(listed.data.memberships[0].tenant_role).toBe('agency_admin');
    const input = { agency_id: 'agency-a', mode: 'page', purpose: 'roster', sort: 'id_asc', page_size: 50, cursor: null };
    const page = await adapter.raw.functions.invoke('listAuthorizedPatients', input);
    expect(page.data.patients).toEqual([{ id: 'patient-0', first_name: 'Synthetic', last_name: 'Patient A1' }]);
    const count = fixture.requests.length;
    await expect(adapter.raw.functions.invoke('createAuthorizedPatient', {})).rejects.toThrow('STAGING_OPERATION_UNAVAILABLE');
    await expect(adapter.raw.functions.invoke('listAuthorizedPatients', { ...input, purpose: 'patient_management' })).rejects.toThrow();
    expect(fixture.requests).toHaveLength(count);
    expect(adapter.raw.entities).toEqual({});
    await adapter.auth.signOut(); expect(fixture.live.size).toBe(0);
  });
  it('requires live authority, rejects changed cursor scope, and fences delayed results on terminal cleanup', async () => {
    const fixture = stagingFixture();
    const adapter = createIndependentStagingAdapter(readIndependentStagingConfig(stagingEnv), { fetchImpl: fixture.fetch });
    await adapter.auth.signIn(stagingEmails[0], 'Synthetic-accepted-password');
    await expect(adapter.authority.getMyTenantContext({ agency_id: 'agency-b' })).rejects.toMatchObject({ status: 403 });
    const input = { agency_id: 'agency-a', mode: 'page', purpose: 'roster', sort: 'id_asc', page_size: 50,
      cursor: { after_id: 'patient-0', membership_version: 999 } };
    await expect(adapter.raw.functions.invoke('listAuthorizedPatients', input)).rejects.toThrow('STAGING_PATIENT_CURSOR_CHANGED');
    fixture.beforeReturn = () => adapter.raw.cleanup();
    await expect(adapter.raw.functions.invoke('listAuthorizedPatients', { ...input, cursor: null })).rejects.toThrow();
    expect(adapter.auth.hasSession()).toBe(false);
    await adapter.auth.signOut(); expect(fixture.live.size).toBe(0);
  });
  it('a replaced login catch cannot revoke the newer session on the same actor client', async () => {
    const fixture = stagingFixture();
    let entered, release, held = false;
    const arrival = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const adapter = createIndependentStagingAdapter(readIndependentStagingConfig(stagingEnv), {
      fetchImpl: async (url, options) => {
        const response = await fixture.fetch(url, options);
        if (!held && url.endsWith('/user')) { held = true; entered(); await gate; }
        return response;
      },
    });
    const first = adapter.auth.signIn(stagingEmails[0], 'Synthetic-accepted-password').catch(error => error.code);
    await arrival;
    await adapter.auth.signIn(stagingEmails[0], 'Synthetic-accepted-password');
    release(); expect(await first).toBe('STALE_AUTHORITY_SESSION');
    expect(adapter.auth.hasSession()).toBe(true); expect(fixture.live.size).toBe(1);
    expect((await adapter.authority.me()).email).toBe(stagingEmails[0]);
    await adapter.auth.signOut(); expect(fixture.live.size).toBe(0);
  });
  it('retains failed cleanup in the actor pool and retries it before a different login', async () => {
    const fixture = stagingFixture();
    let failCleanup = true;
    const adapter = createIndependentStagingAdapter(readIndependentStagingConfig(stagingEnv), {
      fetchImpl: (url, options) => {
        if (url.endsWith('/logout?scope=local') && failCleanup) {
          failCleanup = false;
          return Promise.resolve(new Response(null, { status: 503 }));
        }
        return fixture.fetch(url, options);
      },
    });
    await adapter.auth.signIn(stagingEmails[0], 'Synthetic-accepted-password');
    await expect(adapter.auth.signOut()).rejects.toMatchObject({ code: 'AUTHORITY_SESSION_CLEANUP_FAILED' });
    expect(adapter.auth.hasSession()).toBe(false); expect(fixture.live.size).toBe(1);
    await expect(adapter.authority.me()).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
    await adapter.auth.signIn(stagingEmails[3], 'Synthetic-accepted-password');
    expect(fixture.live.size).toBe(1);
    expect((await adapter.authority.me()).email).toBe(stagingEmails[3]);
    await adapter.auth.signOut(); expect(fixture.live.size).toBe(0);
  });
});

describe('the adapter module under plain node', () => {
  it('carries no "@/" alias import, because a node suite loads this file directly', async () => {
    // `services/authority-client/browser/actual-app-acceptance.test.mjs` runs
    // it under `node --test`, where Vite's alias does not resolve. Adding
    // `import { getActiveTrustedTenantContext } from '@/lib/roles'` here passed
    // lint, the whole of `pnpm test`, the build and every gate, and failed CI
    // with ERR_MODULE_NOT_FOUND — the trap AGENTS.md records as twenty suites
    // that `pnpm test` does not run. A relative import would not have saved it
    // either: `roles.js` reaches `@/lib/superAdmin` itself, which is why the
    // accessor is INJECTED by the composition root instead.
    // A repo-relative path, not `import.meta.url`: vitest serves modules over
    // http, so that URL is not a `file:` one and `readFile` rejects it.
    const source = await readFile('src/lib/independentStagingAdapter.js', 'utf8');
    const aliased = [...source.matchAll(/^\s*import\s[^;]*?from\s+['"`](@\/[^'"`]+)['"`]/gm)].map(m => m[1]);
    expect(aliased).toEqual([]);
  });
});

describe('the ported API caller', () => {
  const ported = { ...stagingEnv, VITE_PENNSYNC_API_URL: stagingApiUrl };
  const signedIn = async (env = ported) => {
    const fixture = stagingFixture();
    const adapter = createIndependentStagingAdapter(readIndependentStagingConfig(env),
      { fetchImpl: fixture.fetch, boundTenant: getActiveTrustedTenantContext });
    await adapter.auth.signIn(stagingEmails[0], 'Synthetic-accepted-password');
    return { fixture, adapter };
  };

  it('is absent unless the app has been pointed at the service, and pinned when it is', () => {
    // Unset, every ported name falls through to the refusal any other
    // unsupported name gets, so adding this path changes nothing until an
    // operator opts in.
    expect(readIndependentStagingConfig(stagingEnv).target.apiUrl).toBeNull();
    expect(readIndependentStagingConfig(ported).target.apiUrl).toBe(stagingApiUrl);
    for (const VITE_PENNSYNC_API_URL of ['https://pennsync-api-production.up.railway.app.evil.test',
      'https://example.test', 'http://127.0.0.1:54342']) {
      expect(() => readIndependentStagingConfig({ ...stagingEnv, VITE_PENNSYNC_API_URL }))
        .toThrow(/INVALID_STAGING_TARGET/);
    }
  });

  it('routes a ported name to the service with the caller own bearer and no project key', async () => {
    const { fixture, adapter } = await signedIn();
    // `data` is the HANDLER's result, not the service's envelope. Returning
    // the envelope here is what a consumer reading `data.policies` would have
    // been broken by — they would have been at `data.result.policies`.
    expect(await adapter.raw.functions.invoke('validatePatientData',
      { agency_id: 'agency-a', patient: { first_name: 'A' } })).toEqual({ data: { valid: true } });
    expect(fixture.apiCalls).toHaveLength(1);
    const [call] = fixture.apiCalls;
    expect(call.url).toBe(`${stagingApiUrl}/v1/functions/validatePatientData`);
    expect(call.headers.Authorization).toMatch(/^Bearer synthetic\.session\d+\.token$/);
    // The publishable key names the Supabase project and must not follow the
    // bearer to a second origin.
    expect(call.headers.apikey).toBeUndefined();
    expect(call.body).toEqual({ agency_id: 'agency-a', params: { patient: { first_name: 'A' } } });
  });

  it('unwraps the service envelope exactly once, and refuses one that is missing', async () => {
    const fixture = stagingFixture();
    const config = readIndependentStagingConfig(ported);
    const adapter = createIndependentStagingAdapter(config, { fetchImpl: fixture.fetch });
    await adapter.auth.signIn(stagingEmails[0], 'Synthetic-accepted-password');
    fixture.apiResponse = () => new Response(JSON.stringify({
      success: true, result: { policies: [{ id: 'pol-1' }] },
      execution: 'pennsync-api', base44ExecutionDependency: false,
    }), { headers: { 'content-type': 'application/json' } });
    const answer = await adapter.raw.functions.invoke('listPolicyLibrary',
      { agency_id: 'agency-a', mode: 'active' });
    // What a consumer actually reads.
    expect(answer.data.policies).toEqual([{ id: 'pol-1' }]);
    expect(answer.data.result).toBeUndefined();

    // A bare payload — the shape these tests used to send — is refused rather
    // than passed through as though it were a handler result.
    fixture.apiResponse = () => new Response(JSON.stringify({ policies: [] }),
      { headers: { 'content-type': 'application/json' } });
    await expect(adapter.raw.functions.invoke('listPolicyLibrary', { agency_id: 'agency-a' }))
      .rejects.toThrow(/PENNSYNC_API_RESPONSE_INVALID/);
  });

  it('refuses when there is no bound principal to take a tenant from', async () => {
    // The Base44 original accepted any authenticated caller; the ported service
    // requires a current agency membership. With nothing bound there is no
    // tenant to act as, so the refusal stands — this is the case it is for.
    const { fixture, adapter } = await signedIn();
    clearTrustedTenantContext();
    await expect(adapter.raw.functions.invoke('validatePatientData', { patient: {} }))
      .rejects.toThrow(/STAGING_TENANT_SELECTION_REQUIRED/);
    expect(fixture.apiCalls).toHaveLength(0);
  });

  it('takes the tenant from the bound principal when the call site names none', async () => {
    // The recorded plan was to edit all 67 call sites instead. That is unsafe
    // rather than merely large: `src/functions/*` wrappers serve BOTH backends,
    // and roughly a third of the Base44 originals reject an unknown key — a
    // first scan called `createAuthorizedPatient` tolerant and it rejects at
    // `entry.ts:149`. So the tenant is supplied here, where it reaches only the
    // ported service and can never enter a Base44 payload.
    const { fixture, adapter } = await signedIn();
    bindTrustedTenantContext(boundUser, boundContext());
    try {
      expect(await adapter.raw.functions.invoke('validatePatientData', { patient: { first_name: 'A' } }))
        .toEqual({ data: { valid: true } });
      const [call] = fixture.apiCalls;
      // Lifted into the envelope exactly as an explicit one is, and never into
      // `params`, which is what the handler receives.
      expect(call.body).toEqual({ agency_id: 'agency-a', params: { patient: { first_name: 'A' } } });
    } finally { clearTrustedTenantContext(); }
  });

  it('serves a bare revalidation call rather than refusing it, which is why it is gated', async () => {
    // `docs/RAILWAY_GO_LIVE_PLAN_2026-09-21.md` predicted that a bare
    // `getMyTenantContext()` "would refuse on the routed path while the
    // bootstrap kept working" — a loud failure. The fallback above inverted
    // that: the call succeeds, carrying the bound agency and an EMPTY
    // `params`, so `expectedMembershipId` and `expectedMembershipVersion` —
    // the two values `resolveMyTenantContext` compares the answer against —
    // are simply absent. A revalidation that carries no expectation
    // revalidates nothing, and nothing about it looks wrong at runtime.
    //
    // The adapter is right to serve it: it cannot tell a revalidation apart
    // from any other ported name, and inventing an expectation would be worse.
    // So the invariant lives at the call sites, where
    // `tools-tenant-revalidation-path.mjs` holds it: every one passes
    // `trustedTenantRequest(...).options`, which sets `agencyId`
    // unconditionally and returns null rather than omitting it.
    const { fixture, adapter } = await signedIn();
    bindTrustedTenantContext(boundUser, boundContext());
    try {
      await adapter.raw.functions.invoke('getMyTenantContext', {});
      const [call] = fixture.apiCalls;
      expect(call.url).toBe(`${stagingApiUrl}/v1/functions/getMyTenantContext`);
      expect(call.body).toEqual({ agency_id: 'agency-a', params: {} });
      expect(call.body.params.expectedMembershipId).toBeUndefined();
      expect(call.body.params.expectedMembershipVersion).toBeUndefined();
    } finally { clearTrustedTenantContext(); }
  });

  it('refuses an explicitly falsy tenant instead of substituting the bound one', async () => {
    const { fixture, adapter } = await signedIn();
    bindTrustedTenantContext(boundUser, boundContext());
    try {
      // A present-but-empty tenant is a lookup that produced nothing, not an
      // absent key. `supplied || bound` answered it with the bound agency,
      // which acts on a tenant nobody chose; the key's presence decides now.
      for (const agency_id of [null, '', undefined]) {
        await expect(adapter.raw.functions.invoke('validatePatientData', { agency_id, patient: {} }))
          .rejects.toThrow(/STAGING_TENANT_SELECTION_REQUIRED/);
      }
      expect(fixture.apiCalls).toHaveLength(0);
    } finally { clearTrustedTenantContext(); }
  });

  it('never overrides a tenant the call site did name', async () => {
    const { fixture, adapter } = await signedIn();
    // Bound to one agency, asked for another: the request decides, because a
    // caller naming a tenant is making a choice the bound context must not
    // silently replace. The server re-checks the membership regardless.
    bindTrustedTenantContext(boundUser, boundContext({ agency_id: 'agency-bound' }));
    try {
      await adapter.raw.functions.invoke('validatePatientData',
        { agency_id: 'agency-a', patient: { first_name: 'A' } });
      expect(fixture.apiCalls.at(-1).body.agency_id).toBe('agency-a');
    } finally { clearTrustedTenantContext(); }
  });

  it('serves a document through the fetch surface the download flows actually use', async () => {
    // `UserGuides.jsx` and `Help.jsx` call `functions.fetch` rather than
    // `invoke`, because the invoke wrapper decodes PDF bytes as UTF-8 and
    // corrupts them. Routing only `invoke` left those three handlers
    // unreachable from the only call sites that use them.
    const fixture = stagingFixture();
    const config = readIndependentStagingConfig(ported);
    const adapter = createIndependentStagingAdapter(config, { fetchImpl: fixture.fetch });
    await adapter.auth.signIn(stagingEmails[0], 'Synthetic-accepted-password');
    fixture.apiResponse = () => new Response(new Uint8Array([37, 80, 68, 70]),
      { headers: { 'content-type': 'application/pdf' } });

    const response = await adapter.raw.functions.fetch('generateUserManual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agency_id: 'agency-a' }),
    });
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    // The bytes survive: that is the whole reason these call sites use fetch.
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([37, 80, 68, 70]);

    // The same refusals as `invoke`, because both go through one path.
    await expect(adapter.raw.functions.fetch('generateUserManual', { body: JSON.stringify({}) }))
      .rejects.toThrow(/STAGING_TENANT_SELECTION_REQUIRED/);
    await expect(adapter.raw.functions.fetch('offboardUser', { body: JSON.stringify({ agency_id: 'agency-a' }) }))
      .rejects.toThrow(/STAGING_OPERATION_UNAVAILABLE/);
    await expect(adapter.raw.functions.fetch('generateUserManual', { body: 'not json' }))
      .rejects.toThrow(/STAGING_OPERATION_UNAVAILABLE/);
  });

  it('exposes no fetch route at all when the service is not configured', async () => {
    const fixture = stagingFixture();
    const adapter = createIndependentStagingAdapter(readIndependentStagingConfig(stagingEnv),
      { fetchImpl: fixture.fetch });
    await adapter.auth.signIn(stagingEmails[0], 'Synthetic-accepted-password');
    await expect(adapter.raw.functions.fetch('generateUserManual',
      { body: JSON.stringify({ agency_id: 'agency-a' }) })).rejects.toThrow(/STAGING_OPERATION_UNAVAILABLE/);
    expect(fixture.apiCalls).toHaveLength(0);
  });

  it('still fails closed for every name the service does not serve', async () => {
    const { fixture, adapter } = await signedIn();
    for (const name of ['offboardUser', 'transcribeAndGenerateSOAPNote', 'analyzeNurseDeficits', 'nope']) {
      await expect(adapter.raw.functions.invoke(name, { agency_id: 'agency-a' }))
        .rejects.toThrow(/STAGING_OPERATION_UNAVAILABLE/);
    }
    expect(fixture.apiCalls).toHaveLength(0);
  });

  it('leaves the synthetic referral flow alone, because one name carries two capabilities', async () => {
    // `manageAuthorizedReferral` is the ported broker AND this adapter's own
    // S3 staging flow. Routing was keyed on the NAME, so adding the broker to
    // `PORTED_FUNCTIONS` sent every `staging_*` action to the service — where
    // the `{action, params}` envelope has no top-level `agency_id` and each
    // one failed `STAGING_TENANT_SELECTION_REQUIRED`. Every other
    // special-cased name is the same capability served two ways; this one is
    // not, so the action decides.
    const { fixture, adapter } = await signedIn();
    // Asserted on the REFUSAL rather than on the absence of a request: the
    // broken routing also made no request — it failed inside `portedCall` on
    // the missing top-level `agency_id` — so "nothing was sent" does not tell
    // the two branches apart. These codes come from the staging branch's own
    // validators and `portedCall` cannot reach either of them.
    const refusal = async action => adapter.raw.functions.invoke('manageAuthorizedReferral',
      { action, params: { p_agency_id: 'agency-a' } }).then(() => null, error => error?.code);
    for (const action of ['staging_list', 'staging_roster', 'staging_create',
      'staging_confirm', 'staging_read']) {
      expect(await refusal(action)).toBe('INVALID_AUTHORITY_REQUEST');
    }
    expect(await refusal('staging_prepare')).toBe('STAGING_OPERATION_UNAVAILABLE');
    expect(await refusal('staging_invented')).toBe('STAGING_OPERATION_UNAVAILABLE');
    expect(fixture.apiCalls).toHaveLength(0);
    // And the broker's own actions still do.
    fixture.apiResponse = () => new Response(JSON.stringify({
      success: true, result: { referrals: [], scope: {} },
      execution: 'pennsync-api', base44ExecutionDependency: false,
    }), { headers: { 'content-type': 'application/json' } });
    const answer = await adapter.raw.functions.invoke('manageAuthorizedReferral',
      { agency_id: 'agency-a', action: 'list', limit: 200 });
    expect(answer.data.referrals).toEqual([]);
    expect(fixture.apiCalls).toHaveLength(1);
    expect(fixture.apiCalls[0].url).toBe(`${stagingApiUrl}/v1/functions/manageAuthorizedReferral`);
    expect(fixture.apiCalls[0].body).toEqual({
      agency_id: 'agency-a', params: { action: 'list', limit: 200 },
    });
  });

  it('reaches nothing once the session ends', async () => {
    const { fixture, adapter } = await signedIn();
    await adapter.auth.signOut();
    await expect(adapter.raw.functions.invoke('validatePatientData', { agency_id: 'agency-a', patient: {} }))
      .rejects.toThrow(/AUTHENTICATION_REQUIRED/);
    expect(fixture.apiCalls).toHaveLength(0);
  });
});
