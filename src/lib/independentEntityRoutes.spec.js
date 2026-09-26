import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createIndependentStagingAdapter, readIndependentStagingConfig } from './independentStagingAdapter';
import { ARGUMENTS_UNSUPPORTED, BROKER_MAXIMUM, COMPLIANCE_MAXIMUM, ENTITY_ROUTES, LIBRARY_MAXIMUM, PAGE_INCOMPLETE, ROSTER_MAXIMUM, SCREEN_CEILINGS } from './independentEntityRoutes';
import { ADR_CASE_READ_LIMIT } from '@/components/adr/adrCaseRead';
import { bindTrustedTenantContext, clearTrustedTenantContext, getActiveTrustedTenantContext } from '@/lib/roles';
import { stagingApiUrl, stagingEmails, stagingEnv, stagingFixture } from '@/test/independentStagingFixture';

const boundUser = Object.freeze({ id: 'user-1', email: stagingEmails[0] });
const boundContext = Object.freeze({
  user_id: 'user-1', user_email: stagingEmails[0], membership_id: 'membership-1',
  membership_key: 'agency-a:user-1', membership_version: 1, agency_id: 'agency-a',
  tenant_role: 'agency_admin', membership_status: 'active', is_platform_owner: false,
  agency: { id: 'agency-a', name: 'Synthetic Agency A', status: 'active' },
});

/**
 * A named library contract's answer: entries, plus the completeness the
 * contract measured. `complete` is the part that differs from every brokered
 * read — nothing here infers it from the page's length.
 */
