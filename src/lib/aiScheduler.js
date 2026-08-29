/**
 * App-wide AI (LLM) call budget: a concurrency gate with priority classes.
 *
 * WHY
 * Feature-rich pages mount many independent AI cards that each auto-fire on
 * mount — the OASIS Analyzer alone starts nine (comprehensive review, quality
 * assurance, data validation, rescoring, predictive outcomes, documentation
 * assistant, document reviewer, workflow execution, compliance review). They
 * all hit the provider in the same tick, which costs the most where it helps
 * least: the provider rate-limits the burst, `runWithRetry` retries the
 * rejections (re-billing the same work), and a call the clinician is actually
 * waiting on queues behind eight background ones.
 *
 * WHAT THIS DOES
 *   - Caps how many LLM calls are in flight app-wide (`maxConcurrent`).
 *   - Caps background (auto-fired) calls below that (`maxBackgroundConcurrent`),
 *     so a user-initiated call always has headroom and never waits behind a
 *     wall of background work.
 *   - Runs interactive work first; FIFO within a priority class, so no call
 *     starves.
 *   - Drops still-QUEUED work when the caller aborts it (unmounted, superseded)
 *     — that call is never made, so it is never billed.
 *
 * This changes only the TIMING of calls, never their outcome: every scheduled
 * task still runs exactly once and settles with its own result, unless the
 * caller explicitly aborts it before it starts.
 *
 * Pure and framework-free (unit-tested with `node --test`); `useAICall` wires
 * it to the Base44 SDK.
 */

/** Priority classes, lowest number = scheduled first. */
export const AI_PRIORITY = {
  /** A person is waiting on this right now (button click, submit). */
  interactive: 0,
  /** Fired automatically on mount/data change; nobody is watching the clock. */
  background: 1,
};

const DEFAULT_PRIORITY = "interactive";

/** Error thrown for a queued task the caller aborted before it started. */
export function isAICancellation(err) {
  return err?.code === "AI_CANCELLED";
}

function cancellationError() {
  const err = new Error("AI request cancelled before it started");
  err.code = "AI_CANCELLED";
  return err;
}

function priorityRank(priority) {
  const rank = AI_PRIORITY[priority];
  return typeof rank === "number" ? rank : AI_PRIORITY[DEFAULT_PRIORITY];
}

/**
 * Create a scheduler. The app uses the shared `aiScheduler` singleton below;
 * tests create isolated instances.
 *
 * @param {Object} [opts]
 * @param {number} [opts.maxConcurrent=4]            Total in-flight cap.
 * @param {number} [opts.maxBackgroundConcurrent=3]  Cap for background work;
 *   keeping this below maxConcurrent reserves headroom for interactive calls.
 */
export function createAIScheduler({ maxConcurrent = 4, maxBackgroundConcurrent = 3 } = {}) {
  // A non-positive cap would deadlock the queue; a background cap above the
  // total cap would silently defeat the reserved interactive headroom.
  const totalCap = Math.max(1, maxConcurrent);
  const backgroundCap = Math.min(Math.max(1, maxBackgroundConcurrent), totalCap);

  let active = 0;
  let activeBackground = 0;
  let seq = 0;
  /** @type {Array<{rank:number, seq:number, isBackground:boolean, start:Function, detach:Function}>} */
  const queue = [];

  const canStart = (task) => {
    if (active >= totalCap) return false;
    if (task.isBackground && activeBackground >= backgroundCap) return false;
    return true;
  };

  function drain() {
    // Scan rather than peeking at the head: when background work is saturated
    // but the total cap has room, a later interactive task is still runnable.
    // The queue is kept in (rank, seq) order, so the first runnable entry is
    // always the right one to start.
    while (active < totalCap) {
      const index = queue.findIndex(canStart);
      if (index === -1) return;
      const [task] = queue.splice(index, 1);
      task.detach();
      active += 1;
      if (task.isBackground) activeBackground += 1;
      task.start();
    }
  }

  function release(task) {
    active -= 1;
    if (task.isBackground) activeBackground -= 1;
    drain();
  }

  /**
   * Run `fn` when the budget allows.
   *
   * @param {() => Promise<any>} fn  The work (already wrapped in whatever
   *   timeout/retry policy the caller wants) — invoked at most once.
   * @param {Object} [opts]
   * @param {'interactive'|'background'} [opts.priority='interactive']
   * @param {AbortSignal} [opts.signal]  Aborting BEFORE the task starts drops
   *   it (rejects with an AI_CANCELLED error and never calls `fn`). Once
   *   started a task always runs to completion — the SDK has no abort hook, and
   *   a half-billed call is not worth pretending to cancel.
   * @returns {Promise<any>} `fn`'s result.
   */
  function schedule(fn, { priority = DEFAULT_PRIORITY, signal } = {}) {
    if (signal?.aborted) return Promise.reject(cancellationError());

    return new Promise((resolve, reject) => {
      const task = {
        rank: priorityRank(priority),
        seq: (seq += 1),
        isBackground: priorityRank(priority) >= AI_PRIORITY.background,
        detach: () => {},
        start: () => {
          // try/catch so a fn that throws synchronously still releases its slot.
          let settled;
          try {
            settled = Promise.resolve(fn());
          } catch (err) {
            settled = Promise.reject(err);
          }
          settled.then(resolve, reject).finally(() => release(task));
        },
      };

      if (signal) {
        const onAbort = () => {
          const index = queue.indexOf(task);
          if (index === -1) return; // already started — let it finish
          queue.splice(index, 1);
          task.detach();
          reject(cancellationError());
        };
        signal.addEventListener("abort", onAbort, { once: true });
        task.detach = () => signal.removeEventListener("abort", onAbort);
      }

      // Insert in (rank, seq) order so interactive work jumps the queue while
      // same-class work stays FIFO — no starvation within a class.
      const at = queue.findIndex((q) => q.rank > task.rank);
      if (at === -1) queue.push(task);
      else queue.splice(at, 0, task);

      drain();
    });
  }

  /** Observability for tests and debug panels. */
  function stats() {
    return {
      active,
      activeBackground,
      activeInteractive: active - activeBackground,
      queued: queue.length,
      queuedBackground: queue.filter((t) => t.isBackground).length,
      maxConcurrent: totalCap,
      maxBackgroundConcurrent: backgroundCap,
    };
  }

  return { schedule, stats };
}

/**
 * Shared app-wide budget. Defaults leave one slot free for interactive work
 * while three background analyses run, which keeps a busy analysis page
 * responsive without serializing it into a crawl.
 */
export const aiScheduler = createAIScheduler();
