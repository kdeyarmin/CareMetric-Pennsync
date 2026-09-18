// Test-only route lifecycle ownership. A ready React screen can still have a
// public image fetch/fulfill in progress; disposing its page is not a network test.
export function createRouteWorkTracker({ timeoutMs = 15000 } = {}) {
  const pending = new Set();
  return {
    timeoutMs,
    track(work) {
      const operation = Promise.resolve().then(work);
      pending.add(operation);
      const settled = () => { pending.delete(operation); };
      operation.then(settled, settled);
      return operation;
    },
    async drain({ deadline = performance.now() + timeoutMs } = {}) {
      let timer;
      try {
        await Promise.race([
          (async () => { while (pending.size) await Promise.all([...pending]); })(),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('ACTUAL_APP_ROUTE_DRAIN_TIMEOUT')), Math.max(1, deadline - performance.now()));
          }),
        ]);
      } finally { clearTimeout(timer); }
    },
  };
}

export async function settlePageRoutes(page, tracker) {
  // Check the current DOM too: an image element can already exist while its
  // route callback has not yet reached Node. No image response is synthesized,
  // retried, omitted, or allowed to fail silently by this barrier.
  const deadline = performance.now() + tracker.timeoutMs;
  await page.waitForFunction(() => Array.from(globalThis.document.images)
    .every(image => image.complete && image.naturalWidth > 0), null, { timeout: Math.max(1, deadline - performance.now()) });
  await tracker.drain({ deadline });
}
