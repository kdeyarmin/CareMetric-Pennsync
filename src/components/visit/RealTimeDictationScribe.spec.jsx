import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

vi.mock('@/functions/structureDictatedVisit', () => ({ structureDictatedVisit: vi.fn() }));

/**
 * A recognizer that refuses to start is the case this panel could not survive.
 * `onend` restarts whenever `_shouldBeListening` is still set, so a refusal —
 * which cannot succeed on retry — used to restart and refuse again, forever.
 *
 * That matters more since this component started REQUIRING on-device processing:
 * `service-not-allowed` is exactly what a browser raises when it cannot honour
 * that requirement, so the change that protects the audio is also the change
 * that makes the refusal common. The loop had to be closed in the same breath.
 */
function installFakeRecognizer({ available } = {}) {
  const starts = [];
  // `processLocally` sits on the prototype, as an interface attribute does, so
  // the helper's `in` check finds it on an instance that has never set it.
  class FakeSpeechRecognition {
    constructor() {
      this.continuous = false;
      this.interimResults = false;
      this.lang = '';
      this.maxAlternatives = 0;
      this.onresult = null;
      this.onerror = null;
      this.onend = null;
      this.started = false;
      FakeSpeechRecognition.instance = this;
    }
    // Every attempt is recorded, including a rejected one, so a test can assert
    // that a second attempt was never MADE rather than merely that it failed.
    start() {
      starts.push(this.processLocally === true);
      if (this.started) {
        const error = new Error('recognition has already started');
        error.name = 'InvalidStateError';
        throw error;
      }
      this.started = true;
    }
    stop() { this.started = false; }
    abort() { this.started = false; }
  }
  FakeSpeechRecognition.prototype.processLocally = false;
  if (available) FakeSpeechRecognition.available = available;
  vi.stubGlobal('SpeechRecognition', FakeSpeechRecognition);
  const current = () => FakeSpeechRecognition.instance;
  return {
    starts,
    current,
    // A real `end` event means the session is over, so the recognizer is no
    // longer started by the time the handler runs. Driving `onend` directly
    // without clearing it would let a double-start throw be swallowed and read
    // as a successful restart.
    endSession: () => { current().started = false; current().onend(); },
  };
}

const clickStart = async () => {
  await act(async () => {
    screen.getByRole('button', { name: /start dictation/i }).click();
  });
};

describe('RealTimeDictationScribe refusing to start', () => {
  let Scribe;

  // The realm gate pins its authority snapshot on the first open and reads the
  // browser authority epoch captured at module load. The shared test setup clears
  // web storage after every test, which rotates that epoch, so a realm opened
  // once for the file is revoked before the second test and can never reopen —
  // leaving tests two onward with no recognizer at all, which reads exactly like
  // the component failing to construct one. Resetting the module graph per test
  // is the house pattern for this (see `authorityBoundFileDrops.spec.js`), and
  // the component has to come from the same fresh graph as the gate.
  beforeEach(async () => {
    vi.resetModules();
    const { openTenantSdkRealm } = await import('@/lib/tenantSdkRealmGate');
    Scribe = (await import('./RealTimeDictationScribe')).default;
    expect(openTenantSdkRealm('scribe-refusal')).toBe(true);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('does not restart after a refusal it asked for, and says so readably', async () => {
    const fake = installFakeRecognizer({ available: async () => 'available' });
    render(<Scribe />);
    await clickStart();
    // The local requirement was applied before the first start, not after it.
    expect(fake.starts).toEqual([true]);

    await act(async () => {
      fake.current().onerror({ error: 'service-not-allowed' });
      fake.endSession();
    });

    // THE ASSERTION THIS FILE EXISTS FOR. Without `_shouldBeListening` being
    // cleared in `onerror`, `onend` starts it again and the refusal repeats.
    expect(fake.starts).toEqual([true]);
    expect(screen.getByText(/can't transcribe on its own/i)).toBeInTheDocument();
    // And the raw error code is NOT what a nurse is shown.
    expect(screen.queryByText(/service-not-allowed/i)).not.toBeInTheDocument();
  });

  it('closes the same loop when the refusal was not ours, without claiming it was', async () => {
    // No `available()`, so no local requirement was made. A refusal here is the
    // user agent declining the requested service for its own reasons, and
    // saying "your audio isn't sent anywhere else" about it would be false.
    const fake = installFakeRecognizer();
    render(<Scribe />);
    await clickStart();
    expect(fake.starts).toEqual([false]);

    await act(async () => {
      fake.current().onerror({ error: 'service-not-allowed' });
      fake.endSession();
    });

    expect(fake.starts).toEqual([false]);
    expect(screen.getByText(/Microphone error: service-not-allowed/i)).toBeInTheDocument();
    expect(screen.queryByText(/can't transcribe on its own/i)).not.toBeInTheDocument();
  });

  it('still auto-restarts after a transient end, which is what the fix must not break', async () => {
    const fake = installFakeRecognizer();
    render(<Scribe />);
    await clickStart();

    // No error: a browser ending a session on its own while the nurse is still
    // dictating is what the restart is FOR, so clearing the flag on a refusal
    // must not have cleared it here.
    await act(async () => { fake.endSession(); });
    expect(fake.starts).toHaveLength(2);
  });

  // Requiring on-device processing introduced an await between the tap and
  // `start()`. `isListening` stays false across it and the button stays live, so
  // two taps enter the start branch with the same stale state and both resume
  // against ONE recognizer — where the second `start()` is an InvalidStateError.
  it('starts once when two taps land while the availability check is pending', async () => {
    let settle;
    const fake = installFakeRecognizer({
      available: () => new Promise((resolve) => { settle = resolve; }),
    });
    render(<Scribe />);

    await clickStart();
    await clickStart();
    // Nothing can have started yet: the on-device answer has not come back.
    expect(fake.starts).toEqual([]);

    await act(async () => { settle('available'); });

    // Only the newer tap starts. Without the generation guard both continuations
    // start the same recognizer and the second throws.
    expect(fake.starts).toEqual([true]);
    expect(screen.queryByText(/Unable to start dictation/i)).not.toBeInTheDocument();
  });
});