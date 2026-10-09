/**
 * The seam under `base44.entities.<Entity>.subscribe(callback)`.
 *
 * This is the one entity operation `independentEntityRoutes.js` structurally
 * cannot express, and the reason is its SHAPE rather than its authorization.
 * Every route there is promise-shaped — `(...args) => Promise` — because the
 * SDK methods they stand in for are, and the adapter keeps the whole path
 * promise-shaped on purpose so a caller never has to handle two shapes.
 * `subscribe` is the exception: it returns an UNSUBSCRIBE FUNCTION
 * synchronously, and its one call site does `return unsubscribe` straight out
 * of a `useEffect`. A promise there is not a cleanup function, so React would
 * never tear the subscription down. So a feed is declared here, beside the
 * routes rather than among them.
 *
 * **What the owned side can actually offer, said plainly.** Base44 pushes.
 * This polls a change cursor and calls the same callback with the same event
 * shape. That is not a stand-in for a push, and three differences are real:
 *
 * 1. **Changes COALESCE.** A row written twice between two ticks is one event
 *    here and two in Base44. Every event carries `coalesced: true` so a caller
 *    counting events can tell. The one existing call site —
 *    `RealtimeFaxStatusTracker` — only invalidates a react-query key, so
 *    collapsing two invalidations into one changes nothing it does; a future
 *    caller that tallied events would be wrong, and would have to read this.
 * 2. **Deletes are INVISIBLE.** A cursor over "changed since" cannot see a row
 *    that is gone. A feed therefore declares `emits`, and `'delete'` is not in
 *    any of them. A caller needing deletions needs a different mechanism, not
 *    a wider cursor.
 * 3. **The backlog is NOT replayed.** Base44 delivers changes that happen
 *    after you subscribe. So the first tick establishes the cursor and emits
 *    nothing. Emitting what it found instead would fire the callback once per
 *    recent row at mount, which on the fax tracker would be fifty
 *    invalidations of a query that had just loaded.
 *
 * **The poll is not new load.** `RealtimeFaxStatusTracker` already refetches
 * its own query every five seconds while live updates are enabled, and the
 * subscription only invalidates that same query — so the push was an
 * accelerator over a poll that was already there, not the thing keeping the
 * screen fresh. A feed's interval is declared per entity for that reason:
 * the right value is a property of the screen, not of this module.
 *
 * **No authorization of its own.** A tick is an ordinary call through the
 * adapter's `portedCall`, so the tenant fence, the session lease and the
 * contract's own authorization decide what a tick can see. A caller subscribed
 * to an entity sees changes to the rows they could have read, because that is
 * the only thing the contract will answer with.
 */

/** Raised when a feed is declared for an entity the service cannot answer for. */
export const FEED_UNAVAILABLE = 'STAGING_ENTITY_FEED_UNAVAILABLE';

/**
 * How many consecutive failing ticks end a subscription.
 *
 * A tick that fails tells the caller nothing, because the SDK's `subscribe`
 * has no error channel and inventing one would be this seam doing more than
 * the original. But a subscription that polls a refusing service every five
 * seconds for as long as a screen is open is worse than one that stops: it is
 * load nobody asked for and a log nobody reads. So failures are tolerated —
 * a deploy or a dropped connection should not kill a live screen — and a run
 * of them stops the poll and says so once.
 */
export const FEED_FAILURE_LIMIT = 5;

const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * The declared feeds.
 *
 * **Empty, and that is a measurement rather than an oversight.** A feed names
 * a handler, and `check:entity-routes` refuses a declaration whose handler the
 * shipped registry does not carry — which is the property that keeps a
 * declaration from reading as coverage it does not have. The fax status
 * tracker's feed needs `FaxLog` to have a table and a change contract, and the
 * schema planner excludes a `preserved_paused` entity by construction
 * (`tools-entity-schema-plan.mjs`, `CARRIED`). So the mechanism lands first and
 * the declaration rides the change that gives the entity a table.
 *
 * Closing it takes one entry of the shape below and a handler to point it at:
 *
 *   FaxLog: {
 *     function: 'listFaxLogChanges',
 *     intervalMs: 5000,
 *     emits: ['create', 'update'],
 *     request: cursor => ({ since: cursor?.at ?? null, since_id: cursor?.id ?? null, limit: 100 }),
 *   }
 *
 * and a handler answering `{ changes: [{ id, type, changed_at }], cursor: { at, id } }`,
 * where `cursor` is the store's own head for the rows that caller may read.
 * The head is part of the answer rather than something this module derives,
 * because a first tick that finds no changes still has to establish a baseline
 * and there is no row to take one from.
 */
export const ENTITY_FEEDS = Object.freeze(Object.create(null));

/** The feed declared for an entity, or null. */
export function feedFor(entity) {
  return Object.hasOwn(ENTITY_FEEDS, entity) ? ENTITY_FEEDS[entity] : null;
}

/**
 * Read one change the service returned.
 *
 * A change the feed cannot read is DROPPED rather than emitted with holes, and
 * the cursor does not advance past it: a malformed row that moved the cursor
 * would silently skip every change behind it. Dropping it means the next tick
 * sees it again, which is the right failure — a repeated refusal is visible
 * and a skipped change is not.
 */
