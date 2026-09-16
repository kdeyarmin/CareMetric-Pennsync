import { drainTimedOutAI } from "./aiCall.js";

/**
 * App-wide AI (LLM) call budget: a concurrency gate with priority classes.
 *
 * WHY
 * Feature-rich pages mount many independent AI cards that auto-fire on mount.
 * Limit the initial burst and reserve capacity for work a person is waiting on.
 * Queued, cancelled work never starts a paid provider call.
 *
 * WHAT THIS DOES
 * Caps total/background in-flight calls; interactive first and FIFO per class.
 * Drops queued work on cancellation. Known unresolved SDK promises retain their
 * slots after a UI timeout until their underlying promises settle. A browser
 * cannot prove whether server-side work continued after an SDK rejection.
 */
export const AI_PRIORITY = { interactive: 0, background: 1 };
const DEFAULT_PRIORITY = "interactive";
export function isAICancellation(err) { return err?.code === "AI_CANCELLED"; }
function cancellationError() {
  const err = new Error("AI request cancelled before it started");
  err.code = "AI_CANCELLED";
  return err;
}
function priorityRank(priority) {
  const rank = AI_PRIORITY[priority];
  return typeof rank === "number" ? rank : AI_PRIORITY[DEFAULT_PRIORITY];
}

export function createAIScheduler({ maxConcurrent = 4, maxBackgroundConcurrent = 3 } = {}) {
  const totalCap = Math.max(1, maxConcurrent);
  const backgroundCap = Math.min(Math.max(1, maxBackgroundConcurrent), totalCap);
  let active = 0, activeBackground = 0, seq = 0;
  /** @type {Array<{rank:number, seq:number, isBackground:boolean, start:Function, detach:Function}>} */
  const queue = [];
  const canStart = (task) => active < totalCap && (!task.isBackground || activeBackground < backgroundCap);
  function drain() {
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
   * @param {() => Promise<any>} fn
   * @param {Object} [opts]
   * @param {'interactive'|'background'} [opts.priority='interactive']
   * @param {AbortSignal} [opts.signal]
   * @returns {Promise<any>}
   */
  function schedule(fn, { priority = DEFAULT_PRIORITY, signal } = {}) {
    if (signal?.aborted) return Promise.reject(cancellationError());
    return new Promise((resolve, reject) => {
      const task = {
        rank: priorityRank(priority), seq: (seq += 1),
        isBackground: priorityRank(priority) >= AI_PRIORITY.background,
        detach: () => {},
        start: () => {
          let settled;
          try { settled = Promise.resolve(fn()); }
          catch (err) { settled = Promise.reject(err); }
          settled.then(
            value => { resolve(value); release(task); },
            error => {
              reject(error);
              const draining = drainTimedOutAI(error);
              if (draining) draining.then(() => release(task), () => release(task));
              else release(task);
            },
          );
        },
      };
      if (signal) {
        const onAbort = () => {
          const index = queue.indexOf(task);
          if (index === -1) return;
          queue.splice(index, 1); task.detach(); reject(cancellationError());
        };
        signal.addEventListener("abort", onAbort, { once: true });
        task.detach = () => signal.removeEventListener("abort", onAbort);
      }
      const at = queue.findIndex((q) => q.rank > task.rank);
      if (at === -1) queue.push(task); else queue.splice(at, 0, task);
      drain();
    });
  }
  function stats() {
    return {
      active, activeBackground, activeInteractive: active - activeBackground,
      queued: queue.length, queuedBackground: queue.filter((t) => t.isBackground).length,
      maxConcurrent: totalCap, maxBackgroundConcurrent: backgroundCap,
    };
  }
  return { schedule, stats };
}
export const aiScheduler = createAIScheduler();
