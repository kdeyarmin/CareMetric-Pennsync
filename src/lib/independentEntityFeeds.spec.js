import { describe, expect, it, vi } from 'vitest';

import {
  ENTITY_FEEDS, FEED_FAILURE_LIMIT, FEED_UNAVAILABLE, createFeedSubscriber, feedFor,
} from './independentEntityFeeds.js';

const FEED = Object.freeze({
  function: 'listFaxLogChanges',
  intervalMs: 5000,
  emits: ['create', 'update'],
  request: cursor => ({ since: cursor?.at ?? null, since_id: cursor?.id ?? null, limit: 100 }),
});

const change = (id, type = 'update', at = `2026-10-01T20:00:0${id}.000Z`) => ({ id, type, changed_at: at });
const head = (id, at = `2026-10-01T20:00:0${id}.000Z`) => ({ at, id });

/** A schedule the test drives, so no case waits on a clock. */
function manualSchedule() {
  const state = { tick: null, intervalMs: null, cancelled: 0 };
  const schedule = (tick, intervalMs) => {
    state.tick = tick;
    state.intervalMs = intervalMs;
    return () => { state.cancelled += 1; };
  };
  return { state, schedule };
}

function harness(answers, { feed = FEED, onStop } = {}) {
  const asked = [];
  const serve = vi.fn(async (name, input) => {
    asked.push({ name, input });
    const next = answers.shift();
    if (next instanceof Error) throw next;
    return next;
  });
  const { state, schedule } = manualSchedule();
  const subscribe = createFeedSubscriber({ entity: 'FaxLog', feed, serve, schedule, onStop });
  const seen = [];
  const unsubscribe = subscribe(event => seen.push(event));
  return { asked, seen, serve, state, unsubscribe };
}

describe('the declared feed set', () => {
  it('is empty, which is why subscribe still refuses everywhere', () => {
    // Not a placeholder assertion: a feed names a handler and
    // `check:entity-routes` refuses a declaration the shipped registry cannot
    // answer, so the mechanism has to land before any entity has a table. If
    // this fails, a feed was declared and this case is the reminder to prove
    // the handler exists rather than to update the number.
    expect(Object.keys(ENTITY_FEEDS)).toEqual([]);
    expect(feedFor('FaxLog')).toBe(null);
    expect(feedFor('__proto__')).toBe(null);
  });
});

describe('a feed subscription', () => {
  it('establishes its cursor on the first tick and emits nothing', async () => {
    const { asked, seen, state } = harness([
      { changes: [change('1'), change('2')], cursor: head('2') },
    ]);
    await state.tick();
    // The backlog is not replayed: Base44 delivers what happens after you
    // subscribe, and firing once per recent row at mount would invalidate the
    // tracker's query fifty times over a list that had just loaded.
    expect(seen).toEqual([]);
    expect(asked[0].input).toEqual({ since: null, since_id: null, limit: 100 });
  });

  it('asks from the established cursor and emits one event per change, in order', async () => {
    const { asked, seen, state } = harness([
      { changes: [], cursor: head('0') },
      { changes: [change('1', 'create'), change('2', 'update')], cursor: head('2') },
    ]);
    await state.tick();
    await state.tick();
    expect(asked[1].input).toEqual({ since: '2026-10-01T20:00:00.000Z', since_id: '0', limit: 100 });
    expect(seen).toEqual([
      { type: 'create', id: '1', changed_at: '2026-10-01T20:00:01.000Z', coalesced: true },
      { type: 'update', id: '2', changed_at: '2026-10-01T20:00:02.000Z', coalesced: true },
    ]);
  });

  it('marks every event coalesced, because two writes between ticks are one event here', async () => {
    const { seen, state } = harness([
      { changes: [], cursor: head('0') },
      { changes: [change('1')], cursor: head('1') },
    ]);
    await state.tick();
    await state.tick();
    // The one existing caller only invalidates a query, so collapsing changes
    // nothing it does. A caller that tallied events would be wrong, and this
    // marker is how it can tell.
    expect(seen.every(event => event.coalesced === true)).toBe(true);
  });

  it('does not establish a cursor it was not given, and does not emit the backlog later', async () => {
    const { asked, seen, state } = harness([
      { changes: [] },
      { changes: [change('1'), change('2')], cursor: head('2') },
      { changes: [change('3')], cursor: head('3') },
    ]);
    await state.tick();
    // Nothing to take a baseline from, so the next tick asks from the
    // beginning again rather than claiming a position it does not hold.
    expect(asked[0].input.since).toBe(null);
    await state.tick();
    expect(asked[1].input.since).toBe(null);
    expect(seen).toEqual([]);
    await state.tick();
    expect(seen.map(event => event.id)).toEqual(['3']);
  });

  it('drops a change it cannot read and leaves the cursor behind it', async () => {
    const { asked, seen, state } = harness([
      { changes: [], cursor: head('0') },
      { changes: [change('1'), { id: '2', type: 'update' }, change('3')], cursor: head('9') },
      { changes: [], cursor: head('9') },
    ]);
    await state.tick();
    await state.tick();
    expect(seen.map(event => event.id)).toEqual(['1', '3']);
    // The cursor stops at the last row that PARSED, not at the answer's head:
    // advancing to the head would skip the row this build could not read, and
    // every change behind it, silently. A repeated refusal is visible; a
    // skipped change is not.
    await state.tick();
    expect(asked[2].input).toEqual({ since: '2026-10-01T20:00:03.000Z', since_id: '3', limit: 100 });
  });

  it('never emits a delete, because a cursor cannot see a row that is gone', async () => {
    const { seen, state } = harness([
      { changes: [], cursor: head('0') },
      { changes: [change('1', 'delete'), change('2', 'update')], cursor: head('2') },
    ]);
    await state.tick();
    await state.tick();
    expect(seen.map(event => event.type)).toEqual(['update']);
  });

  it('asks once at a time, so an overlapping tick cannot re-ask from the same cursor', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const { state, serve } = harness([]);
    serve.mockImplementation(async () => { await gate; return { changes: [], cursor: head('0') }; });
    const first = state.tick();
    const second = state.tick();
    release();
    await Promise.all([first, second]);
    expect(serve).toHaveBeenCalledTimes(1);
  });
});