function readChange(change, emits) {
  if (!isObject(change)) return null;
  const { id, type, changed_at: changedAt } = change;
  if (typeof id !== 'string' || !id || id.length > 200) return null;
  if (typeof type !== 'string' || !emits.includes(type)) return null;
  if (typeof changedAt !== 'string' || !changedAt || changedAt.length > 64) return null;
  return { id, type, changed_at: changedAt };
}

/**
 * Read the cursor position the service reported.
 *
 * Shape-checked for the same reason a change is: a cursor the next tick cannot
 * send is worse than no cursor, because it would be sent anyway and the
 * contract would refuse every tick from then on.
 */
function readCursor(cursor) {
  if (!isObject(cursor)) return null;
  const { at, id } = cursor;
  if (typeof at !== 'string' || !at || at.length > 64) return null;
  if (typeof id !== 'string' || !id || id.length > 200) return null;
  return { at, id };
}

/**
 * Build the subscriber for one entity's feed.
 *
 * `serve` is the adapter's `portedCall`. `schedule` is the repeating timer,
 * taken as an argument so the tests drive ticks rather than waiting for them —
 * a suite that slept would be asserting the clock.
 */
export function createFeedSubscriber({ entity, feed, serve, schedule, onStop = (_reason) => {} }) {
  if (!isObject(feed) || typeof feed.function !== 'string' || !feed.function
    || !Array.isArray(feed.emits) || !feed.emits.length
    || feed.emits.some(type => !['create', 'update'].includes(type))
    || typeof feed.request !== 'function'
    || !Number.isSafeInteger(feed.intervalMs) || feed.intervalMs < 1000) {
    const error = new Error(FEED_UNAVAILABLE);
    error.code = FEED_UNAVAILABLE;
    error.entity = entity;
    throw error;
  }
  const emits = Object.freeze([...feed.emits]);

  return function subscribe(callback) {
    if (typeof callback !== 'function') {
      const error = new Error(FEED_UNAVAILABLE);
      error.code = FEED_UNAVAILABLE;
      throw error;
    }
    let cursor = null;
    // The first tick establishes the cursor and emits nothing, so a mount does
    // not replay the backlog as if it had just happened. The baseline comes
    // from the ANSWER'S OWN head rather than from the last row it returned,
    // because a first tick that found nothing still has to establish one — and
    // a subscriber left with a null cursor would ask "since the beginning" on
    // its next tick and emit every recent row as if it had just arrived.
    let established = false;
    let stopped = false;
    let failures = 0;
    let inFlight = false;

    const tick = async () => {
      // One tick at a time. A slow tick overlapping the next would ask twice
      // from the same cursor and emit every change in it twice.
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        const answer = await serve(feed.function, feed.request(cursor));
        if (stopped) return;
        failures = 0;
        const rows = Array.isArray(answer?.changes) ? answer.changes : [];
        const changes = rows.map(change => readChange(change, emits)).filter(Boolean);
        const head = readCursor(answer?.cursor);
        // Advance over what was READ, never over what was returned. When every
        // row parsed, the answer's own head is the position — it is ahead of
        // the last row when the service capped the page, and it is the only
        // thing available when the page was empty. When a row did not parse,
        // the cursor stops at the last one that did, so the change this build
        // could not read stays ahead of it and the next tick sees it again.
        if (changes.length === rows.length && head) {
          cursor = head;
        } else if (changes.length) {
          const last = changes.at(-1);
          cursor = { at: last.changed_at, id: last.id };
        }
        if (!established) {
          // A first tick with no head to take is NOT established: asking again
          // from a null cursor is right, and claiming a baseline we do not have
          // would turn the next answer's backlog into events.
          established = cursor !== null;
          return;
        }
        for (const change of changes) {
          if (stopped) return;
          // The SDK's own event shape, plus the one thing this seam knows and
          // a push would not have to say.
          callback({ type: change.type, id: change.id, changed_at: change.changed_at, coalesced: true });
        }
      } catch {
        if (stopped) return;
        failures += 1;
        if (failures >= FEED_FAILURE_LIMIT) {
          stopped = true;
          console.warn(`independentEntityFeeds: stopped the ${entity} feed after ${failures} consecutive failures`);
          cancel();
          onStop({ entity, failures });
        }
      } finally {
        inFlight = false;
      }
    };

    const cancel = schedule(tick, feed.intervalMs);
    if (typeof cancel !== 'function') {
      const error = new Error(FEED_UNAVAILABLE);
      error.code = FEED_UNAVAILABLE;
      throw error;
    }
    // Synchronous and idempotent, because this is what a `useEffect` returns.
    // A tick already in flight is fenced by `stopped` rather than awaited: the
    // component is unmounting and must not be called back.
    return function unsubscribe() {
      if (stopped) return;
      stopped = true;
      cancel();
    };
  };
}

/**
 * The repeating timer the adapter passes in.
 *
 * Separate from the subscriber so the suite can drive ticks directly. It fires
 * the first tick immediately, because a subscription whose cursor is only
 * established one interval later would miss every change in that interval.
 */
export const intervalSchedule = (tick, intervalMs) => {
  const handle = setInterval(tick, intervalMs);
  tick();
  return () => clearInterval(handle);
};