const libraryAnswer = (entries, complete = true) => () => new Response(
  JSON.stringify({ success: true, result: { entries, complete }, execution: 'pennsync-api', base44ExecutionDependency: false }),
  { headers: { 'content-type': 'application/json' } });

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

  it('asks for one row more than the screen wanted, and proves the answer whole', async () => {
    const { fixture, adapter } = await signedIn();
    fixture.apiResponse = rosterAnswer([]);
    await adapter.raw.entities.User.list(undefined, 25);
    // 26, not 25: the extra row is what settles whether a 26th member exists.
    expect(fixture.apiCalls.at(-1).body.params).toEqual({ limit: 26 });

    // `ALL_ROWS` is the shape five real call sites use, and it is above the
    // contract's own ceiling. That is NOT a refusal: a screen passing it is
    // naming a bound it does not expect to reach, and a short answer proves it
    // did not. Refusing it outright was the first version of this route, and
    // it turned every roster call site into a refusal while the gate counted
    // all 36 as adopted.
    fixture.apiResponse = rosterAnswer([{ id: 'u-1', email: 'a@example.test' }]);
    await expect(adapter.raw.entities.User.list(undefined, 5000)).resolves.toHaveLength(1);
    expect(fixture.apiCalls.at(-1).body.params).toEqual({ limit: ROSTER_MAXIMUM });

    // A full page at the ceiling could have more behind it, so it refuses.
    fixture.apiResponse = rosterAnswer(
      Array.from({ length: ROSTER_MAXIMUM }, (unused, index) => ({ id: `u-${index}` })));
    await expect(adapter.raw.entities.User.list(undefined, 5000))
      .rejects.toMatchObject({ code: PAGE_INCOMPLETE, detail: 'User' });

    for (const limit of [0, -1, 1.5, '10']) {
      await expect(adapter.raw.entities.User.list(undefined, limit)).rejects.toThrow(ARGUMENTS_UNSUPPORTED);
    }
  });

  /**
   * The failure this whole module is shaped to prevent: answering an order the
   * contract cannot produce by quietly returning a different one.
   */
  it('refuses a sort it cannot produce rather than reordering the screen', async () => {
    const { fixture, adapter } = await signedIn();
    fixture.apiResponse = rosterAnswer([]);
    // `created_date` ASCENDING stays refused although the descending order is
    // now served: one direction is not the other, and answering the wrong one
    // would silently reorder a screen — the same reason every sort below is
    // refused rather than served in the default order. `constructor` and
    // `toString` are here because the accepted set is a lookup object, and a
    // prototype member reached through it would read as an accepted order.
    for (const sort of ['created_date', '-email', 'full_name', 'constructor', 'toString', 42]) {
      await expect(adapter.raw.entities.User.list(sort)).rejects.toThrow(ARGUMENTS_UNSUPPORTED);
    }
    // Nothing reached the service: a refused argument is refused before I/O.
    expect(fixture.apiCalls).toHaveLength(0);

    for (const sort of ['', 'email', '+email']) {
      await expect(adapter.raw.entities.User.list(sort)).resolves.toEqual([]);
    }

    // And `-created_date`, which 25 `User.list` CALL SITES pass (a different
    // population from the gate's refusal count — see the route's own header)
    // and this route used to
    // refuse, now reaches the contract as its own word for that order. Asserted
    // on the REQUEST BODY rather than on the call succeeding: a route that
    // accepted the sort and dropped it would answer alphabetically and pass a
    // test that only checked it resolved.
    fixture.apiCalls.length = 0;
    await expect(adapter.raw.entities.User.list('-created_date')).resolves.toEqual([]);
    expect(fixture.apiCalls).toHaveLength(1);
    expect(fixture.apiCalls[0].body.params).toMatchObject({ order: 'created_desc' });
    // The default is still no order at all, not an explicit alphabetical one:
    // the contract's own default decides, so there is one answer and not two.
    fixture.apiCalls.length = 0;
    await expect(adapter.raw.entities.User.list('email')).resolves.toEqual([]);
    expect(fixture.apiCalls[0].body.params).not.toHaveProperty('order');
  });

  /**
   * An argument the route has no parameter for is the same failure as an order
   * it cannot produce, arriving from a direction nothing was watching.
   * `routedEntities` calls `route.request(...args)`, and every route declares at
   * most three positional parameters, so a fourth — or a third on a
   * two-parameter route — is dropped in silence.
   *
   * `src/lib/agencyRoster.js` is the live caller: it pages with
   * `User.list('-created_date', ROSTER_PAGE_SIZE, page * ROSTER_PAGE_SIZE)` and
   * its own header explains that a truncated roster leaks records across
   * tenants. It is refused today only because of its sort, which is an accident
   * rather than a guard — ask for the second page in an order the route DOES
   * accept and the answer is the first page, which is what a screen paging
   * through a roster would then treat as the whole of it.
   */
  it('refuses an offset it has no parameter for rather than answering page one', async () => {
    const { fixture, adapter } = await signedIn();
    fixture.apiResponse = rosterAnswer(Array.from({ length: 25 }, (unused, index) => ({ id: `u-${index}` })));
    await expect(adapter.raw.entities.User.list(undefined, 25, 25))
      .rejects.toMatchObject({ code: ARGUMENTS_UNSUPPORTED, detail: 'argument_count' });
    // Refused before I/O, as every other unexpressible argument is.
    expect(fixture.apiCalls).toHaveLength(0);
    // And the same call without the offset is still served, so this refuses the
    // argument rather than the route.
    await expect(adapter.raw.entities.User.list(undefined, 25)).resolves.toHaveLength(25);
  });

  it('refuses an extra argument on a brokered read, whose parameters are a rest', async () => {
    // `brokeredRead` destructures `[query, sort, limit]` out of a rest
    // parameter, so `request.length` is 0 and its arity cannot be derived —
    // which is why a route like this declares one. A filtered read takes three
    // arguments and an unfiltered one takes two, and each refuses a further one.
    const { fixture, adapter } = await signedIn();
    fixture.apiResponse = () => new Response(JSON.stringify({ success: true, result: [],
      execution: 'pennsync-api', base44ExecutionDependency: false }),
    { headers: { 'content-type': 'application/json' } });
    await expect(adapter.raw.entities.Announcement.list('-created_date', 10, 10))
      .rejects.toMatchObject({ code: ARGUMENTS_UNSUPPORTED, detail: 'argument_count' });
    await expect(adapter.raw.entities.Announcement.filter({ is_active: true }, '-created_date', 10, 10))
      .rejects.toMatchObject({ code: ARGUMENTS_UNSUPPORTED, detail: 'argument_count' });
    expect(fixture.apiCalls).toHaveLength(0);
  });

  it('refuses an argument shape and a missing route with different codes', async () => {
    const { fixture, adapter } = await signedIn();
    // "Your query cannot be served" and "no route exists" are different
    // answers, and a screen's author has to be able to tell them apart.
    await expect(adapter.raw.entities.User.list('full_name'))
      .rejects.toMatchObject({ code: ARGUMENTS_UNSUPPORTED });
    await expect(adapter.raw.entities.User.create({}))
      .rejects.toMatchObject({ code: 'STAGING_OPERATION_UNAVAILABLE', operation: 'entities.User.create' });
    expect(fixture.apiCalls).toHaveLength(0);
  });

  it('leaves every undeclared entity call refusing exactly as before', async () => {
    const { fixture, adapter } = await signedIn();
    for (const [entity, operation] of [['TrainingCourse', 'list'], ['Patient', 'list'],
      ['Incident', 'create'], ['User', 'update'], ['User', 'subscribe']]) {
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
        () => adapter.raw.entities.Announcement.filter({ title: 'x' }, '', 200),
        () => adapter.raw.entities.Announcement.filter({ is_active: { $gt: 1 } }, '', 200),
        () => adapter.raw.entities.RegulatoryUpdate.filter([], '', 200),
      ];
      for (const call of refused) await expect(call()).rejects.toThrow(ARGUMENTS_UNSUPPORTED);
      expect(fixture.apiCalls).toHaveLength(0);

      // A limit ABOVE the family's ceiling is not among them: the screens pass
      // `ALL_ROWS` meaning "everything", and a short answer proves they got it.
      await expect(adapter.raw.entities.Announcement.list('-created_date', BROKER_MAXIMUM + 1))
        .resolves.toEqual([]);
      expect(fixture.apiCalls.at(-1).body.params.limit).toBe(BROKER_MAXIMUM);
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

  describe('the reads the named library contracts serve', () => {
    it('asks the contract for the whole set and hands back rows, not the envelope', async () => {
      const { fixture, adapter } = await signedIn();
      const entries = [{ id: 'p-1', pathway_name: 'CHF' }];
      fixture.apiResponse = libraryAnswer(entries);

      expect(await adapter.raw.entities.ClinicalPathway.list()).toEqual(entries);
      const [call] = fixture.apiCalls;
      expect(call.url).toBe(`${stagingApiUrl}/v1/functions/listClinicalPathways`);
      expect(call.body.agency_id).toBe('agency-a');
      // No probe row: the contract says whether the page is whole, so there is
      // nothing to infer from its length.
      expect(call.body.params).toEqual({ limit: LIBRARY_MAXIMUM });
    });

    it('refuses a page the contract did not call whole', async () => {
      const { fixture, adapter } = await signedIn();
      // The screen asked for everything and the contract answered
      // `complete: false`, so the rows on hand are not the answer to the
      // question asked and a route returning them would show a partial
      // library as though it were the whole one.
      fixture.apiResponse = libraryAnswer([{ id: 'p-1' }], false);
      await expect(adapter.raw.entities.ClinicalPathway.list())
        .rejects.toMatchObject({ code: PAGE_INCOMPLETE, detail: 'listClinicalPathways' });
      // A limit at or above the ceiling is the `ALL_ROWS` shape — still a
      // request for everything, so still a refusal.
      await expect(adapter.raw.entities.ClinicalPathway.list(undefined, 5000))
        .rejects.toMatchObject({ code: PAGE_INCOMPLETE, detail: 'listClinicalPathways' });
      // And an answer with no `complete` at all is refused rather than read as
      // whole, because the flag is the only thing that settles it.
      fixture.apiResponse = () => new Response(
        JSON.stringify({ success: true, result: { entries: [] }, execution: 'pennsync-api', base44ExecutionDependency: false }),
        { headers: { 'content-type': 'application/json' } });
      await expect(adapter.raw.entities.ClinicalPathway.list()).rejects.toBeTruthy();
    });

    it('serves a bounded page the contract ordered, and refuses one it cut twice', async () => {
      const { fixture, adapter } = await signedIn();
      // `AICarePlanSuggestionEngine` asks for the newest 50 published
      // materials, which is exactly the order the contract applies in SQL. An
      // agency with 51 gets 50 and `complete: false`, and that IS the answer
      // — Base44's own limit semantics. Refusing it broke the screen the
      // moment an agency's library outgrew the page.
      fixture.apiResponse = libraryAnswer(
        Array.from({ length: 50 }, (unused, index) => ({ id: `m-${index}`, is_published: true })),
        false);
      await expect(adapter.raw.entities.EducationMaterial
        .filter({ is_published: true }, '-last_used_date', 50)).resolves.toHaveLength(50);

      // But where the contract's filter is coarser than the query, the page
      // was cut in SQL BEFORE these rows were dropped here, so a short answer
      // is short for a reason the caller cannot see. Completeness is required
      // again, and a drop is what tells the two cases apart.
      fixture.apiResponse = libraryAnswer([
        { id: 'm-1', is_published: true }, { id: 'm-2', is_published: false }], false);
      await expect(adapter.raw.entities.EducationMaterial
        .filter({ is_published: false }, '-last_used_date', 50))
        .rejects.toMatchObject({ code: PAGE_INCOMPLETE });
      // The same rows with nothing dropped are served.
      fixture.apiResponse = libraryAnswer([
        { id: 'm-2', is_published: false }], false);
      await expect(adapter.raw.entities.EducationMaterial
        .filter({ is_published: false }, '-last_used_date', 50)).resolves.toHaveLength(1);
    });

    it('clamps a limit to the contract ceiling and refuses one it cannot mean', async () => {
      const { fixture, adapter } = await signedIn();
      fixture.apiResponse = libraryAnswer([]);
      await adapter.raw.entities.ClinicalPathway.list(undefined, 5000);
      expect(fixture.apiCalls.at(-1).body.params).toEqual({ limit: LIBRARY_MAXIMUM });
      await adapter.raw.entities.ClinicalPathway.list(undefined, 25);
      expect(fixture.apiCalls.at(-1).body.params).toEqual({ limit: 25 });
      for (const limit of [0, -1, 1.5, '10']) {
        await expect(adapter.raw.entities.ClinicalPathway.list(undefined, limit))
          .rejects.toThrow(ARGUMENTS_UNSUPPORTED);
      }
    });

    it('turns the flag a screen filters on into the contract argument that means it', async () => {
      const { fixture, adapter } = await signedIn();
      fixture.apiResponse = libraryAnswer([{ id: 'm-1', is_published: true }]);
      await adapter.raw.entities.EducationMaterial.filter({ is_published: true });
      expect(fixture.apiCalls.at(-1).body.params)
        .toEqual({ published_only: true, limit: LIBRARY_MAXIMUM });

      // `is_published: false` is a DIFFERENT question, and the contract's
      // `published_only` cannot ask it — so the narrowing is applied here
      // rather than lost. The drafts the contract returned to an administrator
      // are what a screen asking for them gets.
      fixture.apiResponse = libraryAnswer([
        { id: 'm-1', is_published: true }, { id: 'm-2', is_published: false }]);
      expect(await adapter.raw.entities.EducationMaterial.filter({ is_published: false }))
        .toEqual([{ id: 'm-2', is_published: false }]);
      expect(fixture.apiCalls.at(-1).body.params)
        .toEqual({ published_only: false, limit: LIBRARY_MAXIMUM });

      // The same shape on the pathway read, whose flag is `is_active`.
      fixture.apiResponse = libraryAnswer([]);
      await adapter.raw.entities.ClinicalPathway.filter({ is_active: true });
      expect(fixture.apiCalls.at(-1).body.params)
        .toEqual({ active_only: true, limit: LIBRARY_MAXIMUM });
      // A key outside the contract's parameters refuses rather than being
      // dropped, because a narrowing a screen asked for and did not get is
      // invisible on the screen.
      await expect(adapter.raw.entities.ClinicalPathway.filter({ condition: 'CHF' }))
        .rejects.toThrow(ARGUMENTS_UNSUPPORTED);
    });

    it('sends one entity to two scopes, because the two screens mean different rows', async () => {
      const { fixture, adapter } = await signedIn();
      fixture.apiResponse = libraryAnswer([]);
      // The admin manager's `list` is the agency's settings.
      await adapter.raw.entities.AIConfiguration.list();
      expect(fixture.apiCalls.at(-1).body.params)
        .toEqual({ scope: 'agency', limit: LIBRARY_MAXIMUM });
      // `UserSettings` sends an empty filter, which meant "my own row" all
      // along — the comment in that file saying the entity has no `user_email`
      // is wrong, and its own payload sends one.
      await adapter.raw.entities.AIConfiguration.filter({});
      expect(fixture.apiCalls.at(-1).body.params)
        .toEqual({ scope: 'mine', limit: LIBRARY_MAXIMUM });
    });

    it('offers only the orders its contract implements', async () => {
      const { fixture, adapter } = await signedIn();
      fixture.apiResponse = libraryAnswer([
        { id: 'f-2', order: 2 }, { id: 'f-1', order: 1 }]);
      expect((await adapter.raw.entities.ClinicalLibraryFolder.list('order'))
        .map(row => row.id)).toEqual(['f-1', 'f-2']);
      // A sort the contract does not implement refuses instead of being
      // approximated, and so does the same field the other way round.
      for (const sort of ['name', '-name']) {
        await expect(adapter.raw.entities.ClinicalLibraryFolder.list(sort))
          .rejects.toThrow(ARGUMENTS_UNSUPPORTED);
      }
    });

    it('declares no write, so none is served', async () => {
      const { fixture, adapter } = await signedIn();
      for (const operation of ['create', 'update', 'delete']) {
        await expect(adapter.raw.entities.ClinicalPathway[operation]({}))
          .rejects.toMatchObject({ code: 'STAGING_OPERATION_UNAVAILABLE' });
      }
      expect(fixture.apiCalls).toHaveLength(0);
    });
  });

  describe('the five compliance reads', () => {
    /** Their answer shape: `{entries, order, limit}` from a list contract. */
    const listed = (entries, order = 'created_date', limit = 200) => () => new Response(
      JSON.stringify({ success: true, result: { entries, order, limit },
        execution: 'pennsync-api', base44ExecutionDependency: false }),
      { headers: { 'content-type': 'application/json' } });

    it('sends the order as a COLUMN and the filter as the contract\'s own parameters', async () => {
      const { fixture, adapter } = await signedIn();
      fixture.apiResponse = listed([{ id: 'inc-1' }]);

      expect(await adapter.raw.entities.Incident.list('-created_date', 500))
        .toEqual([{ id: 'inc-1' }]);
      expect(fixture.apiCalls.at(-1).body.params).toEqual({ order: 'created_date', limit: 500 });

      await adapter.raw.entities.Incident.filter({ patient_id: 'p-1' }, '-incident_date', 100);
      expect(fixture.apiCalls.at(-1).body.params)
        .toEqual({ order: 'incident_date', limit: 100, patient_id: 'p-1' });

      // A control for the `-incident_date` refusal below: that case is named
      // "a column this capability does not order by", and without a sort this
      // route DOES take, the same refusal would fire for a route that orders by
      // nothing at all — which is a different defect wearing the same detail.
      await adapter.raw.entities.ComplianceAudit.list('-audit_date', 200);
      expect(fixture.apiCalls.at(-1).body.params).toEqual({ order: 'audit_date', limit: 200 });

      // And a control for each `filter_value` refusal below: the SAME two
      // fields, carrying a value, are served. Without these two the refusal
      // would pass for a route that rejected those fields outright, which is
      // the opposite defect.
      await adapter.raw.entities.ComplianceAudit.filter({ visit_id: 'v-1' }, '-audit_date', 200);
      expect(fixture.apiCalls.at(-1).body.params)
        .toEqual({ order: 'audit_date', limit: 200, visit_id: 'v-1' });

      await adapter.raw.entities.PersonnelCredential.filter({ status: 'pending_approval' },
        undefined, 1000);
      // No order asked for is no order sent: the contract defaults it, and a
      // route inventing one would be answering a question nobody asked.
      expect(fixture.apiCalls.at(-1).body.params)
        .toEqual({ limit: 1000, status: 'pending_approval' });
    });

    it('refuses an ascending sort, an unknown column and an operator it cannot express', async () => {
      const { fixture, adapter } = await signedIn();
      fixture.apiResponse = listed([]);
      // Each case names the `detail` it expects, not just the code. Every one of
      // this module's refusals throws the same `ARGUMENTS_UNSUPPORTED` as both
      // message and code, across eleven distinct details, so asserting the
      // message alone would pass on any refusal at all — including one raised
      // for a reason that has nothing to do with the case being tested.
      const refused = [
        // The contracts order descending only. Quietly reversing a screen is
        // the silent-reorder bug from the other direction.
        [() => adapter.raw.entities.Incident.list('created_date', 200), 'sort_direction'],
        [() => adapter.raw.entities.Incident.list('-severity', 200), 'sort'],
        [() => adapter.raw.entities.ComplianceAudit.list('-incident_date', 200), 'sort'],
        [() => adapter.raw.entities.Incident.list('-created_date'), 'limit_required'],
        [() => adapter.raw.entities.Incident.filter({ severity: 'high' }, '', 200), 'filter_field'],
        [() => adapter.raw.entities.PolicyAcknowledgment.filter(
          { user_id: { $in: ['a'] } }, '', 200), 'filter_operator'],
        // The widening case, and the only refusal here that is about the ANSWER
        // rather than the request's shape. `JSON.stringify` drops an
        // `undefined` value, and every contract reads a null parameter as "no
        // filter", so a field named with nothing in it would reach the store as
        // an unfiltered read and answer with the whole agency under a heading
        // naming one patient. Both spellings, because they arrive by different
        // routes: `undefined` from an unset prop, `null` from a cleared one.
        [() => adapter.raw.entities.Incident.filter(
          { patient_id: undefined }, '-created_date', 200), 'filter_value'],
        [() => adapter.raw.entities.ComplianceAudit.filter(
          { visit_id: null }, '-created_date', 200), 'filter_value'],
      ];
      for (const [call, detail] of refused) {
        await expect(call()).rejects.toMatchObject({ code: ARGUMENTS_UNSUPPORTED, detail });
      }
      expect(fixture.apiCalls).toHaveLength(0);
    });

    it('a limit above the ceiling is served only when the answer proves it complete', async () => {
      const { fixture, adapter } = await signedIn();
      const ceiling = COMPLIANCE_MAXIMUM.listComplianceAudits;
      // `OASISComplianceReport.jsx` asks for 10,000 audits. The contract will
      // return at most the ceiling, so a FULL page cannot be told from the
      // whole set and the route refuses rather than rendering a truncation as
      // the agency's history.
      fixture.apiResponse = listed(Array.from({ length: ceiling }, (unused, n) => ({ id: n })));
      await expect(adapter.raw.entities.ComplianceAudit.list('-created_date', 10000))
        .rejects.toThrow(PAGE_INCOMPLETE);
      expect(fixture.apiCalls.at(-1).body.params.limit).toBe(ceiling);

      // A short answer proves there is no more, so the same call is served.
      fixture.apiResponse = listed([{ id: 'aud-1' }]);
      await expect(adapter.raw.entities.ComplianceAudit.list('-created_date', 10000))
        .resolves.toEqual([{ id: 'aud-1' }]);

      // And a limit AT or under the ceiling is an ordinary page: the contract
      // ordered the whole table, so its first N really are the first N.
      fixture.apiResponse = listed(Array.from({ length: 200 }, (unused, n) => ({ id: n })));
      await expect(adapter.raw.entities.Incident.list('-created_date', 200))
        .resolves.toHaveLength(200);
    });

    it('ADR_CASE_READ_LIMIT sits inside the contract it will be routed to', async () => {
      // `check:entity-routes` cannot follow this import, so `AdrAuditCase.list`
      // is not declared yet. The value is read here instead of by eye, so if
      // somebody raises it past what `listAdrAuditCases` serves this fails
      // rather than the screen silently rendering a truncated case list.
      expect(ADR_CASE_READ_LIMIT).toBeLessThanOrEqual(COMPLIANCE_MAXIMUM.listAdrAuditCases);
    });
  });

  it('does not make the namespace thenable', async () => {
    const { adapter } = await signedIn();
    expect(adapter.raw.entities.then).toBeUndefined();
    expect(adapter.raw.entities.User.then).toBeUndefined();
    await expect(Promise.resolve(adapter.raw.entities)).resolves.toBe(adapter.raw.entities);
  });
});

