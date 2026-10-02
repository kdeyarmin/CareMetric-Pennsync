import { describe, expect, it } from 'vitest';
import {
  createIndependentProductionAdapter, readIndependentProductionConfig,
} from './independentProductionAdapter';
import { bindTrustedTenantContext, clearTrustedTenantContext, getActiveTrustedTenantContext } from '@/lib/roles';
import {
  productionApiUrl, productionDevice, productionEmail, productionEnv, productionFixture, productionPassword,
  productionUserId,
} from '@/test/independentProductionFixture';
import { stagingEnv } from '@/test/independentStagingFixture';

const adapterFor = (fixture, env = productionEnv, options = {}) => createIndependentProductionAdapter(
  readIndependentProductionConfig(env), { fetchImpl: fixture.fetch, ...options },
);
const signedIn = async (fixture, options) => {
  const adapter = adapterFor(fixture, productionEnv, options);
  await adapter.auth.signIn(productionEmail, productionPassword);
  return adapter;
};

describe('the production backend mode', () => {
  it('is selected by exactly one value and reads its deployment from build configuration', () => {
    // The default and the staging build both leave production unselected: at
    // most one owned mode can ever be live.
    expect(readIndependentProductionConfig({})).toBeNull();
    expect(readIndependentProductionConfig({ VITE_PENNSYNC_BACKEND: 'base44' })).toBeNull();
    expect(readIndependentProductionConfig(stagingEnv)).toBeNull();
    const config = readIndependentProductionConfig(productionEnv);
    expect(config.target.appId).toBe(productionEnv.VITE_PENNSYNC_APP_ID);
    expect(config.target.apiUrl).toBe(productionApiUrl);
    // Nothing is pinned in code, so the check is that the values AGREE and that
    // the staging environment is refused by name.
    for (const replacement of [
      { VITE_PENNSYNC_APP_ID: '' },
      { VITE_PENNSYNC_APP_ID: '6a9881683dc68a0bd54f1ef7' },
      { VITE_PENNSYNC_PROJECT_REF: 'xxtyweswohkvgkprimwa' },
      { VITE_PENNSYNC_PROJECT_URL: 'https://somewhere.else.supabase.co' },
      { VITE_PENNSYNC_PUBLISHABLE_KEY: 'sb_secret_forbidden' },
      { VITE_PENNSYNC_API_URL: '' },
      { VITE_PENNSYNC_API_URL: `${productionApiUrl}/v1/functions/getAgencySettings` },
    ]) {
      expect(() => readIndependentProductionConfig({ ...productionEnv, ...replacement }))
        .toThrow('INVALID_PRODUCTION_TARGET');
    }
  });

  it('signs a real staff account in and resolves its own tenant without touching Base44', async () => {
    const fixture = productionFixture();
    fixture.agencies = ['agency-one', 'agency-two'];
    const adapter = await signedIn(fixture);
    expect(adapter.auth.hasSession()).toBe(true);
    expect(await adapter.authority.me()).toEqual({ id: productionUserId, email: productionEmail });
    const listed = await adapter.authority.listMyTenantMemberships();
    expect(listed.data.subject).toEqual({ user_id: productionUserId, user_email: productionEmail, is_platform_owner: false });
    expect(listed.data.memberships.map(value => value.agency.name))
      .toEqual(['Keystone Home Health', 'Riverbend Hospice']);
    // The projection is the app's existing tenant-context contract: a real
    // agency name passes, which is the whole difference from staging.
    const context = await adapter.authority.getMyTenantContext({ agency_id: 'agency-two' });
    expect(context.data.tenant_context.tenant_role).toBe('clinician');
    expect(context.data.tenant_context.agency.name).toBe('Riverbend Hospice');
    expect(Object.keys(context.data.tenant_context)).not.toContain('auth_user_id');
  });

  it('refuses a tenant it was not granted, and an expectation that no longer holds', async () => {
    const fixture = productionFixture();
    const adapter = await signedIn(fixture);
    await expect(adapter.authority.getMyTenantContext({ agency_id: 'agency-nope' }))
      .rejects.toMatchObject({ status: 403 });
    await expect(adapter.authority.getMyTenantContext({}))
      .rejects.toThrow('PENNSYNC_TENANT_SELECTION_REQUIRED');
    await expect(adapter.authority.getMyTenantContext({ agency_id: 'agency-one', expected_membership_version: 99 }))
      .rejects.toThrow('PENNSYNC_MEMBERSHIP_CHANGED');
  });

  it('closes the session on sign-out and refuses every later call on the stale lease', async () => {
    const fixture = productionFixture();
    const adapter = await signedIn(fixture);
    await adapter.auth.signOut();
    expect(adapter.auth.hasSession()).toBe(false);
    expect(fixture.live.size).toBe(0);
    await expect(adapter.authority.me()).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED', status: 401 });
    await expect(adapter.raw.functions.invoke('getAgencySettings', { agency_id: 'agency-one' }))
      .rejects.toMatchObject({ status: 401 });
  });

  it('a wrong password is a refusal and leaves no session behind', async () => {
    const fixture = productionFixture();
    const adapter = adapterFor(fixture);
    await expect(adapter.auth.signIn(productionEmail, 'wrong-password-entirely'))
      .rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' });
    expect(adapter.auth.hasSession()).toBe(false);
    expect(fixture.live.size).toBe(0);
  });

  it('serves a ported handler with the bound tenant and refuses an unported name', async () => {
    const fixture = productionFixture();
    clearTrustedTenantContext();
    const adapter = await signedIn(fixture, { boundTenant: getActiveTrustedTenantContext });
    // With no bound principal there is genuinely no tenant to act as.
    await expect(adapter.raw.functions.invoke('getAgencySettings', {}))
      .rejects.toThrow('PENNSYNC_TENANT_SELECTION_REQUIRED');
    bindTrustedTenantContext({ id: productionUserId, email: productionEmail }, {
      user_id: productionUserId, user_email: productionEmail, membership_id: 'membership-agency-one',
      membership_key: `agency-one:${productionUserId}`, membership_version: 4, agency_id: 'agency-one',
      tenant_role: 'agency_admin', membership_status: 'active', is_platform_owner: false,
      agency: { id: 'agency-one', name: 'Keystone Home Health', status: 'active' },
    });
    try {
      const answer = await adapter.raw.functions.invoke('getAgencySettings', {});
      // The service's `{success, result, …}` envelope is unwrapped once, at the
      // client boundary, so a consumer sees what its Base44 original returned.
      expect(answer).toEqual({ data: { ok: true } });
      expect(fixture.apiCalls.at(-1).body).toEqual({ agency_id: 'agency-one', params: {} });
      // An explicitly falsy tenant is a lookup that produced nothing, not an
      // absent key, so it falls to the refusal rather than being replaced.
      await expect(adapter.raw.functions.invoke('getAgencySettings', { agency_id: null }))
        .rejects.toThrow('PENNSYNC_TENANT_SELECTION_REQUIRED');
    } finally { clearTrustedTenantContext(); }
    // An unported Base44 capability refuses by name. 149 of them ARE ported and
    // reachable here, which is why the refusal is checked against one that is
    // genuinely absent rather than against a name somebody assumed was absent.
    await expect(adapter.raw.functions.invoke('analyzeFaxPriority', { agency_id: 'agency-one' }))
      .rejects.toThrow('PENNSYNC_OPERATION_UNAVAILABLE');
  });

  it('exposes no generic entity, integration or Base44 escape hatch', async () => {
    const fixture = productionFixture();
    const adapter = await signedIn(fixture);
    const before = fixture.requests.length;
    await expect(adapter.raw.entities.TrainingCourse.list()).rejects.toMatchObject({
      code: 'PENNSYNC_OPERATION_UNAVAILABLE', operation: 'entities.TrainingCourse.list',
    });
    await expect(adapter.raw.integrations.Core.InvokeLLM({})).rejects.toMatchObject({
      code: 'PENNSYNC_OPERATION_UNAVAILABLE', operation: 'integrations.Core.InvokeLLM',
    });
    // A refusing namespace must not read as a thenable, or `await
    // base44.entities` would call it.
    expect(adapter.raw.entities.then).toBeUndefined();
    expect(() => adapter.raw.auth.redirectToLogin()).toThrow('PENNSYNC_OPERATION_UNAVAILABLE');
    expect(() => adapter.raw.auth.setToken('x')).toThrow('PENNSYNC_OPERATION_UNAVAILABLE');
    expect(fixture.requests).toHaveLength(before);
  });

  it('a replaced login cannot be revoked by the attempt it replaced', async () => {
    const fixture = productionFixture();
    let held = false;
    let entered, released;
    const arrival = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { released = resolve; });
    const adapter = adapterFor(fixture, productionEnv, {
      fetchImpl: async (url, options) => {
        const response = await fixture.fetch(url, options);
        if (!held && url.endsWith('/user')) { held = true; entered(); await gate; }
        return response;
      },
    });
    const first = adapter.auth.signIn(productionEmail, productionPassword).catch(error => error.code);
    await arrival;
    await adapter.auth.signIn(productionEmail, productionPassword);
    released();
    expect(await first).toBe('STALE_AUTHORITY_SESSION');
    expect(adapter.auth.hasSession()).toBe(true);
    expect(fixture.live.size).toBe(1);
    expect((await adapter.authority.me()).email).toBe(productionEmail);
  });

  it('an aborted sign-in leaves nothing live and refuses on its own lease', async () => {
    const fixture = productionFixture();
    const adapter = adapterFor(fixture);
    const controller = new AbortController();
    controller.abort();
    await expect(adapter.auth.signIn(productionEmail, productionPassword, controller.signal))
      .rejects.toMatchObject({ code: 'STALE_AUTHORITY_SESSION', status: 401 });
    expect(adapter.auth.hasSession()).toBe(false);
    expect(fixture.live.size).toBe(0);
  });
});

