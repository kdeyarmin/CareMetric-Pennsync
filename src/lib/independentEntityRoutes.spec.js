import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createIndependentStagingAdapter, readIndependentStagingConfig } from './independentStagingAdapter';
import { ARGUMENTS_UNSUPPORTED, ROSTER_MAXIMUM } from './independentEntityRoutes';
import { bindTrustedTenantContext, clearTrustedTenantContext, getActiveTrustedTenantContext } from '@/lib/roles';
import { stagingApiUrl, stagingEmails, stagingEnv, stagingFixture } from '@/test/independentStagingFixture';

const boundUser = Object.freeze({ id: 'user-1', email: stagingEmails[0] });
const boundContext = Object.freeze({
  user_id: 'user-1', user_email: stagingEmails[0], membership_id: 'membership-1',
  membership_key: 'agency-a:user-1', membership_version: 1, agency_id: 'agency-a',
  tenant_role: 'agency_admin', membership_status: 'active', is_platform_owner: false,
  agency: { id: 'agency-a', name: 'Synthetic Agency A', status: 'active' },
});

/** The roster contract's own answer shape: entries, plus a keyset cursor. */
const rosterAnswer = (entries, next = null) => () => new Response(
  JSON.stringify({ success: true, result: { entries, next }, execution: 'pennsync-api', base44ExecutionDependency: false }),
  { headers: { 'content-type': 'application/json' } });

describe('the declared entity routes', () => {
  const ported = { ...stagingEnv, VITE_PENNSYNC_API_URL: stagingApiUrl };
  const signedIn = async (env = ported) => {
    const fixture = stagingFixture();
    const adapter = createIndependentStagingAdapter(readIndependentStagingConfig(env),
      { fetchImpl: fixture.fetch, boundTenant: getActiveTrustedTenantContext });
    await adapter.auth.signIn(stagingEmails[0], 'Synthetic-accepted-password');
    return { fixture, adapter };
  };

  beforeEach(() => bindTrustedTenantContext(boundUser, boundContext));
  afterEach(() => clearTrustedTenantContext());

  it('serves User.list from the roster contract and hands back the rows, not the envelope', async () => {
    const { fixture, adapter } = await signedIn();
    const entries = [{ id: 'u-1', email: 'a@example.test', tenant_role: 'clinician' }];
    fixture.apiResponse = rosterAnswer(entries);

    // What 36 call sites already write. They get an ARRAY, as `User.list` has
    // always returned — not `{entries}` and not the service's envelope.
    expect(await adapter.raw.entities.User.list()).toEqual(entries);

    expect(fixture.apiCalls).toHaveLength(1);
    const [call] = fixture.apiCalls;
    expect(call.url).toBe(`${stagingApiUrl}/v1/functions/listAgencyRoster`);
    // The tenant is the bound principal's, exactly as a ported function call's
    // is — this level adds no tenant of its own and can remove none.
    expect(call.body.agency_id).toBe('agency-a');
    expect(call.body.params).toEqual({});
  });

  it('passes a limit through and refuses one above the contract ceiling', async () => {
    const { fixture, adapter } = await signedIn();
    fixture.apiResponse = rosterAnswer([]);
    await adapter.raw.entities.User.list(undefined, 25);
    expect(fixture.apiCalls.at(-1).body.params).toEqual({ limit: 25 });

    // The contract clamps silently. Refusing keeps a screen that asked for
    // more rows than the roster will ever return from rendering a short list
    // as the whole agency.
    await expect(adapter.raw.entities.User.list(undefined, ROSTER_MAXIMUM + 1))
      .rejects.toThrow(ARGUMENTS_UNSUPPORTED);
    for (const limit of [0, -1, 1.5, '10']) {
      await expect(adapter.raw.entities.User.list(undefined, limit)).rejects.toThrow(ARGUMENTS_UNSUPPORTED);
    }
    expect(fixture.apiCalls).toHaveLength(1);
  });

  /**
   * The failure this whole module is shaped to prevent: answering an order the
   * contract cannot produce by quietly returning a different one.
   */
  it('refuses a sort it cannot produce rather than reordering the screen', async () => {
    const { fixture, adapter } = await signedIn();
    fixture.apiResponse = rosterAnswer([]);
    for (const sort of ['-created_date', 'created_date', '-email', 'full_name', 42]) {
      await expect(adapter.raw.entities.User.list(sort)).rejects.toThrow(ARGUMENTS_UNSUPPORTED);
    }
    // Nothing reached the service: a refused argument is refused before I/O.
    expect(fixture.apiCalls).toHaveLength(0);

    for (const sort of ['', 'email', '+email']) {
      await expect(adapter.raw.entities.User.list(sort)).resolves.toEqual([]);
    }
  });

  it('refuses an argument shape and a missing route with different codes', async () => {
    const { fixture, adapter } = await signedIn();
    // "Your query cannot be served" and "no route exists" are different
    // answers, and a screen's author has to be able to tell them apart.
    await expect(adapter.raw.entities.User.list('-created_date'))
      .rejects.toMatchObject({ code: ARGUMENTS_UNSUPPORTED });
    await expect(adapter.raw.entities.User.create({}))
      .rejects.toMatchObject({ code: 'STAGING_OPERATION_UNAVAILABLE', operation: 'entities.User.create' });
    expect(fixture.apiCalls).toHaveLength(0);
  });

  it('leaves every undeclared entity call refusing exactly as before', async () => {
    const { fixture, adapter } = await signedIn();
    for (const [entity, operation] of [['TrainingCourse', 'list'], ['Patient', 'list'],
      ['Incident', 'filter'], ['User', 'update'], ['User', 'subscribe']]) {
      await expect(adapter.raw.entities[entity][operation]())
        .rejects.toMatchObject({ code: 'STAGING_OPERATION_UNAVAILABLE', operation: `entities.${entity}.${operation}` });
    }
    expect(fixture.apiCalls).toHaveLength(0);
  });

  it('refuses a declared route when no service is configured', async () => {
    // Same condition a ported function call applies: with nothing to ask, a
    // declared route is not a route, and the build answers "unavailable"
    // rather than a transport error.
    const { fixture, adapter } = await signedIn(stagingEnv);
    await expect(adapter.raw.entities.User.list())
      .rejects.toMatchObject({ code: 'STAGING_OPERATION_UNAVAILABLE', operation: 'entities.User.list' });
    expect(fixture.apiCalls).toHaveLength(0);
  });

  it('refuses with no bound principal, because there is then no tenant to act as', async () => {
    const { fixture, adapter } = await signedIn();
    clearTrustedTenantContext();
    await expect(adapter.raw.entities.User.list()).rejects.toThrow(/STAGING_TENANT_SELECTION_REQUIRED/);
    expect(fixture.apiCalls).toHaveLength(0);
  });

  it('does not make the namespace thenable', async () => {
    const { adapter } = await signedIn();
    expect(adapter.raw.entities.then).toBeUndefined();
    expect(adapter.raw.entities.User.then).toBeUndefined();
    await expect(Promise.resolve(adapter.raw.entities)).resolves.toBe(adapter.raw.entities);
  });
});