describe("batch E's screen contracts", () => {
  const ported = { ...stagingEnv, VITE_PENNSYNC_API_URL: stagingApiUrl };
  const signedIn = async () => {
    const fixture = stagingFixture();
    const adapter = createIndependentStagingAdapter(readIndependentStagingConfig(ported),
      { fetchImpl: fixture.fetch, boundTenant: getActiveTrustedTenantContext });
    await adapter.auth.signIn(stagingEmails[0], 'Synthetic-accepted-password');
    return { fixture, adapter };
  };
  const entries = (rows) => () => new Response(
    JSON.stringify({ success: true, result: { success: true, entries: rows }, execution: 'pennsync-api', base44ExecutionDependency: false }),
    { headers: { 'content-type': 'application/json' } });

  beforeEach(() => bindTrustedTenantContext(boundUser, boundContext));
  afterEach(() => clearTrustedTenantContext());

  it('sends each screen its own contract, with the arguments the contract takes', async () => {
    const { fixture, adapter } = await signedIn();
    fixture.apiResponse = entries([{ id: 'event-1' }]);
    await adapter.raw.entities.ClinicalEvent.filter({ patient_id: 'p1' }, '-event_date', 200);
    expect(fixture.apiCalls.at(-1).url).toBe(`${stagingApiUrl}/v1/functions/listChartClinicalEvents`);
    expect(fixture.apiCalls.at(-1).body.params).toEqual({ patient_id: 'p1', limit: 200 });

    await adapter.raw.entities.OCRFeedback.filter({ applied_to_training: false }, undefined, 5000);
    expect(fixture.apiCalls.at(-1).url).toBe(`${stagingApiUrl}/v1/functions/listOcrCorrections`);
    expect(fixture.apiCalls.at(-1).body.params).toEqual({ applied_to_training: false, limit: 500 });

    await adapter.raw.entities.ComplianceRule.filter({ rule_code: 'CMS-TF-1' }, '-created_date', 2);
    expect(fixture.apiCalls.at(-1).body.params).toEqual({ rule_code: 'CMS-TF-1', limit: 2 });
  });

  it('refuses an order it cannot produce rather than quietly swapping one in', async () => {
    const { fixture, adapter } = await signedIn();
    fixture.apiResponse = entries([]);
    const refused = [
      () => adapter.raw.entities.ClinicalEvent.filter({ patient_id: 'p1' }, '-created_date', 10),
      () => adapter.raw.entities.SentEducationMaterial.list('-created_date', 50),
      () => adapter.raw.entities.OCRTrainingSession.list('created_date', 50),
      () => adapter.raw.entities.ClinicalEvent.filter({ event_type: 'fall' }, '-event_date', 10),
      () => adapter.raw.entities.NotificationPreference.filter({ created_by: 'x' }),
    ];
    for (const call of refused) await expect(call()).rejects.toThrow(ARGUMENTS_UNSUPPORTED);
    expect(fixture.apiCalls).toHaveLength(0);
  });

  it('will not render a truncated page as the whole set', async () => {
    const { fixture, adapter } = await signedIn();
    // 500 rows back from a contract whose ceiling is 500, for a screen that
    // asked for 5,000: there may be more, and the monitor counts them.
    fixture.apiResponse = entries(Array.from({ length: 500 }, (_, index) => ({ id: `ocr-${index}` })));
    await expect(adapter.raw.entities.OCRFeedback.filter({ applied_to_training: false }, undefined, 5000))
      .rejects.toThrow(PAGE_INCOMPLETE);
    // One row short is the proof that there are no more.
    fixture.apiResponse = entries(Array.from({ length: 499 }, (_, index) => ({ id: `ocr-${index}` })));
    await expect(adapter.raw.entities.OCRFeedback.filter({ applied_to_training: false }, undefined, 5000))
      .resolves.toHaveLength(499);
  });

  it('drops only what the contract derives, and forwards everything the caller owns', async () => {
    const { fixture, adapter } = await signedIn();
    fixture.apiResponse = () => new Response(
      JSON.stringify({ success: true, result: { success: true, id: 'sent-9' }, execution: 'pennsync-api', base44ExecutionDependency: false }),
      { headers: { 'content-type': 'application/json' } });
    await adapter.raw.entities.SentEducationMaterial.create({
      material_id: 'm1', material_title: 'Falls', patient_id: 'p1', patient_name: 'Ada Lovelace',
      sent_by: 'somebody@example.invalid', sent_date: '2020-01-01', delivery_method: 'printed',
      personalized_content: 'body', notes: 'n',
    });
    // The subject's name, the sender and the clock come from the store, so the
    // screen's copies are not forwarded and cannot disagree with it.
    expect(fixture.apiCalls.at(-1).body.params).toEqual({
      patient_id: 'p1',
      material: {
        material_id: 'm1', material_title: 'Falls', delivery_method: 'printed',
        personalized_content: 'body', notes: 'n',
      },
    });
  });

  it('answers the preference screen the shape it reads, and forwards the address', async () => {
    const { fixture, adapter } = await signedIn();
    fixture.apiResponse = () => new Response(
      JSON.stringify({ success: true, result: { success: true, found: false, preference: null }, execution: 'pennsync-api', base44ExecutionDependency: false }),
      { headers: { 'content-type': 'application/json' } });
    // The screen reads `prefs[0]` and falls back to its defaults, so "no row"
    // has to be an empty ARRAY rather than a null.
    await expect(adapter.raw.entities.NotificationPreference.filter({ user_email: stagingEmails[0] }))
      .resolves.toEqual([]);
    // Forwarded, never dropped: the contract refuses an address that is not
    // the caller's, and it cannot do that if the route does not send it.
    expect(fixture.apiCalls.at(-1).body.params).toEqual({ user_email: stagingEmails[0] });
  });
});