describe('a session this device already holds', () => {
  it('is taken up without a password, and signing out leaves nothing to take up', async () => {
    const fixture = productionFixture();
    const device = productionDevice();
    const first = adapterFor(fixture, productionEnv, { device });
    await first.auth.signIn(productionEmail, productionPassword);
    expect(device.state.email).toBe(productionEmail);
    expect(typeof device.state.token).toBe('string');

    // A reload: a NEW adapter over the same device, with nothing in memory.
    const reloaded = adapterFor(fixture, productionEnv, { device });
    expect(reloaded.auth.hasSession()).toBe(false);
    expect(await reloaded.auth.resume()).toBe(true);
    expect(reloaded.auth.hasSession()).toBe(true);
    expect(fixture.refreshed).toBe(1);
    // And the resumed session answers for the person, through the ordinary path.
    expect(await reloaded.authority.me()).toEqual({ id: productionUserId, email: productionEmail });

    await reloaded.auth.signOut();
    expect(device.state.token).toBeNull();
    expect(device.state.clears).toBeGreaterThan(0);
    const third = adapterFor(fixture, productionEnv, { device });
    expect(await third.auth.resume()).toBe(false);
  });

  it('closing the realm leaves the device able to resume; only signing out forgets', async () => {
    const fixture = productionFixture();
    const device = productionDevice();
    const adapter = adapterFor(fixture, productionEnv, { device });
    await adapter.auth.signIn(productionEmail, productionPassword);
    const kept = device.state.token;
    await adapter.auth.signOut({ forget: false });
    expect(adapter.auth.hasSession()).toBe(false);
    expect(device.state.token).toBe(kept);
    expect(await adapterFor(fixture, productionEnv, { device }).auth.resume()).toBe(true);
  });

  it('two overlapping boots leave the record alone, because the loser refused nothing', async () => {
    // StrictMode double-invokes an effect, so two boots in one document is
    // ordinary rather than exotic. The second fences the first's lease, and the
    // first throws STALE_AUTHORITY_SESSION before it has constructed a client —
    // so nothing reached the provider and nothing refused the record.
    //
    // A reviewer measured the earlier shape: the loser removed the record with no
    // exchange and no logout, which also contradicted the client's own KEEP_ON,
    // where that code is listed as a keep. Only a stored address the CLIENT will
    // not accept justifies forgetting, and that case is the test below.
    const fixture = productionFixture();
    const device = productionDevice();
    await (await signedIn(fixture, { device })).auth.signOut({ forget: false });
    const kept = device.state.token;
    expect(typeof kept).toBe('string');

    const booting = adapterFor(fixture, productionEnv, { device });
    const [loser, winner] = await Promise.all([booting.auth.resume(), booting.auth.resume()]);
    expect(loser).toBe(false);
    expect(winner).toBe(true);
    // The record is the one thing a boot must not destroy. It has ROTATED, because
    // the winner exchanged it, so what is asserted is that one is there and that
    // nothing cleared.
    expect(device.state.clears).toBe(0);
    expect(typeof device.state.token).toBe('string');
    expect(device.state.email).toBe(productionEmail);
    // And a third boot over that record still works, which is the consequence the
    // person would have noticed: a password prompt on every reload.
    expect(await adapterFor(fixture, productionEnv, { device }).auth.resume()).toBe(true);
  });

  it('a boot whose exchange is refused forgets only the token it spent, so a winning tab keeps its record', async () => {
    // The loser of a two-tab race read the OLD token, and the winner has since
    // rotated the record. The loser's exchange is refused, and its cleanup must
    // go through `clearSpent`: an unconditional `clear` here would delete the
    // record the provider still honours.
    const fixture = productionFixture();
    const device = productionDevice();
    await (await signedIn(fixture, { device })).auth.signOut({ forget: false });
    const winnersToken = device.state.token;
    const staleDevice = {
      ...device,
      port: address => ({ ...device.port(address), read: () => 'refresh-already-spent-by-winner' }),
    };
    const loser = adapterFor(fixture, productionEnv, { device: staleDevice });
    expect(await loser.auth.resume()).toBe(false);
    expect(device.state.token).toBe(winnersToken);
    expect(device.state.email).toBe(productionEmail);
    expect(device.state.clears).toBe(0);
  });

  it('answers false, and reaches no project, when this device holds nothing', async () => {
    const fixture = productionFixture();
    const adapter = adapterFor(fixture, productionEnv, { device: productionDevice() });
    expect(await adapter.auth.resume()).toBe(false);
    expect(fixture.requests).toEqual([]);
    expect(adapter.auth.hasSession()).toBe(false);
  });

  it('a record naming somebody the project refuses leaves no session and is forgotten', async () => {
    const fixture = productionFixture();
    const device = productionDevice('someone.else@agency.example', 'refresh-nobody-minted');
    const adapter = adapterFor(fixture, productionEnv, { device });
    expect(await adapter.auth.resume()).toBe(false);
    expect(adapter.auth.hasSession()).toBe(false);
    expect(device.state.token).toBeNull();
  });
});
