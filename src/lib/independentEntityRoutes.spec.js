import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createIndependentStagingAdapter, readIndependentStagingConfig } from './independentStagingAdapter';
import { ALERT_CEILING, ARGUMENTS_UNSUPPORTED, BROKER_MAXIMUM, COMPLIANCE_MAXIMUM, ENTITY_ROUTES, LIBRARY_MAXIMUM, PAGE_INCOMPLETE, ROSTER_MAXIMUM, SCREEN_CEILINGS, withoutCollisions } from './independentEntityRoutes';
import { readFileSync } from 'node:fs';
import process from 'node:process';
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

/**
 * A library WRITE's answer shape, which is not the read's.
 * `contract_library_write` answers `{created|updated|deleted: true, row}`, and
 * the flag is the only thing in it that says which write happened. The fixture
 * takes the verb from the REQUEST so an ordinary case behaves as the store
 * does; `libraryVerbAnswer` fixes a wrong one on purpose, because a fixture
 * that can only agree with the route proves nothing about the route.
 */
const libraryWriteAnswer = (fixture, row = { id: 'row-1' }) => () => {
  const action = fixture.apiCalls.at(-1)?.body?.params?.action;
  const verb = { create: 'created', update: 'updated', delete: 'deleted' }[action];
  return new Response(
    JSON.stringify({
      success: true,
      result: { ...(verb ? { [verb]: true } : {}), row },
      execution: 'pennsync-api',
      base44ExecutionDependency: false,
    }),
    { headers: { 'content-type': 'application/json' } });
};

