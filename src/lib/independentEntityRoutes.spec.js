import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createIndependentStagingAdapter, readIndependentStagingConfig } from './independentStagingAdapter';
import { ARGUMENTS_UNSUPPORTED, BROKER_MAXIMUM, PAGE_INCOMPLETE, ROSTER_MAXIMUM } from './independentEntityRoutes';
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

  /**
   * The broker family's seven call sites. Every one asks the family for an
   * order it does not have, and three for a predicate it does not have either,
   * so every one is served under the complete-set rule.
   */
  describe('the reads the broker family serves', () => {
    const rows = (value) => () => new Response(
      JSON.stringify({ success: true, result: value, execution: 'pennsync-api', base44ExecutionDependency: false }),
      { headers: { 'content-type': 'application/json' } });

    it('asks for one row more than the screen wanted, and orders the answer here', async () => {
      const { fixture, adapter } = await signedIn();
      fixture.apiResponse = rows([
        { id: 'a', title: 'older', created_date: '2026-01-01T00:00:00Z' },
        { id: 'b', title: 'newest', created_date: '2026-03-01T00:00:00Z' },
        { id: 'c', title: 'middle', created_date: '2026-02-01T00:00:00Z' },
      ]);
      const answer = await adapter.raw.entities.Announcement.list('-created_date', 200);
      expect(answer.map(row => row.title)).toEqual(['newest', 'middle', 'older']);

      const [call] = fixture.apiCalls;
      expect(call.url).toBe(`${stagingApiUrl}/v1/functions/listBrokeredRecords`);
      // 201, not 200: the extra row is the whole proof that the page is the set.
      expect(call.body.params).toEqual({ entity: 'Announcement', limit: 201 });
    });

    /**
     * The failure the rule exists for. Sorting what came back would answer
     * "the 200 newest" with "200 of them, newest first" — right on every
     * screen, wrong whenever there is a 201st row.
     */
    it('refuses rather than ordering a page it cannot prove is the whole set', async () => {
      const { fixture, adapter } = await signedIn();
      fixture.apiResponse = rows(Array.from({ length: 201 }, (unused, index) => (
        { id: `row-${index}`, created_date: '2026-01-01T00:00:00Z' })));
      await expect(adapter.raw.entities.Announcement.list('-created_date', 200))
        .rejects.toMatchObject({ code: PAGE_INCOMPLETE, detail: 'Announcement' });
    });

    it('proves it at the family ceiling too, where there is no extra row to ask for', async () => {
      const { fixture, adapter } = await signedIn();
      // The probe cannot exceed what the family will return, so at the ceiling
      // a FULL page is the incomplete signal instead of an extra row.
      fixture.apiResponse = rows(Array.from({ length: BROKER_MAXIMUM }, (unused, index) => ({ id: `row-${index}` })));
      await expect(adapter.raw.entities.Announcement.list('-created_date', BROKER_MAXIMUM))
        .rejects.toThrow(PAGE_INCOMPLETE);
      expect(fixture.apiCalls.at(-1).body.params.limit).toBe(BROKER_MAXIMUM);

      fixture.apiResponse = rows(Array.from({ length: BROKER_MAXIMUM - 1 }, (unused, index) => ({ id: `row-${index}` })));
      await expect(adapter.raw.entities.Announcement.list('-created_date', BROKER_MAXIMUM))
        .resolves.toHaveLength(BROKER_MAXIMUM - 1);
    });

    it('applies the predicate the family has none of, in both shapes the screens use', async () => {
      const { fixture, adapter } = await signedIn();
      fixture.apiResponse = rows([
        { id: 'a', is_active: true, created_date: '2026-01-01T00:00:00Z' },
        { id: 'b', is_active: false, created_date: '2026-02-01T00:00:00Z' },
      ]);
      await expect(adapter.raw.entities.Announcement.filter({ is_active: true }, '-created_date', 200))
        .resolves.toEqual([{ id: 'a', is_active: true, created_date: '2026-01-01T00:00:00Z' }]);

      fixture.apiResponse = rows([
        { id: 'a', status: 'approved', effective_date: '2026-01-01' },
        { id: 'b', status: 'dismissed', effective_date: '2026-02-01' },
        { id: 'c', status: 'implemented', effective_date: '2026-03-01' },
      ]);
      const answer = await adapter.raw.entities.RegulatoryUpdate
        .filter({ status: { $in: ['approved', 'implemented'] } }, '-effective_date', 200);
      expect(answer.map(row => row.id)).toEqual(['c', 'a']);
      // An empty query is a real call site (`RegulatoryMonitor`) and keeps everything.
      fixture.apiResponse = rows([{ id: 'a', effective_date: '2026-01-01' }]);
      await expect(adapter.raw.entities.RegulatoryUpdate.filter({}, '-created_date', 200)).resolves.toHaveLength(1);
    });

    /**
     * Recorded rather than fixed. `severity` is the text enum
     * `critical|high|medium|low`, so descending is lexicographic and puts
     * `medium` first — plainly not what the screen means, and what the product
     * does today. A port that quietly improved it would be a behaviour change
     * nobody asked for hiding inside a migration.
     */
    it('reproduces the severity order the product actually has, wrong as it is', async () => {
      const { fixture, adapter } = await signedIn();
      fixture.apiResponse = rows([
        { id: 'a', severity: 'critical' }, { id: 'b', severity: 'medium' },
        { id: 'c', severity: 'high' }, { id: 'd', severity: null },
      ]);
      const answer = await adapter.raw.entities.FacilityDocumentationRule.list('-severity', 200);
      // Nulls last in both directions: a row with no value has no place in an order.
      expect(answer.map(row => row.severity)).toEqual(['medium', 'high', 'critical', null]);
    });

    it('refuses an order, a field or a size it cannot answer for, before any request', async () => {
      const { fixture, adapter } = await signedIn();
      fixture.apiResponse = rows([]);
      const refused = [
        () => adapter.raw.entities.Announcement.list('-title', 200),
        () => adapter.raw.entities.Announcement.list('-created_date'),
        () => adapter.raw.entities.Announcement.list('-created_date', BROKER_MAXIMUM + 1),
        () => adapter.raw.entities.Announcement.filter({ title: 'x' }, '', 200),
        () => adapter.raw.entities.Announcement.filter({ is_active: { $gt: 1 } }, '', 200),
        () => adapter.raw.entities.RegulatoryUpdate.filter([], '', 200),
      ];
      for (const call of refused) await expect(call()).rejects.toThrow(ARGUMENTS_UNSUPPORTED);
      expect(fixture.apiCalls).toHaveLength(0);
    });

    it('leaves the family read-only: no write is declared and none is served', async () => {
      const { fixture, adapter } = await signedIn();
      for (const operation of ['create', 'update', 'delete']) {
        await expect(adapter.raw.entities.Announcement[operation]({}))
          .rejects.toMatchObject({ code: 'STAGING_OPERATION_UNAVAILABLE' });
      }
      expect(fixture.apiCalls).toHaveLength(0);
    });
  });

  it('does not make the namespace thenable', async () => {
    const { adapter } = await signedIn();
    expect(adapter.raw.entities.then).toBeUndefined();
    expect(adapter.raw.entities.User.then).toBeUndefined();
    await expect(Promise.resolve(adapter.raw.entities)).resolves.toBe(adapter.raw.entities);
  });
});
