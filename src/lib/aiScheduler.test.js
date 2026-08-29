import test from "node:test";
import assert from "node:assert/strict";

import { createAIScheduler, isAICancellation, AI_PRIORITY } from "./aiScheduler.js";

/** A promise plus its settle handles, so a test controls when work finishes. */
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Let queued microtasks and the scheduler's drain loop settle. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A task that records when it starts and finishes on demand.
 * `started` is a plain flag so a test can assert a task NEVER ran.
 */
function trackedTask() {
  const d = deferred();
  const task = { started: false, ...d };
  task.fn = () => {
    task.started = true;
    return d.promise;
  };
  return task;
}

test("runs immediately while under the cap", async () => {
  const scheduler = createAIScheduler({ maxConcurrent: 2 });
  const a = trackedTask();
  const b = trackedTask();

  const pa = scheduler.schedule(a.fn);
  const pb = scheduler.schedule(b.fn);
  await tick();

  assert.equal(a.started, true);
  assert.equal(b.started, true);
  assert.equal(scheduler.stats().active, 2);

  a.resolve("A");
  b.resolve("B");
  assert.deepEqual(await Promise.all([pa, pb]), ["A", "B"]);
  await tick();
  assert.equal(scheduler.stats().active, 0);
});

test("caps total in-flight calls and starts queued work as slots free up", async () => {
  const scheduler = createAIScheduler({ maxConcurrent: 2, maxBackgroundConcurrent: 2 });
  const tasks = [trackedTask(), trackedTask(), trackedTask()];
  const promises = tasks.map((t) => scheduler.schedule(t.fn));
  await tick();

  assert.deepEqual(tasks.map((t) => t.started), [true, true, false]);
  assert.equal(scheduler.stats().queued, 1);

  tasks[0].resolve("first");
  await promises[0];
  await tick();

  assert.equal(tasks[2].started, true, "freeing a slot starts the queued task");
  tasks[1].resolve("second");
  tasks[2].resolve("third");
  assert.deepEqual(await Promise.all(promises), ["first", "second", "third"]);
});

test("reserves headroom so an interactive call never waits behind background work", async () => {
  const scheduler = createAIScheduler({ maxConcurrent: 3, maxBackgroundConcurrent: 2 });
  const background = [trackedTask(), trackedTask(), trackedTask()];
  background.forEach((t) => scheduler.schedule(t.fn, { priority: "background" }));
  await tick();

  // Only two background calls may run at once, even though the total cap is 3.
  assert.deepEqual(background.map((t) => t.started), [true, true, false]);

  // The reserved slot is available to interactive work right away.
  const interactive = trackedTask();
  scheduler.schedule(interactive.fn, { priority: "interactive" });
  await tick();

  assert.equal(interactive.started, true);
  assert.equal(background[2].started, false, "background stays capped");
  const stats = scheduler.stats();
  assert.equal(stats.activeBackground, 2);
  assert.equal(stats.activeInteractive, 1);

  background.forEach((t) => t.resolve("ok"));
  interactive.resolve("ok");
});

test("interactive work jumps ahead of queued background work", async () => {
  const scheduler = createAIScheduler({ maxConcurrent: 1, maxBackgroundConcurrent: 1 });
  const running = trackedTask();
  const queuedBackground = trackedTask();
  const queuedInteractive = trackedTask();

  scheduler.schedule(running.fn, { priority: "background" });
  await tick();
  scheduler.schedule(queuedBackground.fn, { priority: "background" });
  scheduler.schedule(queuedInteractive.fn, { priority: "interactive" });
  await tick();

  assert.deepEqual(
    [queuedBackground.started, queuedInteractive.started],
    [false, false],
    "both wait while the single slot is busy",
  );

  running.resolve("done");
  await tick();

  assert.equal(queuedInteractive.started, true, "interactive is served first");
  assert.equal(queuedBackground.started, false);

  queuedInteractive.resolve("done");
  await tick();
  assert.equal(queuedBackground.started, true, "background still runs — no starvation");
  queuedBackground.resolve("done");
});