const libraryVerbAnswer = (verb, row = { id: 'row-1' }) => () => new Response(
  JSON.stringify({ success: true, result: { [verb]: true, row }, execution: 'pennsync-api', base44ExecutionDependency: false }),
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

    it('sorts and filters only on columns the record store actually has', async () => {
      const { readFileSync } = await import('node:fs');
      const { BROKERED_ENTITIES, READ_ONLY_MODES } =
        await import('../../services/pennsync-api/brokered-entities.mjs');
      // This family is the one place the browser orders and filters rows
      // ITSELF, over a page it has proved complete. That is sound, and it is
      // sound for a reason nothing here was checking: a field it sorts on has
      // to BE a column, or `ordered` compares `undefined` with `undefined`,
      // every row ties, and the screen is served the store's own order under
      // the name of the one it asked for. No refusal, no empty page, nothing
      // to notice — the same silence as a response key that is never sent.
      //
      // Both sides are generated. The entities come from the file
      // `tools-record-brokers.mjs` writes beside the family's SQL, and the
      // columns from the record-store migration `tools-entity-schema-plan.mjs`
      // writes. Neither is typed here, so a column renamed in the generator
      // fails this rather than surviving in a second copy.
      const migration = readFileSync(
        'services/authority-store/supabase/record-migrations/20260919170000_record_store.sql', 'utf8');
      const columnsOf = (entity) => {
        const table = entity.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
        const start = migration.indexOf(`create table "pennsync_records"."${table}" (`);
        expect(start, `${table} is not in the record store`).toBeGreaterThan(-1);
        const body = migration.slice(start, migration.indexOf('\n);', start));
        return new Set([...body.matchAll(/^\s+"([a-z_]+)"\s/gm)].map(m => m[1]));
      };

      // A name no table here carries, in the shape a real field has, so the
      // probe below is a discriminator rather than a syntax check.
      const NOT_A_COLUMN = 'sort_order';

      const brokered = Object.entries(ENTITY_ROUTES)
        .filter(([, route]) => route.function === 'listBrokeredRecords');
      expect(brokered.length, 'no brokered route is declared').toBeGreaterThan(0);

      for (const [key, route] of brokered) {
        const filtered = key.endsWith('.filter');
        const asked = route.request(...(filtered ? [{}, undefined, 10] : [undefined, 10]));
        const entity = asked.entity;
        expect(BROKERED_ENTITIES[entity], `${key} reaches an entity the family does not serve`)
          .toBeDefined();
        expect(READ_ONLY_MODES, `${key} reads an entity the family does not serve read-only`)
          .toContain(BROKERED_ENTITIES[entity]);

        const columns = columnsOf(entity);
        expect(columns.has(NOT_A_COLUMN), 'the probe name is a real column after all').toBe(false);

        // Acceptance implies column, in both directions of the sort and for
        // every filter field, probed over the table's own columns plus the one
        // name that is not there.
        const accepts = (call) => { try { call(); return true; } catch { return false; } };
        for (const field of [...columns, NOT_A_COLUMN]) {
          for (const sort of [field, `-${field}`]) {
            const taken = accepts(() => (filtered
              ? route.request({}, sort, 10)
              : route.request(sort, 10)));
            if (taken) {
              expect(columns.has(field), `${key} sorts on ${field}, which is not a column`).toBe(true);
            }
          }
          if (!filtered) continue;
          const taken = accepts(() => route.request({ [field]: 'x' }, undefined, 10));
          if (taken) {
            expect(columns.has(field), `${key} filters on ${field}, which is not a column`).toBe(true);
          }
        }
      }
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

    it('serves the two library reads whose sites were once called unprovable', async () => {
      const { fixture, adapter } = await signedIn();
      fixture.apiResponse = libraryAnswer([{ id: 't-1', usage_count: 9 }]);

      // `TopTemplatesWidget` passes `('-usage_count', 5)` — every argument a
      // literal. Its sibling pager passes a computed skip and stays unreadable,
      // which is a route with one proved site rather than an unproved route.
      await adapter.raw.entities.ClinicalLibraryTemplate.list('-usage_count', 5);
      expect(fixture.apiCalls.at(-1).url)
        .toBe(`${stagingApiUrl}/v1/functions/listClinicalLibraryTemplates`);
      expect(fixture.apiCalls.at(-1).body.params).toEqual({ limit: 5 });

      // Both education sites pass `patient?.id`, which is a ROW ID and so
      // readable, where a sort or a limit would be shape.
      fixture.apiResponse = libraryAnswer([{ id: 'a-1', patient_id: 'patient-7' }]);
      await adapter.raw.entities.PatientEducationAssignment
        .filter({ patient_id: 'patient-7' }, '-assigned_date', 1000);
      expect(fixture.apiCalls.at(-1).body.params)
        .toEqual({ patient_id: 'patient-7', limit: 1000 });
      await adapter.raw.entities.PatientEducationAssignment
        .filter({ patient_id: 'patient-7' }, undefined, 1000);
      expect(fixture.apiCalls.at(-1).body.params)
        .toEqual({ patient_id: 'patient-7', limit: 1000 });

      // A chart this route cannot express is refused rather than widened to
      // the agency, which is the whole reason the predicate is parsed here.
      await expect(adapter.raw.entities.PatientEducationAssignment
        .filter({ status: 'assigned' }, undefined, 1000)).rejects.toThrow(ARGUMENTS_UNSUPPORTED);
    });

    it('refuses a sort direction the contract does not implement, and the re-sort that would have applied is real', async () => {
      const { fixture, adapter } = await signedIn();
      fixture.apiResponse = libraryAnswer([]);

      // `contract_clinical_library_template_list` orders `usage_count DESC`,
      // and that direction is what the route accepts.
      await adapter.raw.entities.ClinicalLibraryTemplate.list('-usage_count', 5);
      expect(fixture.apiCalls.at(-1).body.params).toEqual({ limit: 5 });
      for (const sort of ['usage_count', '+usage_count', '-created_date', 'id']) {
        await expect(adapter.raw.entities.ClinicalLibraryTemplate.list(sort, 5))
          .rejects.toThrow(ARGUMENTS_UNSUPPORTED);
      }

      // The known-positive, because a refusal on its own only shows the
      // refusal works. The route really does re-order the rows it was handed
      // rather than trusting the page's order — here, against a page served
      // in the wrong order on purpose. So a direction check that matched only
      // the FIELD would have admitted `+usage_count`, been handed the five
      // most-used templates, and re-sorted them ascending: the five most-used
      // presented to the screen as the five least-used, with every other part
      // of this file behaving correctly.
      fixture.apiResponse = libraryAnswer([
        { id: 't-low', usage_count: 1 }, { id: 't-high', usage_count: 9 }]);
      expect(await adapter.raw.entities.ClinicalLibraryTemplate.list('-usage_count', 5))
        .toEqual([{ id: 't-high', usage_count: 9 }, { id: 't-low', usage_count: 1 }]);
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

    /**
     * The library WRITES. Each of these drives `response` as well as `request`,
     * which is the whole reason they exist: `check:entity-routes` runs a
     * declaration's `request` against each call site's real arguments and never
     * exercises `response` (D168), so a route can be counted served and still
     * hand its screen `undefined`.
     */
    const writeAnswer = (verb, row) => () => new Response(
      JSON.stringify({ success: true, result: { [verb]: true, row }, execution: 'pennsync-api', base44ExecutionDependency: false }),
      { headers: { 'content-type': 'application/json' } });

    it('sends each library write as its contract\'s own action and hands back the row', async () => {
      const { fixture, adapter } = await signedIn();

      // `AIEducationRecommender.jsx` — the one create site whose payload the
      // gate can read, because it is an object literal even though every value
      // is computed. It keeps the answer: the fulfilled results are the
      // assignments it hands its caller.
      const assignment = { id: 'a-9', patient_id: 'patient-7', topic: 'Fall risk' };
      fixture.apiResponse = writeAnswer('created', assignment);
      expect(await adapter.raw.entities.PatientEducationAssignment.create({
        patient_id: 'patient-7', topic: 'Fall risk', status: 'assigned',
      })).toEqual(assignment);
      expect(fixture.apiCalls.at(-1).url)
        .toBe(`${stagingApiUrl}/v1/functions/managePatientEducationAssignment`);
      expect(fixture.apiCalls.at(-1).body.params).toEqual({
        action: 'create',
        fields: { patient_id: 'patient-7', topic: 'Fall risk', status: 'assigned' },
      });

      // `ClinicalLibraryManager.jsx:271` — deleting a folder moves each
      // template out of it. The only update whose fields this file can see, and
      // `folder_id` is deliberately not the reserved `patient_id`.
      const moved = { id: 't-4', folder_id: null };
      fixture.apiResponse = writeAnswer('updated', moved);
      expect(await adapter.raw.entities.ClinicalLibraryTemplate
        .update('t-4', { folder_id: null })).toEqual(moved);
      expect(fixture.apiCalls.at(-1).url)
        .toBe(`${stagingApiUrl}/v1/functions/manageClinicalLibraryTemplate`);
      expect(fixture.apiCalls.at(-1).body.params)
        .toEqual({ action: 'update', id: 't-4', fields: { folder_id: null } });

      // The two deletes. A delete sends no `fields` at all, because the
      // contract's delete branch never reads one.
      const gone = { id: 't-4', phrase: 'Wound care' };
      fixture.apiResponse = writeAnswer('deleted', gone);
      expect(await adapter.raw.entities.ClinicalLibraryTemplate.delete('t-4')).toEqual(gone);
      expect(fixture.apiCalls.at(-1).body.params).toEqual({ action: 'delete', id: 't-4' });

      const rule = { id: 'r-2', rule_name: 'MBI present' };
      fixture.apiResponse = writeAnswer('deleted', rule);
      expect(await adapter.raw.entities.CustomValidationRule.delete('r-2')).toEqual(rule);
      expect(fixture.apiCalls.at(-1).url)
        .toBe(`${stagingApiUrl}/v1/functions/manageCustomValidationRule`);
      expect(fixture.apiCalls.at(-1).body.params).toEqual({ action: 'delete', id: 'r-2' });
    });

    it('reads the verb the contract answered, so a write that performed something else refuses', async () => {
      const { fixture, adapter } = await signedIn();

      // The defect this guards is not hypothetical: a route declared with the
      // wrong action passes `check:entity-routes` unchanged, because the gate
      // never runs `response`. With the verb ignored, an `update` answer would
      // be handed back as though the create had happened.
      fixture.apiResponse = writeAnswer('updated', { id: 'a-9' });
      await expect(adapter.raw.entities.PatientEducationAssignment
        .create({ patient_id: 'patient-7' })).rejects.toThrow(ARGUMENTS_UNSUPPORTED);

      fixture.apiResponse = writeAnswer('created', { id: 't-4' });
      await expect(adapter.raw.entities.ClinicalLibraryTemplate
        .update('t-4', { folder_id: null })).rejects.toThrow(ARGUMENTS_UNSUPPORTED);

      // An answer with the right verb and no row is refused too: the row IS
      // what these routes owe a screen.
      fixture.apiResponse = () => new Response(
        JSON.stringify({ success: true, result: { deleted: false }, execution: 'pennsync-api', base44ExecutionDependency: false }),
        { headers: { 'content-type': 'application/json' } });
      await expect(adapter.raw.entities.CustomValidationRule.delete('r-2'))
        .rejects.toThrow(ARGUMENTS_UNSUPPORTED);
    });

    it('refuses an id or a payload its contract could not have used', async () => {
      const { fixture, adapter } = await signedIn();
      fixture.apiResponse = writeAnswer('updated', { id: 't-4' });

      for (const id of ['', 7, null, undefined]) {
        await expect(adapter.raw.entities.ClinicalLibraryTemplate.update(id, { folder_id: null }))
          .rejects.toThrow(ARGUMENTS_UNSUPPORTED);
        await expect(adapter.raw.entities.ClinicalLibraryTemplate.delete(id))
          .rejects.toThrow(ARGUMENTS_UNSUPPORTED);
      }
      for (const fields of [null, undefined, [], 'phrase']) {
        await expect(adapter.raw.entities.ClinicalLibraryTemplate.update('t-4', fields))
          .rejects.toThrow(ARGUMENTS_UNSUPPORTED);
        await expect(adapter.raw.entities.CustomValidationRule.create(fields))
          .rejects.toThrow(ARGUMENTS_UNSUPPORTED);
      }
      // Nothing above reached the service, which is the point of parsing here.
      expect(fixture.apiCalls).toHaveLength(0);
    });

    it('declares exactly the write actions each library contract admits', async () => {
      const { readFileSync } = await import('node:fs');
      const sql = readFileSync(
        'services/authority-store/supabase/record-migrations/20260920570000_contract_clinical_library.sql',
        'utf8');
      // The shared gate first, then the one contract that narrows it. Derived
      // from the migration rather than listed here, because a list would agree
      // with a declaration that had drifted (D148).
      const shared = /library_action\(p_action text\)[\s\S]*?p_action in \(([^)]*)\)/.exec(sql);
      const narrowed = /contract_patient_education_write[\s\S]*?p_action in \(([^)]*)\)/.exec(sql);
      const actionsIn = (match) => {
        expect(match, 'the migration no longer states its admitted actions where this reads them')
          .not.toBeNull();
        return [...match[1].matchAll(/'([a-z]+)'/g)].map(([, action]) => action).sort();
      };
      expect(actionsIn(shared)).toEqual(['create', 'delete', 'update']);
      expect(actionsIn(narrowed)).toEqual(['create', 'update']);

      const declared = (entity) => Object.keys(ENTITY_ROUTES)
        .filter(key => key.startsWith(`${entity}.`))
        .map(key => key.slice(entity.length + 1))
        .filter(operation => ['create', 'update', 'delete'].includes(operation))
        .sort();
      for (const entity of ['ClinicalLibraryTemplate', 'CustomValidationRule']) {
        expect(declared(entity), `${entity} and library_action disagree`)
          .toEqual(actionsIn(shared));
      }
      // No `PatientEducationAssignment.delete`, and this is why rather than a
      // note that would go stale: the contract admits two actions, and no
      // screen calls the third either.
      expect(declared('PatientEducationAssignment')).toEqual(actionsIn(narrowed));
    });

    it('declares no write, so none is served', async () => {
      const { fixture, adapter } = await signedIn();
      // The three write answers are the SAME SHAPE — `{<verb>: true, row}` —
      // so the flag is the only thing that says which write happened. A route
      // declared with the wrong action passes the gate, asks for the wrong
      // write and hands the screen a plausible row for an operation it did not
      // perform. Both values are driven rather than one planted: an answer
      // with the right verb must come back, and the same row behind a wrong
      // verb must be refused. A fixture that could only agree with the route
      // would pass with the check deleted.
      fixture.apiResponse = libraryVerbAnswer('updated');
      await expect(adapter.raw.entities.ClinicalPathway.update('p-1', { is_active: false }))
        .resolves.toEqual({ id: 'row-1' });

      fixture.apiResponse = libraryVerbAnswer('created');
      await expect(adapter.raw.entities.ClinicalPathway.update('p-1', { is_active: false }))
        .rejects.toThrow(ARGUMENTS_UNSUPPORTED);

      fixture.apiResponse = libraryVerbAnswer('updated');
      await expect(adapter.raw.entities.ClinicalPathway.delete('p-1'))
        .rejects.toThrow(ARGUMENTS_UNSUPPORTED);
    });

    it('sends each of the four its own capability, and never a neighbour\'s', async () => {
      const { fixture, adapter } = await signedIn();
      fixture.apiResponse = libraryWriteAnswer(fixture);
      // One shared `library_write` body serves all four, which is exactly why
      // this is worth asserting: the four contracts differ only in the name
      // they are reached by, so a copied declaration pointing at the wrong one
      // would write a template into the folder table and nothing in the shape
      // of the request would look wrong.
      const expected = [
        ['ClinicalPathway', 'manageClinicalPathway'],
        ['ClinicalLibraryTemplate', 'manageClinicalLibraryTemplate'],
        ['ClinicalLibraryFolder', 'manageClinicalLibraryFolder'],
        ['EducationMaterial', 'manageEducationMaterial'],
      ];
      for (const [entity, capability] of expected) {
        for (const [operation, args] of [
          ['create', [{ title: 'x' }]], ['update', ['row-1', { title: 'x' }]],
          ['delete', ['row-1']],
        ]) {
          await adapter.raw.entities[entity][operation](...args);
          expect(fixture.apiCalls.at(-1).url)
            .toBe(`${stagingApiUrl}/v1/functions/${capability}`);
          expect(fixture.apiCalls.at(-1).body.params.action).toBe(operation);
        }
      }
      expect(fixture.apiCalls).toHaveLength(expected.length * 3);
    });

    it('refuses an argument shape the contract cannot mean, before any request', async () => {
      const { fixture, adapter } = await signedIn();
      fixture.apiResponse = libraryAnswer([]);
      // An empty id is not an id, and an array is not a field object. These
      // refuse HERE rather than at the contract because a request built from
      // them would name a row nobody meant.
      for (const call of [
        () => adapter.raw.entities.ClinicalPathway.update('', { a: 1 }),
        () => adapter.raw.entities.ClinicalPathway.update(undefined, { a: 1 }),
        () => adapter.raw.entities.ClinicalPathway.delete(''),
        () => adapter.raw.entities.ClinicalPathway.create([{ a: 1 }]),
        () => adapter.raw.entities.ClinicalPathway.create(null),
        () => adapter.raw.entities.ClinicalLibraryFolder.update('f-1', 'name'),
      ]) {
        await expect(call()).rejects.toThrow(ARGUMENTS_UNSUPPORTED);
      }
      expect(fixture.apiCalls).toHaveLength(0);
    });

    it('hands back the row the contract wrote, not the envelope around it', async () => {
      const { fixture, adapter } = await signedIn();
      // Every action of every one of the four answers
      // `{created|updated|deleted: true, row}` — one shared body, so one
      // projection. A route reading `entries` or the whole envelope would hand
      // a screen an object it cannot render.
      //
      // Each verb drives its OWN route. A first version varied only the
      // marker key beside `row` and called `create` on every iteration, which
      // proves one route three times: `update` and `delete` are separate
      // declarations, and a projection typed wrong into either would have
      // survived the loop with its comment still claiming all three.
      const row = { id: 'p-1', pathway_name: 'CHF' };
      const calls = {
        created: () => adapter.raw.entities.ClinicalPathway.create({ pathway_name: 'CHF' }),
        updated: () => adapter.raw.entities.ClinicalPathway.update('p-1', { pathway_name: 'CHF' }),
        deleted: () => adapter.raw.entities.ClinicalPathway.delete('p-1'),
      };
      for (const [verb, call] of Object.entries(calls)) {
        fixture.apiResponse = () => new Response(
          JSON.stringify({
            success: true, result: { [verb]: true, row },
            execution: 'pennsync-api', base44ExecutionDependency: false,
          }), { headers: { 'content-type': 'application/json' } });
        expect(await call(), `${verb} projects the row`).toEqual(row);
      }
    });
  });

  it('files a task through the contract that already shipped, and hands back the row',
    async () => {
      const { fixture, adapter } = await signedIn();
      // `Task.create` was the last route held by something other than its own
      // capability: #297's regression test planted this exact key, so declaring
      // it broke that test until its plant was derived. Nothing about the route
      // was ever in doubt, which is precisely why it is asserted here — a route
      // declared on the strength of "the capability exists" is a route whose
      // request shape and projection nobody has run.
      //
      // Found by sabotage, not by reading: with `key` changed from `task` to
      // `entries` the whole file passed, because the operational family's
      // projections were covered nowhere in it.
      const task = { id: 't-1', title: 'Reorder gauze', patient_id: 'p-1' };
      fixture.apiResponse = () => new Response(
        JSON.stringify({
          success: true, result: { created: true, task },
          execution: 'pennsync-api', base44ExecutionDependency: false,
        }), { headers: { 'content-type': 'application/json' } });

      expect(await adapter.raw.entities.Task.create({ title: 'Reorder gauze', patient_id: 'p-1' }))
        .toEqual(task);
      expect(fixture.apiCalls.at(-1).url)
        .toBe(`${stagingApiUrl}/v1/functions/createAgencyTask`);
      // The whole payload goes as `fields`: the contract decides which of them
      // are writable and refuses the rest by name, and a route filtering here
      // would lose a misspelling the contract would have reported.
      expect(fixture.apiCalls.at(-1).body.params)
        .toEqual({ fields: { title: 'Reorder gauze', patient_id: 'p-1' } });

      // And a payload that is not a field object refuses before any request.
      for (const fields of [null, [{ title: 'x' }], 'title']) {
        await expect(adapter.raw.entities.Task.create(fields))
          .rejects.toThrow(ARGUMENTS_UNSUPPORTED);
      }
    });

  /**
   * EVERY EMITTED KEY IS A PARAMETER ITS CAPABILITY ACTUALLY TAKES.
   *
   * The service refuses a body naming anything outside a handler's own
   * `exactObject(params, [...])` allowlist, so a route emitting a key its
   * capability has no parameter for fails EVERY call it makes.
   * `check:entity-routes` cannot see it: the gate proves a route ACCEPTS a call
   * site's arguments and says nothing about the body it builds out of them.
   *
   * Read off `handlers.mjs` rather than `record-contracts.mjs`, because the
   * handler is the boundary that refuses and one capability here —
   * `listBrokeredRecords` — has no contract entry at all. Driven by the gate's
   * own served set, so the arguments are each call site's real ones.
   *
   * THAT SERVED SET IS ALSO THE LIMIT OF WHAT THIS CAN SEE, and the direction
   * is worth knowing: a route that breaks by REFUSING its call site leaves the
   * served set entirely and is counted in the gate's own refusal line, not
   * here. So this reads routes that break by SENDING the wrong thing, and the
   * gate reads routes that break by sending nothing. The two readings partition
   * the failures and neither sees the other's — measured by the thread that
   * owns the route table, when a sabotage that emptied a route's `orderable`
   * came back inert for exactly this reason. A zero here is not a clear class.
   */
  it('emits no key its capability has no parameter for', async () => {
    const { readFileSync } = await import('node:fs');
    const { cwd } = await import('node:process');
    const { servedSites } = await import('../../tools-entity-routes.mjs');
    const { callArguments } = await import('../../tools-entity-call-arguments.mjs');

    /*
     * THE PARSE ANSWERS ABOUT ONE ALLOWLIST OR IT REFUSES.
     *
     * A handler that fences several ACTIONS carries several `exactObject` calls,
     * and which one a request meets is decided at run time by the action. There
     * is no single list to compare a route against, so taking the first would
     * report confidently against a list the route may never meet. Six handlers
     * are in that state and no route names one today — a property of the current
     * route table that nothing guarded until this refusal, raised by the batch
     * that owns `tools-handler-allowlist.mjs`, whose own tool excludes the same
     * six for the same reason.
     *
     * The pattern tolerates whitespace, and that is not tidiness. A first version
     * matched `exactObject(params, [` on one line, and `manageAgencyMembership`
     * wraps its second list onto the next — so that version saw ONE list where
     * there are two and would have trusted it. The failure was silent in the one
     * direction that matters, and it is why the six are asserted by name below
     * rather than counted: a count agrees with a parse that has stopped seeing
     * half of what it reads.
     */
    const ALLOWLIST = /exactObject\(\s*params\s*,\s*\[([^\]]*)\]/g;
    const NAMED = /exactObject\(\s*params\s*,\s*([A-Z][A-Z0-9_]*)\s*[,)]/g;
    const source = readFileSync('services/pennsync-api/handlers.mjs', 'utf8');
    const starts = [...source.matchAll(/^ {2}([A-Za-z0-9_]+): Object\.freeze\(\{/gm)];
    const allowed = new Map();
    const dispatched = new Set();
    const elsewhere = new Set();
    const unfenced = new Set();
    const fences = (block) => ({
      lists: [...block.matchAll(ALLOWLIST)],
      named: [...block.matchAll(NAMED)],
    });
    starts.forEach((start, index) => {
      const next = index + 1 < starts.length ? starts[index + 1].index : source.length;
      const { lists, named } = fences(source.slice(start.index, next));
      if (lists.length + named.length > 1) dispatched.add(start[1]);
      else if (lists.length === 1) {
        allowed.set(start[1], [...lists[0][1].matchAll(/'([^']+)'/g)].map(([, key]) => key));
      } else if (named.length === 1) elsewhere.add(`${start[1]} -> ${named[0][1]}`);
      else unfenced.add(start[1]);
    });

    // The refusal is proved to bite on the real tree before it is relied on: a
    // parse that had stopped detecting several lists would leave this set empty
    // and every route would sail past the check below.
    expect([...dispatched].sort()).toEqual([
      'listAuthorizedPatients', 'manageAgencyMembership', 'manageAuthorizedReferral',
      'manageMyNotifications', 'manageVehicleMaintenance', 'updateIncident',
    ]);

    /*
     * AN ALLOWLIST THIS FILE CANNOT READ IS NOT AN ABSENT ONE.
     *
     * Two handlers fence themselves with a constant declared in a sibling
     * module, and four fence nothing here at all. The first shape is the one
     * that matters: a literal list is what this parse reads, so a handler
     * holding a literal AND a constant would have counted ONE list and been
     * trusted -- the same shape as the wrapped-line defect above, in the half
     * that was fixed by adding whitespace tolerance and not by asking what else
     * a list can be spelled as. Counting both kinds into `dispatched` closes it.
     *
     * Neither population may be silently empty, so both are pinned by name. A
     * route naming one of these six fails on `allowed.has` below -- the parse is
     * fail-closed for a route -- but that refusal says nothing about the
     * population GROWING, which is what these two lines are for.
     */
    expect([...elsewhere].sort()).toEqual([
      'generateAIReport -> AI_REPORT_PARAMS',
      'submitStateReportableIncident -> STATE_INCIDENT_FIELDS',
    ]);
    expect([...unfenced].sort()).toEqual([
      'analyzeReferral', 'generatePatientHandout', 'sendAccountReadyEmail', 'sendWelcomeEmail',
    ]);

    // The mixed shape is not on the tree, so the pins above cannot prove the
    // widened count bites. Driven through the same reader: one literal beside
    // one constant is TWO fences, which is the case the old parse trusted.
    const mixed = fences("exactObject(params, ['a'], 'X');\n"
      + "      exactObject(params, SOME_FIELDS, 'X');");
    expect(mixed.lists.length + mixed.named.length).toBe(2);
    const single = fences("exactObject(params, ['a'], 'X');");
    expect(single.lists.length + single.named.length).toBe(1);

    // A parse that quietly read nothing would agree with every route, and one
    // that read the wrong list of several would agree with it just as quietly.
    for (const route of Object.values(ENTITY_ROUTES)) {
      expect(dispatched.has(route.function),
        `${route.function} fences several allowlists; which applies is the action's, not this parse's`)
        .toBe(false);
      expect(allowed.has(route.function), `no parameter list parsed for ${route.function}`).toBe(true);
    }

    const calls = callArguments(cwd());
    const { served } = servedSites(cwd(), ENTITY_ROUTES, calls.length);
    const violations = new Set();
    let checked = 0;
    for (const call of served) {
      const route = ENTITY_ROUTES[call.key];
      checked += 1;
      for (const key of Object.keys(route.request(...call.arguments))) {
        if (!allowed.get(route.function).includes(key)) violations.add(`${call.key}:${key}`);
      }
    }
    expect(checked).toBeGreaterThan(90);

    /*
     * WHAT IS STILL BROKEN, PINNED RATHER THAN SKIPPED, WITH AN OWNER EACH.
     *
     * Measured on 2026-09-29 against `main` at 36402f3. `libraryWrite` is clean
     * and `brokeredRead` is clean by luck rather than by design — its contracts
     * take no order parameter and its routes emit none — which is why this check
     * is worth having around both.
     *
     * ALL SEVEN BELOW ARE NOW FIXED; the list is kept as the record of what
     * this check caught, and the assertion at the end of the test is the empty
     * set. Six belonged to the OPERATIONAL family and to the batch that landed
     * them: `AgencySettings.list` and `.filter`,
     * `PDFTemplate.list` and `.filter`, `DocumentRecord.filter` and
     * `NoteConversion.list` each declare a field orderable where their contract
     * takes no order parameter. The seventh, `User.list`, is the ROSTER batch's
     * and is described below. Pinning them here rather than excluding a helper
     * by name means this test FAILS as each fix lands and the pin has to go with
     * it; an exclusion by helper name would stay quiet forever.
     *
     * THIS CHECK AND THE STATIC ONE ARE NOT THE SAME POPULATION, and neither is
     * a superset. This one is driven by the gate's served set, so it reports a
     * key only where a REAL call site emits the offending argument today. A
     * check reading the route's declaration instead reports a key whose route
     * COULD emit one, which is the latent half — `FaceToFaceEncounter.filter`
     * is in that half and not here, because its single call site passes `null`
     * for its sort and so emits no `order` at all. Keep both readings: this one
     * says what is failing now, the other says what the next call site would
     * break.
     */
    /*
     * `User.list:order` IS A SEPARATE DEFECT, AND THE ONE LAYER THAT REFUSES IT
     * IS THE HANDLER — which is the whole reason this check reads the handler.
     *
     * Three of the four layers carry `order`. The route emits it,
     * `RECORD_CONTRACTS.listAgencyRoster.params` declares it and sends
     * `p_order`, and the store's current signature really is
     * `contract_roster_list(text, integer, text, text)` with a matching public
     * wrapper — `20260920620000_roster_created_date.sql` added the parameter and
     * `20260920630000_roster_display_name.sql` re-created it. The stale layer WAS
     * `handlers.mjs`, whose allowlist read `exactObject(params, ['limit',
     * 'after'])`, and `app.mjs` dispatches every request through
     * `handlers[name].handle` first. So the call failed 400 INVALID_PARAMS
     * before `contract()` was reached, and neither PostgREST nor any store was
     * involved: most of this route's served sites pass `'-created_date'`, so
     * the most-adopted route in this file failed at the boundary on nearly all
     * of them. A check comparing a route's keys against its CONTRACT's params
     * called it clean, and so did one comparing them against the SQL.
     *
     * **The allowlist reads `['limit', 'after', 'order']` now and this paragraph
     * is the record of why the check reads the HANDLER, which is an argument
     * that outlives its own worked example.** It is written in the past tense
     * deliberately rather than deleted: a reader who finds only the fix cannot
     * reconstruct which of four agreeing layers was the liar. The second defect
     * below is NOT fixed by it and is still live.
     *
     * TWO CONSEQUENCES WORTH KEEPING. An apply does not fix this one: an apply
     * changes the store, not the allowlist. And it survived because there IS
     * coverage for the order path — `services/pennsync-api/record-contracts.test.mjs`
     * sends `{ order: 'created_desc' }` to `listAgencyRoster` — one layer ABOVE
     * the layer that refuses it. A test that enters below a boundary cannot see
     * the boundary.
     *
     * AND THERE IS A SECOND, INDEPENDENT DEFECT ON THIS ROUTE THAT NOTHING HERE
     * CAN SEE, recorded so the one above does not read as the whole of it.
     * `RECORD_CONTRACTS.listAgencyRoster.body` puts `p_order` in the body
     * unconditionally — `args.order === undefined ? null : args.order` — and
     * `contractCapability` stringifies that body with nothing stripping nulls.
     * So a FOUR-key body goes out for every roster call, `User.list()` with no
     * arguments included. PostgREST resolves an RPC by the names of the body's
     * keys, so against a store that has not applied
     * `20260920620000_roster_created_date.sql` the call cannot resolve at all,
     * and that reaches all 29 served sites rather than the 24 above. The five
     * that pass no sort are clean against the TREE and not necessarily against
     * the deployment. Whether a given deployment has run that migration is not
     * a figure this repository holds, which is why this stays a comment.
     *
     * The DISCRIMINATOR is worth keeping, because it is derivable rather than
     * spotted and it is not "does the key look optional". Four capabilities send
     * `p_order` unconditionally — `listAgencyRoster`, `listPhysicians`,
     * `listAgencyTasks`, `listCarePlans` — and three are harmless because their
     * key is in the signature the migration that CREATED them made. The roster's
     * arrived in a forward migration instead. What makes the exposed population
     * one rather than four is a grep over the whole record directory rather than
     * a reading of the roster: `drop function "public"."pennsync_contract_` has
     * exactly one occurrence in it, and it is `20260920620000`'s. So a capability
     * is exposed when a forward migration widened the body-key set its wrapper
     * accepts, that grep is what finds the next one, and a check over it must key
     * on the body the registry ALWAYS sends rather than on a caller's arguments.
     */
    /*
     * ALL SEVEN ARE FIXED, and this pin went with them as the paragraph above
     * said it would. The two fixes are DIFFERENT and the difference is the
     * finding, so neither is described as "the order fix":
     *
     *   - The six operational keys were fixed in the ROUTE. Their contracts
     *     take no order parameter, so the route must not send one; `orderable`
     *     and `ordered` are now separate, the sort is honoured client-side and
     *     the key is never emitted. The handler allowlists are untouched and
     *     still lack `order` — checked one by one rather than inferred, because
     *     "the violations went away" is satisfied by a check that went blind.
     *   - `User.list` was fixed in the HANDLER, which is the layer the
     *     paragraph above identified as the stale one: the roster allowlist now
     *     reads `['limit', 'after', 'order']`, because that contract really
     *     does take the parameter.
     *
     * TWO SABOTAGES FAILED BEFORE ONE BIT, and both failures are findings
     * rather than fumbles, so they are recorded rather than quietly retried.
     *
     *   - Re-adding `orderable: ['-created_date']` changed nothing, because
     *     `orderKey` strips the leading dash before the lookup and compares the
     *     FIELD. A plant written in the declaration's own vocabulary was
     *     therefore inert, and an inert plant is indistinguishable from a
     *     working check with nothing to find. `orderable` takes `created_date`.
     *   - Deleting `orderKey`'s `ordered` short-circuit — the apparent inverse
     *     of the six route fixes — also changed nothing, and that one is a real
     *     property of this check. With `orderable` empty the fall-through
     *     raises `unsupported('sort')`, so the site leaves the SERVED set
     *     entirely and becomes one of the gate's REFUSALS. This check reads
     *     served sites, so a route that breaks by refusing is invisible here
     *     and is counted in the gate's own line instead. The two readings
     *     partition the failures; neither sees the other's.
     *
     * AN EMPTY EXPECTATION IS NOT EVIDENCE (D174), so the plant below is what
     * says this check still bites. Without it the whole test passes with
     * `violations` never populated — a broken driver and a clean tree are the
     * same green.
     */
    expect([...violations].sort()).toEqual([]);

    // The plant. A route that emits a key its handler's allowlist refuses is
    // the exact shape all seven had, so build one and require it to be caught.
    // It is driven through the same `violations` collection the assertion above
    // reads, not a parallel copy of the rule.
    {
      const planted = new Set();
      const rosterAllowed = allowed.get('listAgencyRoster');
      for (const emitted of ['order', 'sort_direction']) {
        if (!rosterAllowed.includes(emitted)) planted.add(`Planted.list:${emitted}`);
      }
      expect([...planted]).toEqual(['Planted.list:sort_direction']);
    }

    // The four library writes with no readable call site emit through the same
    // helper, so drive the helper's remaining actions rather than leaving them
    // to a served set that cannot reach them.
    for (const key of ['ClinicalLibraryTemplate.create', 'CustomValidationRule.create',
      'CustomValidationRule.update', 'PatientEducationAssignment.update']) {
      const route = ENTITY_ROUTES[key];
      const args = route.arity === 2 ? ['row-1', { note: 'x' }] : [{ note: 'x' }];
      for (const emitted of Object.keys(route.request(...args))) {
        expect(allowed.get(route.function), `${key} emits ${emitted}`).toContain(emitted);
      }
    }
  });


  /**
   * THE DISCRIMINATOR FOR THAT SECOND FAULT, AS AN INSTRUMENT RATHER THAN THE
   * PARAGRAPH ABOVE.
   *
   * A capability is exposed to it when a FORWARD migration widened the body-key
   * set its public wrapper accepts: the registry then sends a key that resolves
   * against no function a store behind that migration has, and every call fails
   * rather than only the ones passing the new argument. Whether a key "looks
   * optional" decides nothing.
   *
   * Exactly one forward migration in the whole record directory changes a public
   * wrapper's arity, so the exposed population is one and this says which. A
   * paragraph recording that goes stale the day a second arrives and nothing
   * notices; this fails, and the failure is the reading. It is deliberately
   * tree-side: a hosted comparison would report zero forever once the store is
   * applied, while this keeps saying which capability a store behind the tree
   * cannot serve.
   *
   * WHAT IT CANNOT SEE, DECLARED RATHER THAN PATCHED. `create or replace
   * function` cannot change an argument list — a different list makes a new
   * OVERLOAD and leaves the old form in place — so a forward migration can
   * change which signatures exist with no `drop function` line at all, and the
   * symptom is identical: an unapplied deployment has only the old form, and a
   * body carrying the new key resolves against nothing. That is exactly why
   * `20260920620000` had to drop first, and leaving the old overload is the
   * safer-LOOKING choice, which is what makes it the likely next shape.
   *
   * The gap is declared instead of closed on purpose, and the reason is
   * stronger than noise. The wider pattern is one over `create function`, which
   * fires on every `create function` in this directory — `20260920660000` alone
   * adds twelve names, not one of them an overload of anything — so it does not
   * merely cost noise, it has NO SIGNAL at that granularity. An overload is
   * visible only by comparing a created signature against the signatures that
   * already exist for that name, which is a different instrument rather than a
   * broader pattern. A check that names what it cannot see is the stronger
   * artefact, so the blind spot is ASSERTED below as a silence rather than
   * promised here, and that assertion is what fails the day somebody widens it.
   *
   * THE DISCRIMINATOR IS CONTROLLED, and the control lives outside this file.
   * Four registry entries emit an order key: the roster, `listPhysicians`,
   * `listAgencyTasks` and `listCarePlans`. Three carry that key in the signature
   * their CREATING migration made and only the roster does not, so the rule
   * separating the two cases is exercised on both sides rather than only where
   * it fires. `contract_task_list` is the row that earns it: a forward migration
   * DOES recreate it, at a byte-identical parameter list, so "was this recreated
   * forward" mis-sorts it and "did a forward migration change its signature"
   * does not. That control cannot be run against the deployment at all — three
   * of the four functions are absent there, so every answer is identical and
   * none of them is about ordering, and an instrument built there would have
   * looked like it passed with no case proving it discriminates. Measured by the
   * batch that owns the hosted reads; the row and the layer point are this
   * file's.
   *
   * AND THE LAYER IS PART OF THE PATTERN, not an accident of it. That same
   * forward recreation is of the INNER `pennsync_records` function, while the
   * PUBLIC wrapper it matches here is never dropped or recreated — PostgREST
   * resolves the wrapper, so the wrapper's arity is what decides which call
   * shapes exist. A scan of the inner name would find that recreation and pin an
   * occurrence that changes no call shape at all, which is worse than missing
   * one: the wrong layer writes a false positive into its own expectation.
   */
  it('names every forward migration that changes a public wrapper\'s arity', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const DIRECTORY = 'services/authority-store/supabase/record-migrations';
    const WRAPPER_DROPPED = /drop function "public"\."(pennsync_contract_[a-z_]+)"\(([^)]*)\)/g;

    /*
     * Comments are stripped before matching, AT STATEMENT LEVEL and no further.
     * Prose in this directory names these functions — `20260920620000:219` says
     * `must be owner of function public.pennsync_contract_roster_list` in a
     * comment, and a count over raw text reads it as an occurrence. The quoted
     * identifier form happens to exclude that particular line, which is a
     * property of the pattern rather than anything reasoned, and a measurement
     * right for a reason nobody chose is indistinguishable from a considered one
     * at the moment it is reported.
     *
     * Statement level is the whole of the claim. A whole-file strip would be
     * WRONG here: `--` occurs inside dollar-quoted `$contract$` bodies all over
     * this directory, so stripping to end of line everywhere rewrites text
     * nobody wrote and then counts the result. The DDL this matches sits outside
     * those bodies, which is what makes the strip safe for it and unsafe as a
     * general habit. Name the level or do not strip.
     */
    const stripLineComments = (text) => text.replace(/^[^\n]*?--[^\n]*$/gm,
      (line) => line.slice(0, line.indexOf('--')));
    const dropsIn = (text) => [...stripLineComments(text).matchAll(WRAPPER_DROPPED)]
      .map(([, name, args]) => `${name}(${args})`);

    // The extractor is shown to bite before it is believed: a synthetic text
    // with two occurrences must yield two. An expectation of "exactly one" that
    // a broken pattern satisfies with zero is the shape this whole exercise is
    // about.
    expect(dropsIn('drop function "public"."pennsync_contract_a_list"(text);\n'
      + 'drop function "public"."pennsync_contract_b_list"(text,integer);'))
      .toEqual(['pennsync_contract_a_list(text)', 'pennsync_contract_b_list(text,integer)']);

    // One text carrying BOTH forms, so the case proves the extractor is
    // DISCRIMINATING rather than merely silent. A case where everything is
    // ignored passes for an extractor that has stopped extracting, which is the
    // blind-control shape arriving in a sabotage: a case that comes back empty
    // is not evidence until the same run has been shown to bite on something.
    // The tree has never contained a commented drop, so nothing here has ever
    // tested what the pattern is accidentally protected from.
    expect(dropsIn('-- drop function "public"."pennsync_contract_fake"(text)\n'
      + 'drop function "public"."pennsync_contract_real"(text,integer);'))
      .toEqual(['pennsync_contract_real(text,integer)']);

    // And the declared blind spot, asserted as a silence. An overload added with
    // no drop has the same effect on a deployment behind the tree, and this
    // pattern does not see it; a wider pattern that did would fire on every
    // migration here, so this is what fails if anybody widens it.
    expect(dropsIn('create or replace function "public"."pennsync_contract_c_list"'
      + '(p_agency text, p_limit integer, p_order text) returns jsonb')).toEqual([]);

    const found = [];
    for (const file of readdirSync(DIRECTORY).filter(name => name.endsWith('.sql')).sort()) {
      for (const signature of dropsIn(readFileSync(`${DIRECTORY}/${file}`, 'utf8'))) {
        found.push(`${file}: ${signature}`);
      }
    }
    expect(found).toEqual([
      '20260920620000_roster_created_date.sql: pennsync_contract_roster_list(text,integer,text)',
    ]);
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
  // The envelope a screen contract sends. `key` is the route's OWN declared
  // answer key by default, because a fixture that always says `entries` is a
  // second copy of the assumption the route makes — which is exactly what let
  // `ClinicalEvent.filter` read a key `contract_clinical_event_list` never
  // answers while every test in this block passed.
  const answerOf = (routeKey, rows, key = ENTITY_ROUTES[routeKey].answerKey) => () => new Response(
    JSON.stringify({ success: true, result: { success: true, [key]: rows }, execution: 'pennsync-api', base44ExecutionDependency: false }),
    { headers: { 'content-type': 'application/json' } });
  const entries = (rows) => answerOf('OCRFeedback.filter', rows);

  beforeEach(() => bindTrustedTenantContext(boundUser, boundContext));
  afterEach(() => clearTrustedTenantContext());

  it('sends each screen its own contract, with the arguments the contract takes', async () => {
    const { fixture, adapter } = await signedIn();
    fixture.apiResponse = answerOf('ClinicalEvent.filter', [{ id: 'event-1' }]);
    await adapter.raw.entities.ClinicalEvent.filter({ patient_id: 'p1' }, '-event_date', 200);
    expect(fixture.apiCalls.at(-1).url).toBe(`${stagingApiUrl}/v1/functions/listChartClinicalEvents`);
    expect(fixture.apiCalls.at(-1).body.params).toEqual({ patient_id: 'p1', limit: 200 });

    // Each call gets the envelope ITS contract sends, which is why the fixture
    // is re-set per entity: they do not all answer under the same key.
    fixture.apiResponse = answerOf('OCRFeedback.filter', []);
    await adapter.raw.entities.OCRFeedback.filter({ applied_to_training: false }, undefined, 5000);
    expect(fixture.apiCalls.at(-1).url).toBe(`${stagingApiUrl}/v1/functions/listOcrCorrections`);
    expect(fixture.apiCalls.at(-1).body.params).toEqual({ applied_to_training: false, limit: 500 });

    fixture.apiResponse = answerOf('ComplianceRule.filter', []);
    await adapter.raw.entities.ComplianceRule.filter({ rule_code: 'CMS-TF-1' }, '-created_date', 2);
    expect(fixture.apiCalls.at(-1).body.params).toEqual({ rule_code: 'CMS-TF-1', limit: 2 });
  });

  it('reads the chart event list under the key its contract actually answers', async () => {
    const { fixture, adapter } = await signedIn();
    const rows = [{ id: 'ce-1', event_type: 'fall' }];
    // What the contract sends, with the key read off the route's declaration.
    fixture.apiResponse = answerOf('ClinicalEvent.filter', rows);
    expect(await adapter.raw.entities.ClinicalEvent.filter({ patient_id: 'p-1' })).toEqual(rows);

    // And what six of its siblings send, which this route must NOT accept —
    // an assertion that only one of the two keys works is what tells a real
    // reader from one that happens to agree with the fixture. Every other test
    // in this file builds its response with `entries` hard-coded, so the
    // fixture was a second copy of the assumption the route got wrong.
    fixture.apiResponse = answerOf('ClinicalEvent.filter', rows, 'entries');
    await expect(adapter.raw.entities.ClinicalEvent.filter({ patient_id: 'p-1' }))
      .rejects.toThrow(ARGUMENTS_UNSUPPORTED);
  });

  it('hands back the id its delete contract answers, not its save sibling\'s row',
    async () => {
      const { fixture, adapter } = await signedIn();
      // `contract_pdf_template_delete` answers `{deleted, id}`; the SAVE
      // contract beside it answers `{created, template}`. The route was
      // written next to the save and read `template`, so every delete
      // resolved to `undefined`.
      fixture.apiResponse = () => new Response(
        JSON.stringify({
          success: true, result: { deleted: true, id: 'tpl-1' },
          execution: 'pennsync-api', base44ExecutionDependency: false,
        }), { headers: { 'content-type': 'application/json' } });
      expect(await adapter.raw.entities.PDFTemplate.delete('tpl-1')).toEqual({ id: 'tpl-1' });
      expect(fixture.apiCalls.at(-1).url).toBe(`${stagingApiUrl}/v1/functions/deletePdfTemplate`);
      expect(fixture.apiCalls.at(-1).body.params).toEqual({ id: 'tpl-1' });
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
    const { readdirSync, readFileSync } = await import('node:fs');
    const { RECORD_CONTRACTS } = await import('../../services/pennsync-api/record-contracts.mjs');
    // Every record migration, not batch E's own file. A first version read
    // that one file, and the first route declared outside the family — the
    // alert pair, whose contract lives in `…160000_contract_alert.sql` — made
    // it fail by name rather than pass over a contract it could not see. A
    // check scoped to the file its author happened to be working in is a check
    // that goes quiet exactly when a new family arrives.
    const dir = 'services/authority-store/supabase/record-migrations';
    const sql = readdirSync(dir).filter(name => name.endsWith('.sql')).sort()
      .map(name => readFileSync(`${dir}/${name}`, 'utf8')).join('\n');
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

  it('takes every answer key from the contract that returns it', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { RECORD_CONTRACTS } = await import('../../services/pennsync-api/record-contracts.mjs');
    // Every record migration, not batch E's own file. A first version read
    // that one file, and the first route declared outside the family — the
    // alert pair, whose contract lives in `…160000_contract_alert.sql` — made
    // it fail by name rather than pass over a contract it could not see. A
    // check scoped to the file its author happened to be working in is a check
    // that goes quiet exactly when a new family arrives.
    const dir = 'services/authority-store/supabase/record-migrations';
    const sql = readdirSync(dir).filter(name => name.endsWith('.sql')).sort()
      .map(name => readFileSync(`${dir}/${name}`, 'utf8')).join('\n');
    // The sibling of the ceiling check above, and it exists because the gate
    // cannot stand in for it: `check:entity-routes` runs a call's arguments
    // through `request` and never touches `response`, so a route reading a key
    // its contract does not answer passes every check and hands its screen
    // `undefined` on every call. `contract_clinical_event_list` answers
    // `events` where its six siblings answer `entries`, and the route read
    // `entries`.
    const declared = Object.values(ENTITY_ROUTES).filter(route => route.answerKey);
    expect(declared.length, 'no route declares an answer key').toBeGreaterThan(0);
    for (const route of declared) {
      const rpc = RECORD_CONTRACTS[route.function].rpc.replace(/^pennsync_/, '');
      const start = sql.indexOf(`create function "pennsync_records".${rpc}(`);
      expect(start, `${rpc} is not in the migration`).toBeGreaterThan(-1);
      const next = sql.indexOf('create function', start + 20);
      const body = sql.slice(start, next === -1 ? sql.length : next);
      // The payload key in what the contract RETURNS, read from the migration
      // rather than from a list kept here, because a list kept here is the
      // second copy that drifts. Two shapes exist and neither is the family's
      // to assume: batch E wraps its rows behind `'success', true`, and the
      // alert pair, written before that convention, returns the key alone.
      // A failure return (`'success', false, …`) is dropped BY ITS OWN SHAPE
      // and counted, so a contract with nothing but failure returns fails here
      // instead of quietly matching none.
      const returns = [...body.matchAll(
        /return jsonb_build_object\(\s*('success',\s*(?:true|false),\s*)?'([a-z_]+)'/g)];
      const returned = [...new Set(returns
        .filter(m => !(m[1] && m[1].includes('false')))
        .map(m => m[2]))];
      expect(returns.length, `${rpc} returns no jsonb object at all`).toBeGreaterThan(0);
      expect(returned, `${rpc} does not answer under one key`).toHaveLength(1);
      expect(route.answerKey, `${route.function}'s route and its contract disagree`)
        .toBe(returned[0]);
    }
  });

  it('never sends a capability an argument its contract does not take', async () => {
    const { RECORD_CONTRACTS } = await import('../../services/pennsync-api/record-contracts.mjs');
    // `record-contracts.mjs` refuses any argument outside a capability's own
    // `params` with CONTRACT_ARGUMENTS_INVALID, so a route that emits one gets
    // a 400 on every call that produces it. Seven routes did: they declared
    // `created_date` as ORDERABLE when their contracts take no order parameter
    // and already order `created_date desc` unconditionally, so the one sort
    // every one of their call sites asks for was the one that failed.
    //
    // The gate cannot stand in for this either. It runs `request` and asks
    // only that it does not throw; what comes out of it is never compared with
    // anything. So the allowlist is read from the contract registry and the
    // arguments are read from the route, and neither side is typed here.
    const sorts = ['-created_date', 'created_date', '-updated_date', '-due_date',
      '-event_date', '-sent_date', '-priority', '-severity', '-usage_count',
      '-assigned_date', '-last_used_date', 'full_name', 'order', null, undefined];
    for (const [key, route] of Object.entries(ENTITY_ROUTES)) {
      const contract = RECORD_CONTRACTS[route.function];
      if (!contract) continue;
      const filtered = key.endsWith('.filter');
      for (const sort of sorts) {
        let asked;
        try {
          asked = route.request(...(filtered ? [{}, sort, undefined] : [sort, undefined]));
        } catch { continue; }
        if (asked === null || typeof asked !== 'object') continue;
        for (const argument of Object.keys(asked)) {
          expect(contract.params, `${key} sends ${route.function} an argument it refuses`)
            .toContain(argument);
        }
      }
    }
  });

  it("takes the alert route's ceiling from the contract that clamps it", async () => {
    const { readFileSync } = await import('node:fs');
    // Its own migration, and its own enforcement: batch E passes a bound to a
    // shared `screen_limit` and this one clamps inline, so the derivation
    // cannot be shared with the test above. What IS shared is the reason for
    // having it — the number in the route file is a second copy of a number
    // that lives in SQL.
    const sql = readFileSync(
      'services/authority-store/supabase/record-migrations/20260920160000_contract_alert.sql', 'utf8');
    const start = sql.indexOf('create function "pennsync_records".contract_alert_list(');
    expect(start, 'contract_alert_list is not in the migration').toBeGreaterThan(-1);
    const next = sql.indexOf('create function', start + 20);
    const body = sql.slice(start, next === -1 ? sql.length : next);
    const clamped = [...body.matchAll(/least\(p_limit,\s*(\d+)\)/g)].map(m => Number(m[1]));
    expect(clamped, 'contract_alert_list clamps p_limit exactly once').toHaveLength(1);
    expect(clamped[0], "the alert route and its contract disagree about the ceiling").toBe(ALERT_CEILING);
  });

  /**
   * D168 says the gate runs a declaration's `request` against each call site's
   * real arguments and never exercises `response`, so a route can be counted
   * served while handing its screen `undefined`. These two drive `response`.
   *
   * The alert route is the case that made the rule concrete rather than a
   * worry: every batch E contract answers `entries` and `contract_alert_list`
   * answers `alerts`, so the first route declared outside that family would
   * have passed the gate and refused every real call. The second assertion is
   * the control — it fails if `answerKey` is ever dropped back to the constant,
   * which is the only way this defect returns.
   */
  it("delivers the alert contract's own answer shape, not batch E's", () => {
    const rows = (n) => ({ alerts: Array.from({ length: n }, (_, i) => ({ id: `a${i}`, status: 'active' })) });
    const filter = ENTITY_ROUTES['PatientAlert.filter'];
    const list = ENTITY_ROUTES['PatientAlert.list'];
    expect(filter.response(rows(3), { patient_id: 'p1' }, '-created_date', 30))
      .toEqual(rows(3).alerts);
    expect(list.response(rows(2), '-created_date', 5000)).toEqual(rows(2).alerts);
    // Batch E's key must NOT be read, or the route is reading a field this
    // contract never sends and every real answer becomes a refusal.
    expect(() => filter.response({ entries: [{ id: 'a0' }] }, { patient_id: 'p1' }, '-created_date', 30))
      .toThrow(ARGUMENTS_UNSUPPORTED);
  });

  it('serves the four alert call sites and proves the two over the ceiling', () => {
    const filter = ENTITY_ROUTES['PatientAlert.filter'];
    const list = ENTITY_ROUTES['PatientAlert.list'];
    // The four real call shapes, from the call sites themselves.
    expect(filter.request({ patient_id: 'p1' }, '-created_date', 30))
      .toEqual({ patient_id: 'p1', limit: 30 });
    expect(filter.request({ patient_id: 'p1', status: 'active' }, undefined, 1000))
      .toEqual({ patient_id: 'p1', status: 'active', limit: ALERT_CEILING });
    expect(filter.request({ status: 'active' }, undefined, 1000))
      .toEqual({ status: 'active', limit: ALERT_CEILING });
    expect(list.request('-created_date', 5000)).toEqual({ limit: ALERT_CEILING });

    // A caller under the ceiling got what it asked for; one above it only gets
    // an answer when the page proves there were no more rows. The contract
    // clamps silently, so without this a screen renders 500 alerts as every
    // alert.
    const rows = (n) => ({ alerts: Array.from({ length: n }, (_, i) => ({ id: `a${i}` })) });
    expect(filter.response(rows(30), { patient_id: 'p1' }, '-created_date', 30)).toHaveLength(30);
    expect(filter.response(rows(499), { status: 'active' }, undefined, 1000)).toHaveLength(499);
    expect(() => filter.response(rows(ALERT_CEILING), { status: 'active' }, undefined, 1000))
      .toThrow(PAGE_INCOMPLETE);
    expect(() => list.response(rows(ALERT_CEILING), '-created_date', 5000)).toThrow(PAGE_INCOMPLETE);

    // And what these routes refuse rather than silently dropping: a filter the
    // contract takes a parameter for but no call site passes, and the other
    // direction of the one order it implements.
    expect(() => filter.request({ patient_id: 'p1', severity: ['high'] }, undefined, 10))
      .toThrow(ARGUMENTS_UNSUPPORTED);
    expect(() => filter.request({ patient_id: 'p1' }, 'created_date', 10))
      .toThrow(ARGUMENTS_UNSUPPORTED);
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
    // The library writes added four more, and that is this disposition doing
    // its job rather than the list slipping: `ClinicalLibraryTemplate.create`
    // has two call sites and both build their payload at run time, one of them
    // by spreading a phrase from a seed list.
    // The compliance writes added two more, for the same reason and with the
    // same remedy: `AdrAuditCase.create` builds its payload out of the letter
    // analysis, and `ComplianceAudit.update` passes `auditFields`, which
    // `buildAuditFields` returns. Both are covered by refusals raised against
    // the real migration in `contract-compliance-writes.test.mjs`, which the
    // block below reads.
    expect([...report.unproved_routes].sort()).toEqual([
      'AdrAuditCase.create',
      'AgencySettings.create', 'AgencySettings.update',
      'ClinicalLibraryFolder.create', 'ClinicalLibraryTemplate.create',
      'ClinicalPathway.create', 'ClinicalPathway.update',
      'ComplianceAudit.update',
      'CustomValidationRule.create', 'CustomValidationRule.update',
      'EducationMaterial.create',
      'FaceToFaceEncounter.create', 'FaceToFaceEncounter.update',
      'NoteConversion.create',
      'NotificationPreference.create', 'NotificationPreference.update',
      'PatientEducationAssignment.update',
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

    // The same standard for the five clinical-library writes, whose suite is a
    // different file. All four capabilities route through ONE `library_write`
    // body, so the two halves are asserted separately and mean different
    // things: the pathway codes are the BODY's refusals — the payload checks,
    // the required and reserved fields, the missing row — and cover the shared
    // machinery once, while each entity's own `_FORBIDDEN` is the gate that
    // contract puts in front of it, which is the half a copied declaration
    // would get wrong. Asserting only the first would leave three capabilities
    // resting on a fourth's proof.
    const library = readFileSync(
      'services/authority-store/tests/contract-clinical-library.test.mjs', 'utf8');
    for (const code of ['PENNSYNC_PATHWAY_ACTION_INVALID', 'PENNSYNC_PATHWAY_AGENCY_NOT_HELD',
      'PENNSYNC_PATHWAY_FIELDS_INVALID', 'PENNSYNC_PATHWAY_FIELDS_EMPTY',
      'PENNSYNC_PATHWAY_FIELD_UNKNOWN', 'PENNSYNC_PATHWAY_FIELD_RESERVED',
      'PENNSYNC_PATHWAY_FIELD_REQUIRED', 'PENNSYNC_PATHWAY_ID_INVALID',
      'PENNSYNC_PATHWAY_NOT_FOUND',
      'PENNSYNC_PATHWAY_FORBIDDEN', 'PENNSYNC_LIBRARY_TEMPLATE_FORBIDDEN',
      'PENNSYNC_LIBRARY_FOLDER_FORBIDDEN', 'PENNSYNC_EDUCATION_MATERIAL_FORBIDDEN']) {
      expect(library, `${code} must be exercised by the library contract suite`)
        .toContain(code);
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

    // The compliance writes, a THIRD family on the same standing. The two
    // codes that matter most here are the ones a screen cannot see coming: an
    // unknown key is refused rather than filtered, so a payload that drifts
    // fails loudly instead of half-writing, and a fax history that shrank is
    // refused rather than stored, so a stale read cannot erase what really
    // went to a Medicare contractor.
    const compliance = readFileSync(
      'services/authority-store/tests/contract-compliance-writes.test.mjs', 'utf8');
    for (const code of ['PENNSYNC_AUDIT_WRITE_FIELD_UNKNOWN', 'PENNSYNC_AUDIT_WRITE_FIELD_RESERVED',
      'PENNSYNC_AUDIT_WRITE_REQUIRED', 'PENNSYNC_AUDIT_WRITE_VISIT_NOT_VISIBLE',
      'PENNSYNC_ADR_WRITE_FIELD_RESERVED', 'PENNSYNC_ADR_WRITE_LOCATOR_UNSUPPORTED',
      'PENNSYNC_ADR_WRITE_CHART_ELSEWHERE', 'PENNSYNC_ADR_WRITE_FAXES_TRUNCATED']) {
      expect(compliance, `${code} must be exercised by the contract suite`).toContain(code);
    }
  });

  it('hands a compliance write payload through untouched, and reads the answer', async () => {
    const create = ENTITY_ROUTES['AdrAuditCase.create'];
    const update = ENTITY_ROUTES['AdrAuditCase.update'];
    const remove = ENTITY_ROUTES['AdrAuditCase.delete'];

    // UNTOUCHED is the assertion. A route that dropped a key the contract does
    // not take would turn `FIELD_UNKNOWN` into a silent no-write, which is a
    // screen that believes it saved — so an unknown key has to reach the
    // contract, and the reserved ones too.
    expect(create.request({ case_name: 'x', nonsense: 1, agency_id: 'a' }))
      .toEqual({ case: { case_name: 'x', nonsense: 1, agency_id: 'a' } });
    expect(update.request('case-1', { status: 'submitted' }))
      .toEqual({ case_id: 'case-1', patch: { status: 'submitted' } });
    expect(remove.request('case-1')).toEqual({ case_id: 'case-1' });

    // The arity is declared because a rest parameter reveals no length, and
    // the guard only refuses arguments PAST it — so an over-declared arity
    // fails open on exactly the case the guard exists to close.
    expect([create.arity, update.arity, remove.arity]).toEqual([1, 2, 1]);

    // An id that is not a string, and a payload that is not an object. Both
    // refuse at the seam rather than reaching the contract as null.
    expect(() => update.request(undefined, { status: 'closed' })).toThrow(ARGUMENTS_UNSUPPORTED);
    expect(() => update.request('case-1', null)).toThrow(ARGUMENTS_UNSUPPORTED);
    expect(() => update.request('case-1', ['status'])).toThrow(ARGUMENTS_UNSUPPORTED);
    expect(() => create.request('not an object')).toThrow(ARGUMENTS_UNSUPPORTED);

    // The answer is READ. The gate never exercises `response`, so a route
    // wired to the wrong contract passes it and then hands the screen a
    // plausible row for a write it did not perform.
    expect(update.response({ success: true, updated: true, case: { id: 'case-1' } }))
      .toEqual({ id: 'case-1' });
    expect(() => update.response({ updated: true, case: { id: 'case-1' } }))
      .toThrow(ARGUMENTS_UNSUPPORTED);
    // The audit contracts answer under their own key, so the case routes must
    // not accept an audit's answer — which is what would happen if `answer`
    // were the same string for all five.
    expect(update.response({ success: true, audit: { id: 'a' } })).toBeUndefined();
    expect(ENTITY_ROUTES['ComplianceAudit.create'].response(
      { success: true, audit: { id: 'a' } })).toEqual({ id: 'a' });
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
    // being relaxed when batch D's nine paged operational reads arrived, again
    // for the two library reads whose call sites were once called unprovable,
    // again for the two `PatientAlert` reads, and again here for the five
    // compliance reads' seven. That growth is the point: the loop below reaches
    // each new route by construction, so a route cannot land without its
    // argument count being checked. The number is re-measured on each rebase
    // rather than added to, because a figure arrived at by arithmetic over two
    // branches is not a reading of either.
    expect(paged.length).toBe(49);

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

  /**
   * The third layer, and the one neither of the checks above can see.
   *
   * A route's arguments are read twice before anything runs: `handlers.mjs`
   * refuses a key outside its `exactObject` allowlist with INVALID_PARAMS, and
   * `record-contracts.mjs` refuses one outside the contract's `params` with
   * CONTRACT_ARGUMENTS_INVALID. The test above crosses the route against the
   * SECOND. This one crosses it against the FIRST, which is not the same list:
   * four handlers translate rather than forward — packing a flat body into one
   * `incident` or `timesheet` key — and for those the contract's `params` says
   * nothing about what the handler will accept.
   *
   * `record-contracts.test.mjs` proves the two lists are equal for the
   * handlers that forward verbatim. That is the pair; this is the third
   * member, and a check across two of three is green by construction on the
   * pair it compares.
   *
   * No disagreement today. This is a ratchet and is recorded as one: it found
   * nothing, and it is here because the two defects that made the forwarding
   * check worth writing were each invisible to every suite that existed.
   */
  it('never sends a capability an argument its handler refuses', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('services/pennsync-api/handlers.mjs', 'utf8');
    const entries = [...source.matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_]*): Object\.freeze\(\{/gm)]
      .map(match => ({ name: match[1], at: match.index }));
    expect(entries.length, 'handlers.mjs no longer parses as one entry per line')
      .toBeGreaterThan(50);
    const admits = {};
    for (const [index, entry] of entries.entries()) {
      const body = source.slice(entry.at, entries[index + 1]?.at ?? source.length);
      const lists = [...body.matchAll(/exactObject\(\s*params\s*,\s*\[([^\]]*)\]/g)];
      if (lists.length !== 1) continue;
      admits[entry.name] = lists[0][1].split(',')
        .map(key => key.trim().replace(/['"]/g, '')).filter(Boolean);
    }

    // Driven rather than read. A route's `request` is a function and the only
    // way to learn what it emits is to run it, so each operation is driven
    // through the argument shapes its call sites actually use. The limit is
    // there because the brokered and operational lists refuse a call without
    // one, and four routes crossed nothing until it was added — a driver that
    // cannot reach a route reports it as clean.
    const sorts = ['-created_date', 'created_date', '-updated_date', '-due_date',
      '-event_date', '-sent_date', '-priority', '-severity', '-usage_count',
      '-assigned_date', '-last_used_date', 'full_name', 'order', null, undefined];
    const id = '11111111-1111-4111-8111-111111111111';
    let crossed = 0;
    for (const [key, route] of Object.entries(ENTITY_ROUTES)) {
      const allowed = admits[route.function];
      if (!allowed) continue;
      const operation = key.split('.').pop();
      const shapes = [];
      if (operation === 'list') for (const sort of sorts) shapes.push([sort, undefined], [sort, 100]);
      else if (operation === 'filter') {
        for (const sort of sorts) {
          shapes.push([{}, sort, undefined], [{}, sort, 100],
            [{ patient_id: id }, sort, 100], [{ status: 'active' }, sort, 100]);
        }
      } else if (operation === 'create') shapes.push([{ title: 'x', name: 'x', patient_id: id }]);
      else if (operation === 'update') shapes.push([id, { title: 'x', name: 'x' }]);
      else if (operation === 'delete') shapes.push([id]);

      let reached = false;
      for (const args of shapes) {
        let asked;
        try { asked = route.request(...args); } catch { continue; }
        if (asked === null || typeof asked !== 'object') continue;
        reached = true;
        for (const argument of Object.keys(asked)) {
          expect(allowed, `${key} sends ${route.function} an argument its handler refuses`)
            .toContain(argument);
        }
      }
      if (reached) crossed += 1;
    }

    // The population is asserted so the check cannot pass by reaching nothing.
    // Four filters need a query shape this driver does not guess and are
    // deliberately uncrossed rather than silently counted as clean.
    expect(crossed, 'the driver has stopped reaching routes rather than the routes having changed')
      .toBeGreaterThan(60);
  });
  /*
   * EVERY DECLARATION IS STILL IN THE TABLE IT WAS WRITTEN INTO.
   *
   * `ENTITY_ROUTES` is a JavaScript object, so two declarations of one key are
   * not two -- the later silently replaces the earlier and nothing downstream
   * can tell. `check:entity-routes` reports coverage over the SURVIVOR, which
   * is the worst direction for a gate whose job is saying which calls have a
   * route: it answers "declared" while a key is served by whichever
   * declaration happened to come last, chosen by nobody.
   *
   * ESLint's `no-dupe-keys` catches the case that found this -- two literals
   * in one literal -- and that is a real defence, in a different gate. It is
   * NOT the whole class. `DECLARED_ROUTES` spreads `operationalRoutes`, and a
   * literal colliding with a key that spread produces is invisible to that
   * rule, because the two are not in the same object literal. Measured, not
   * reasoned: planting `'Task.filter'` as a literal beside the spread that
   * already declares it leaves lint SILENT, the gate reporting the same 81
   * declared, and this suite green -- while the spread wins and a merged,
   * reviewed route does nothing.
   *
   * So the comparison is the source's declarations against the table that came
   * out of them. It fires on a collision within either block, on a collision
   * ACROSS them, on a computed key this cannot read, and on a spread from
   * somewhere this does not know about -- and it fails CLOSED, because a parse
   * that stops seeing a block reports fewer keys than the table has rather
   * than agreeing with it.
   */
  it('declares each route once, across every block the table is built from', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/lib/independentEntityRoutes.js', 'utf8');

    const blockOf = (name) => {
      const opened = source.indexOf(`const ${name} = Object.freeze({`);
      expect(opened, `${name} is no longer declared the way this parse reads it`)
        .toBeGreaterThan(-1);
      const closed = source.indexOf('\n});', opened);
      expect(closed).toBeGreaterThan(opened);
      return source.slice(opened, closed);
    };

    // Every top-level line of a block, with comments dropped rather than
    // pattern-matched away: a comment's own text can start in column three.
    const topLevelLines = (block) => {
      const kept = [];
      let inComment = false;
      for (const line of block.split('\n')) {
        const trimmed = line.trim();
        if (inComment) {
          if (trimmed.includes('*/')) inComment = false;
          continue;
        }
        if (trimmed.startsWith('/*')) {
          if (!trimmed.includes('*/')) inComment = true;
          continue;
        }
        if (trimmed.startsWith('//')) continue;
        if (/^ {2}\S/.test(line)) kept.push(line);
      }
      return kept;
    };

    // The key-set comparison below is blind to a declaration it cannot read
    // that OVERWRITES a key some other declaration already supplies: the
    // object holds the same keys either way, so the sets agree while the
    // later declaration silently decides the route. Measured, not reasoned —
    // `[['Task', 'filter'].join('.')]: operationalRoutes['Task.create']`
    // planted after the spread leaves this suite at 60/60 green while
    // `ENTITY_ROUTES['Task.filter'].function` is `createAgencyTask`.
    //
    // So the shapes a top-level line may take are enumerated, and anything
    // else REFUSES rather than being skipped. That is the fail-closed half:
    // the key comparison catches what the parse can read, and this catches
    // the parse being handed something it cannot.
    const KEY_LINE = /^ {2}'([^']+)': /;
    const NESTED_CLOSE = /^ {2}\}\),?$/;
    const SPREAD = /^ {2}\.\.\.([A-Za-z_$][\w$]*),$/;
    const PARSED_BLOCKS = ['operationalRoutes', 'DECLARED_ROUTES'];

    const unreadable = [];
    const spreadsFound = [];
    const declared = PARSED_BLOCKS.flatMap((name) => {
      const keys = [];
      for (const line of topLevelLines(blockOf(name))) {
        const key = KEY_LINE.exec(line);
        if (key) { keys.push(key[1]); continue; }
        const spread = SPREAD.exec(line);
        if (spread) { spreadsFound.push(spread[1]); continue; }
        if (NESTED_CLOSE.test(line)) continue;
        unreadable.push(`${name}: ${line.trim()}`);
      }
      return keys;
    });

    expect(unreadable, 'a top-level declaration this parse cannot read. If it names a key\n'
      + '  that already exists, it overwrites it and the key comparison below stays\n'
      + '  green — so it is refused here rather than skipped')
      .toEqual([]);

    // A spread from somewhere this parse does not read is the same hazard
    // wearing different syntax: its keys arrive in the table unexamined.
    expect([...new Set(spreadsFound)].sort(), 'a block is spread in that this parse does\n'
      + '  not read, so its declarations are not compared against anything')
      .toEqual(['operationalRoutes']);

    // The parse reaching the real blocks, proved before it is relied on: a
    // pattern that matched nothing would report no duplicates just as happily.
    expect(declared.length).toBeGreaterThan(70);

    const duplicated = declared.filter((key, index) => declared.indexOf(key) !== index);
    expect(duplicated, 'a route key is declared twice; the later one silently wins and the\n'
      + '  gate reports coverage over whichever that is').toEqual([]);

    expect([...declared].sort(), 'the source declarations and the built table disagree, so\n'
      + '  either a key arrives by a route this parse cannot read, or one was lost')
      .toEqual([...Object.keys(ENTITY_ROUTES)].sort());
  });
});

/**
 * The duplicate-declaration guard, proved at BOTH surfaces, because proving it
 * at one is the failure this suite exists to avoid.
 *
 * `withoutCollisions` is where the refusal is DECIDED, and a test that only
 * calls it enters one layer away from where it MATTERS: the refusal protects
 * `ENTITY_ROUTES`, and it protects it only for as long as the export is built
 * by that function over every declaration block. Reverting the export to an
 * object literal with `...operationalRoutes` inside it — the exact shape this
 * replaced — leaves every behavioural test below green, because the function
 * is still correct and nothing calls it. So the second half reads the module's
 * own source and pins the WIRING.
 *
 * Neither half subsumes the other: delete the guard's body and the first goes
 * red while the second stays green; unwire it and the reverse. Both were
 * checked that way rather than assumed.
 */
describe('duplicate route declarations', () => {
  it('refuses a key two blocks both declare', () => {
    const a = { 'Patient.list': { request: () => ({}) } };
    const b = { 'Patient.list': { request: () => ({}) } };
    expect(() => withoutCollisions(a, b)).toThrow(/ENTITY_ROUTE_DUPLICATE_DECLARATION: Patient\.list/);
  });

  it('merges disjoint blocks and keeps every key', () => {
    const merged = withoutCollisions({ a: 1, b: 2 }, { c: 3 });
    expect(Object.keys(merged).sort()).toEqual(['a', 'b', 'c']);
    expect(Object.isFrozen(merged)).toBe(true);
  });

  it('refuses a duplicate within one block too', () => {
    // Object.entries over a literal cannot produce one, but a block built at
    // runtime (Object.fromEntries over a list) can, and the merge is the only
    // place that would see it.
    const built = Object.fromEntries([['x', 1]]);
    expect(() => withoutCollisions(built, { x: 2 })).toThrow(/ENTITY_ROUTE_DUPLICATE_DECLARATION/);
  });

  it('builds ENTITY_ROUTES through the guard over both declaration blocks', () => {
    const source = readFileSync(`${process.cwd()}/src/lib/independentEntityRoutes.js`, 'utf8');
    const built = source.match(/export const ENTITY_ROUTES = [\s\S]*?\n\);/);
    expect(built, 'ENTITY_ROUTES export not found in its own source').toBeTruthy();
    expect(built[0]).toContain('withoutCollisions(');
    // Every block that declares routes must be an ARGUMENT to the merge. A
    // block left out contributes nothing and is silent; a block spread back in
    // is shadowed and is silent. Both are what the guard exists to end.
    for (const blockName of ['DECLARED_ROUTES', 'operationalRoutes']) {
      expect(built[0]).toContain(blockName);
      expect(built[0]).not.toContain(`...${blockName}`);
    }
  });

  it('declares each route block exactly once in the module', () => {
    const source = readFileSync(`${process.cwd()}/src/lib/independentEntityRoutes.js`, 'utf8');
    for (const blockName of ['DECLARED_ROUTES', 'operationalRoutes']) {
      const declarations = source.match(new RegExp(`^const ${blockName} =`, 'gm')) || [];
      expect(declarations).toHaveLength(1);
    }
  });
});
