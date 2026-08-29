import { StrictMode, useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';

// Real scheduler, stubbed SDK: these tests cover the hook's integration with
// the app-wide AI budget, so only the network boundary is faked.
const { invokeLLM } = vi.hoisted(() => ({ invokeLLM: vi.fn() }));
vi.mock('@/api/base44Client', () => ({
  base44: { integrations: { Core: { InvokeLLM: invokeLLM } } },
}));

import { useAICall } from '@/hooks/useAICall';
import { aiScheduler, createAIScheduler, isAICancellation } from '@/lib/aiScheduler';

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/**
 * Mounts the hook and fires one call on mount, reporting how it settled.
 * Deliberately reports even after unmount — an unmounted card's call settling
 * as a cancellation is exactly what these tests assert.
 */
function Caller({ options = {}, params = { prompt: 'hi' }, onSettled, hookDefaults }) {
  const ai = useAICall(hookDefaults);
  useEffect(() => {
    ai.run(params, options)
      .then((result) => onSettled?.({ status: 'resolved', result }))
      .catch((error) => onSettled?.({ status: 'rejected', error }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire exactly once on mount
  }, []);
  return null;
}

beforeEach(() => {
  invokeLLM.mockReset();
});

describe('useAICall + AI budget', () => {
  it('resolves a normal call and records the result', async () => {
    const d = deferred();
    invokeLLM.mockReturnValueOnce(d.promise);
    const onSettled = vi.fn();

    render(<Caller onSettled={onSettled} />);
    expect(invokeLLM).toHaveBeenCalledTimes(1);

    await act(async () => { d.resolve({ ok: true }); });
    await waitFor(() => expect(onSettled).toHaveBeenCalledWith({ status: 'resolved', result: { ok: true } }));
  });

  it('drops a still-queued call when the component unmounts, so it is never billed', async () => {
    // Saturate the shared background budget the way a busy analysis page does,
    // so the card under test is QUEUED rather than already in flight.
    const gate = deferred();
    invokeLLM.mockReturnValue(gate.promise);
    const { maxBackgroundConcurrent } = aiScheduler.stats();
    const blockers = [];
    try {
      for (let i = 0; i < maxBackgroundConcurrent; i += 1) {
        blockers.push(render(<Caller options={{ priority: 'background' }} />));
      }
      await act(async () => {});
      expect(invokeLLM).toHaveBeenCalledTimes(maxBackgroundConcurrent);

      const onSettled = vi.fn();
      const queued = render(
        <Caller options={{ priority: 'background', cancelOnUnmount: true }} onSettled={onSettled} />
      );
      await act(async () => {});
      expect(invokeLLM).toHaveBeenCalledTimes(maxBackgroundConcurrent); // still waiting its turn

      queued.unmount();
      await act(async () => { await new Promise((r) => setTimeout(r, 5)); });

      expect(invokeLLM).toHaveBeenCalledTimes(maxBackgroundConcurrent); // never sent
      expect(onSettled).toHaveBeenCalledTimes(1);
      const settled = onSettled.mock.calls[0][0];
      expect(settled.status).toBe('rejected');
      expect(isAICancellation(settled.error)).toBe(true);
    } finally {
      // Release the shared budget even if an assertion above failed, so one
      // failure can't cascade into every later test in this file.
      await act(async () => { gate.resolve({ ok: true }); });
      blockers.forEach((b) => b.unmount());
    }
  });

  it('a StrictMode remount does not drop the in-flight call', async () => {
    const d = deferred();
    invokeLLM.mockReturnValue(d.promise);
    const onSettled = vi.fn();

    render(
      <StrictMode>
        <Caller options={{ priority: 'background', cancelOnUnmount: true }} onSettled={onSettled} />
      </StrictMode>
    );

    // StrictMode double-invokes effects (mount → cleanup → mount). The deferred
    // abort must be cancelled by the remount, leaving the call alive.
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    await act(async () => { d.resolve({ ok: true }); });

    await waitFor(() => expect(onSettled).toHaveBeenCalled());
    const settled = onSettled.mock.calls.at(-1)[0];
    expect(settled.status).toBe('resolved');
  });

  it('passes retry/timeout options through while keeping budget options out of them', async () => {
    // A non-retryable status proves the retry policy still reaches runWithRetry.
    const failure = Object.assign(new Error('bad request'), { status: 400 });
    invokeLLM.mockRejectedValue(failure);
    const onSettled = vi.fn();

    render(
      <Caller
        hookDefaults={{ priority: 'background', retries: 2, backoffMs: 0 }}
        onSettled={onSettled}
      />
    );

    await waitFor(() => expect(onSettled).toHaveBeenCalled());
    expect(onSettled.mock.calls.at(-1)[0].status).toBe('rejected');
    expect(invokeLLM).toHaveBeenCalledTimes(1); // 400 is not retried
    // Budget-only options must never leak into the SDK payload.
    expect(invokeLLM).toHaveBeenCalledWith({ prompt: 'hi' });
  });
});

describe('AI budget under page-level fan-out', () => {
  it('queues background work past the cap and drops what is still queued when cancelled', async () => {
    // Mirrors an analysis page mounting more auto-fired cards than the budget
    // allows to run at once.
    const scheduler = createAIScheduler({ maxConcurrent: 2, maxBackgroundConcurrent: 2 });
    const started = [];
    const gate = deferred();
    const controller = new AbortController();

    const schedule = (label, signal) =>
      scheduler.schedule(() => { started.push(label); return gate.promise; }, {
        priority: 'background',
        signal,
      });

    const promises = [
      schedule('a'), schedule('b'), schedule('c'),
      schedule('d', controller.signal),
    ];
    promises.forEach((p) => p.catch(() => {})); // settled below; avoid unhandled rejections
    await act(async () => {});

    expect(started).toEqual(['a', 'b']);
    expect(scheduler.stats().queued).toBe(2);

    controller.abort();
    await expect(promises[3]).rejects.toSatisfy(isAICancellation);
    expect(started).not.toContain('d');

    await act(async () => { gate.resolve('done'); });
    await waitFor(() => expect(started).toEqual(['a', 'b', 'c']));
  });
});