/**
 * The two things above that a HAND reading resolved, made into checks.
 *
 * Both are the same shape: an answer that was right when it was written, in a
 * place nothing would notice it going stale.
 */
describe("what batch E's routes take on trust", () => {
  it('takes every page ceiling from the contract that enforces it', async () => {
    const { readFileSync } = await import('node:fs');
    const { RECORD_CONTRACTS } = await import('../../services/pennsync-api/record-contracts.mjs');
    const sql = readFileSync(
      'services/authority-store/supabase/record-migrations/20260920580000_contract_screen_records.sql',
      'utf8');
    for (const [handler, ceiling] of Object.entries(SCREEN_CEILINGS)) {
      const rpc = RECORD_CONTRACTS[handler].rpc.replace(/^pennsync_/, '');
      // The contract's body, from its own `create function` to the next one.
      const start = sql.indexOf(`create function "pennsync_records".${rpc}(`);
      expect(start, `${rpc} is not in the migration`).toBeGreaterThan(-1);
      const next = sql.indexOf('create function', start + 20);
      const body = sql.slice(start, next === -1 ? sql.length : next);
      const enforced = [...body.matchAll(/screen_limit\(p_limit,\s*(\d+)\)/g)].map(m => Number(m[1]));
      expect(enforced, `${rpc} passes no ceiling to screen_limit`).toHaveLength(1);
      expect(enforced[0], `${handler}'s route and its contract disagree`).toBe(ceiling);
    }
  });

  it('leaves each unproved write to the refusals its own contract raises', async () => {
    const { readFileSync } = await import('node:fs');
    const { cwd } = await import('node:process');
    const { measureRoutes } = await import('../../tools-entity-routes.mjs');
    const { HANDLER_NAMES } = await import('../../services/pennsync-api/handlers.mjs');

    // Declared, and reported UNPROVED rather than adopted: every call site
    // passes a whole variable, so the gate cannot run the real arguments
    // through `request`. "Cannot prove this serves" is not "does not serve".
    const report = measureRoutes(cwd());
    expect([...report.unproved_routes].sort()).toEqual([
      'AgencySettings.create', 'AgencySettings.update',
      'FaceToFaceEncounter.create', 'FaceToFaceEncounter.update',
      'NoteConversion.create',
      'NotificationPreference.create', 'NotificationPreference.update',
      'PatientRecommendation.create',
    ]);
    for (const key of report.unproved_routes) {
      expect(ENTITY_ROUTES[key], `${key} must be declared`).toBeDefined();
      expect(HANDLER_NAMES).toContain(ENTITY_ROUTES[key].function);
    }

    // And this is what stands in for the proof. Each refusal those three rely
    // on has to be RAISED by the contract suite against the real migration,
    // not merely named in the migration's own prose — so the suite is read,
    // and the migration is not.
    const suite = readFileSync('services/authority-store/tests/contract-screen-records.test.mjs', 'utf8');
    for (const code of ['PENNSYNC_SCREEN_FIELD_NOT_WRITABLE', 'PENNSYNC_SCREEN_PATIENT_NOT_VISIBLE',
      'PENNSYNC_SCREEN_NOT_YOUR_ROWS', 'PENNSYNC_SCREEN_PREFERENCE_NOT_OWNED',
      // A required field the store's own columns do not enforce: nullable
      // everywhere, so nothing but this refusal stands between an incomplete
      // write and a junk row that answered `success: true`.
      'PENNSYNC_SCREEN_FIELD_REQUIRED', 'PENNSYNC_SCREEN_FIELD_VALUE_INVALID']) {
      expect(suite, `${code} must be exercised by the contract suite`).toContain(code);
    }

    // Batch D's five, the same standing on their own suite. A second family of
    // unproved writes arriving is the case this test has to keep covering: the
    // list above fails when one appears, and this is what it costs to add it —
    // name the suite that raises the refusals the new routes lean on.
    const operational = readFileSync(
      'services/authority-store/tests/contract-operational-tables.test.mjs', 'utf8');
    for (const code of ['PENNSYNC_SETTINGS_FORBIDDEN', 'PENNSYNC_SETTINGS_FIELD_RESERVED',
      'PENNSYNC_F2F_FORBIDDEN', 'PENNSYNC_F2F_CHART_FORBIDDEN',
      'PENNSYNC_NOTE_CONVERSION_CHART_FORBIDDEN', 'PENNSYNC_TEMPLATE_NAME_REQUIRED']) {
      expect(operational, `${code} must be exercised by the contract suite`).toContain(code);
    }
  });

  it('closes the preference round trip the settings screen actually makes', async () => {
    // The screen spreads the row it is holding and changes one field
    // (`{ ...preferences, digest_mode: value }`), so what the save receives is
    // whatever the READ projected. That makes the two routes one path, and a
    // path is not proved by either end alone: widen the read's projection by a
    // column the write does not allow and the screen starts answering
    // `PENNSYNC_SCREEN_FIELD_NOT_WRITABLE` on every save, with both contracts'
    // own suites green. This is the seam, driven rather than described.
    const row = ENTITY_ROUTES['NotificationPreference.filter'].response({
      success: true,
      found: true,
      preference: {
        id: 'pref-1',
        user_email: 'clinician-a@example.invalid',
        email_notifications_enabled: true,
        in_app_notifications_enabled: true,
        push_notifications_enabled: false,
        preferences: { info: { email: false, in_app: true, push: false } },
        quiet_hours: { enabled: false, start_time: '22:00', end_time: '08:00' },
        digest_mode: 'instant',
        sound_enabled: true,
      },
    })[0];
    const edited = { ...row, digest_mode: 'daily' };
    const sent = ENTITY_ROUTES['NotificationPreference.update'].request(row.id, edited);
    expect(sent.expected_id).toBe('pref-1');
    // Exactly the seven the contract's `screen_exact_keys` allows: an eighth
    // is a refusal and a missing one is a field the screen cannot change.
    expect(Object.keys(sent.preference).sort()).toEqual([
      'digest_mode', 'email_notifications_enabled', 'in_app_notifications_enabled',
      'preferences', 'push_notifications_enabled', 'quiet_hours', 'sound_enabled',
    ]);
    expect(sent.preference.digest_mode).toBe('daily');
    // The create branch is the screen's OTHER shape: no row yet, so it spreads
    // its own literal default object, which carries the address and no id.
    const fresh = ENTITY_ROUTES['NotificationPreference.create'].request({
      user_email: 'clinician-a@example.invalid',
      email_notifications_enabled: true,
      in_app_notifications_enabled: true,
      push_notifications_enabled: false,
      preferences: {},
      quiet_hours: { enabled: false },
      digest_mode: 'instant',
      sound_enabled: true,
    });
    expect(fresh.expected_id).toBeNull();
    expect(Object.keys(fresh.preference)).not.toContain('user_email');
  });
  /**
   * The arity guard only refuses arguments PAST the declared count, so a
   * declaration that is too GENEROUS fails open on exactly the case the guard
   * exists to catch: a fourth argument at a three-argument route is discarded
   * in silence and the module still loads clean. A clean load therefore proves
   * nothing about the number, and every arity in this file is DECLARED rather
   * than derived — `guardingArity` reads `request.length`, and all but one of
   * these routes take a rest parameter, whose length is 0.
   *
   * So the number is pinned from OUTSIDE the route: `Entity.list(sort, limit)`
   * and `Entity.filter(query, sort, limit)` are the entity methods' own
   * signatures, which `src/lib/queryLimits.js` and `src/lib/entityReadLimits`
   * both act on. A route that accepts a third argument on a `.list` or a
   * fourth on a `.filter` is accepting an argument no caller can express and
   * no parameter can receive.
   *
   * The count check runs in the wrapper, before the route's own body, so this
   * reaches every route regardless of whether its other arguments are valid —
   * which is why `detail` is asserted rather than the message. Every refusal
   * in this module carries the same message, so a route refusing the extra
   * argument for a reason of its own (a sort it cannot honour, a filter field
   * it does not take) would pass a message-only assertion vacuously.
   */
  it('accepts no more arguments than the entity method it serves has', () => {
    const paged = Object.keys(ENTITY_ROUTES)
      .filter(key => key.endsWith('.list') || key.endsWith('.filter'));
    // Not an allowlist: every route keyed for a read is covered, and a new one
    // joins this set by existing — which is why the number GREW rather than
    // being relaxed when batch D's nine paged operational reads arrived, and
    // again here: 38 became 45 with the five compliance reads' seven.
    expect(paged.length).toBe(45);

    for (const key of paged) {
      const signature = key.endsWith('.filter') ? 3 : 2;
      let thrown;
      try {
        ENTITY_ROUTES[key].request(...Array.from({ length: signature + 1 }));
      } catch (error) { thrown = error; }
      expect(thrown, `${key} accepted ${signature + 1} arguments`).toBeDefined();
      expect(thrown.code).toBe(ARGUMENTS_UNSUPPORTED);
      expect(thrown.detail, `${key} refused for its own reason, not the count`)
        .toBe('argument_count');
    }
  });
});