test("keeps same-priority work FIFO", async () => {
  const scheduler = createAIScheduler({ maxConcurrent: 1 });
  const order = [];
  const blocker = trackedTask();
  scheduler.schedule(blocker.fn);
  await tick();

  for (const label of ["a", "b", "c"]) {
    scheduler.schedule(async () => { order.push(label); });
  }

  blocker.resolve("done");
  await tick();
  await tick();

  assert.deepEqual(order, ["a", "b", "c"]);
});

test("frees the slot when a task rejects, and when it throws synchronously", async () => {
  const scheduler = createAIScheduler({ maxConcurrent: 1 });

  await assert.rejects(
    () => scheduler.schedule(() => Promise.reject(new Error("boom"))),
    /boom/,
  );
  await tick();
  assert.equal(scheduler.stats().active, 0);

  await assert.rejects(
    () => scheduler.schedule(() => { throw new Error("sync boom"); }),
    /sync boom/,
  );
  await tick();
  assert.equal(scheduler.stats().active, 0, "a synchronous throw must not leak the slot");

  // The gate still works after failures.
  assert.equal(await scheduler.schedule(async () => "still working"), "still working");
});

test("aborting queued work drops it before it is ever billed", async () => {
  const scheduler = createAIScheduler({ maxConcurrent: 1 });
  const blocker = trackedTask();
  const abandoned = trackedTask();
  const controller = new AbortController();

  scheduler.schedule(blocker.fn);
  await tick();
  const abandonedPromise = scheduler.schedule(abandoned.fn, {
    priority: "background",
    signal: controller.signal,
  });
  await tick();
  assert.equal(scheduler.stats().queued, 1);

  controller.abort();

  await assert.rejects(() => abandonedPromise, (err) => isAICancellation(err));
  assert.equal(abandoned.started, false, "the cancelled call is never made");
  assert.equal(scheduler.stats().queued, 0);

  // The freed queue slot doesn't wedge the scheduler.
  blocker.resolve("done");
  await tick();
  assert.equal(await scheduler.schedule(async () => "next"), "next");
});

test("an already-aborted signal is rejected without running the task", async () => {
  const scheduler = createAIScheduler({ maxConcurrent: 2 });
  const task = trackedTask();
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () => scheduler.schedule(task.fn, { signal: controller.signal }),
    (err) => isAICancellation(err),
  );
  assert.equal(task.started, false);
  assert.equal(scheduler.stats().active, 0);
});

test("aborting after a task has started lets it finish normally", async () => {
  const scheduler = createAIScheduler({ maxConcurrent: 2 });
  const task = trackedTask();
  const controller = new AbortController();

  const promise = scheduler.schedule(task.fn, { signal: controller.signal });
  await tick();
  assert.equal(task.started, true);

  controller.abort(); // too late to un-bill it — the call is already out
  task.resolve("completed");

  assert.equal(await promise, "completed");
  await tick();
  assert.equal(scheduler.stats().active, 0);
});

test("normalizes unusable caps and unknown priorities instead of deadlocking", async () => {
  // A zero/negative cap would wedge every call forever.
  const scheduler = createAIScheduler({ maxConcurrent: 0, maxBackgroundConcurrent: 0 });
  assert.equal(await scheduler.schedule(async () => "ran"), "ran");

  // A background cap above the total cap can't defeat the reserved headroom.
  const clamped = createAIScheduler({ maxConcurrent: 2, maxBackgroundConcurrent: 99 });
  assert.equal(clamped.stats().maxBackgroundConcurrent, 2);

  // An unrecognized priority is treated as interactive, not dropped.
  assert.equal(await clamped.schedule(async () => "ok", { priority: "whatever" }), "ok");
  assert.equal(AI_PRIORITY.interactive < AI_PRIORITY.background, true);
});