describe('unsubscribing', () => {
  it('is synchronous, idempotent, and cancels the timer', () => {
    const { state, unsubscribe } = harness([]);
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
    unsubscribe();
    unsubscribe();
    // The one call site returns this straight out of a `useEffect`, so a
    // promise here would never be treated as a cleanup function at all.
    expect(state.cancelled).toBe(1);
  });

  it('silences a tick already in flight, rather than calling back a torn-down screen', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const { seen, serve, state, unsubscribe } = harness([]);
    let call = 0;
    serve.mockImplementation(async () => {
      call += 1;
      if (call === 1) return { changes: [], cursor: head('0') };
      await gate;
      return { changes: [change('1')], cursor: head('1') };
    });
    await state.tick();
    const inFlight = state.tick();
    unsubscribe();
    release();
    await inFlight;
    expect(seen).toEqual([]);
  });
});

describe('a failing feed', () => {
  it('tolerates a run of failures short of the limit and recovers', async () => {
    const answers = [{ changes: [], cursor: head('0') }];
    for (let index = 0; index < FEED_FAILURE_LIMIT - 1; index += 1) answers.push(new Error('503'));
    answers.push({ changes: [change('1')], cursor: head('1') });
    const onStop = vi.fn();
    // The count is taken BEFORE the run: the serve double SHIFTS this array,
    // so looping to `answers.length` would stop halfway through.
    const ticks = answers.length;
    const { seen, state } = harness(answers, { onStop });
    for (let index = 0; index < ticks; index += 1) await state.tick();
    // A deploy or a dropped connection must not kill a live screen.
    expect(onStop).not.toHaveBeenCalled();
    expect(seen.map(event => event.id)).toEqual(['1']);
  });

  it('stops after a run of failures rather than polling a refusing service forever', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const answers = [{ changes: [], cursor: head('0') }];
    for (let index = 0; index < FEED_FAILURE_LIMIT; index += 1) answers.push(new Error('503'));
    const onStop = vi.fn();
    const ticks = answers.length;
    const { serve, state } = harness(answers, { onStop });
    for (let index = 0; index < ticks; index += 1) await state.tick();
    expect(onStop).toHaveBeenCalledWith({ entity: 'FaxLog', failures: FEED_FAILURE_LIMIT });
    expect(state.cancelled).toBe(1);
    const asksBefore = serve.mock.calls.length;
    await state.tick();
    // The SDK's `subscribe` has no error channel, so the caller is told
    // nothing; the log is the only place this can be said.
    expect(serve.mock.calls.length).toBe(asksBefore);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('a feed declaration', () => {
  const build = feed => () => createFeedSubscriber({ entity: 'FaxLog', feed, serve: async () => ({}), schedule: () => () => {} });

  it('is refused unless it names a handler, an interval and the events it can emit', () => {
    for (const feed of [
      null,
      { ...FEED, function: '' },
      { ...FEED, emits: [] },
      // `delete` is not emittable by a cursor feed, so a declaration claiming
      // it is refused rather than quietly never firing.
      { ...FEED, emits: ['create', 'delete'] },
      { ...FEED, request: 'not a function' },
      { ...FEED, intervalMs: 999 },
      { ...FEED, intervalMs: 5000.5 },
    ]) {
      expect(build(feed)).toThrow(FEED_UNAVAILABLE);
    }
    expect(build(FEED)).not.toThrow();
  });

  it('refuses a subscriber with no callback to call', () => {
    const subscribe = build(FEED)();
    expect(() => subscribe(undefined)).toThrow(FEED_UNAVAILABLE);
    expect(() => subscribe({})).toThrow(FEED_UNAVAILABLE);
  });
});
