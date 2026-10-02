import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

/**
 * Requiring on-device speech recognition put an `await` between creating the
 * recognizer and registering it in the ref the unmount cleanup disposes. A
 * binding in that window belongs to nobody: the cleanup cannot see it, and the
 * tenant-realm lease it carries is still perfectly current, because unmounting
 * one button does not close the workspace realm. So the continuation would go
 * on to call `start()` and leave the microphone live with no UI left to stop it.
 *
 * These tests are about ownership, not about audio locality — that is
 * `tenantMediaDevices.spec.js` — so they assert only whether `start()` and
 * `abort()` were reached.
 */
function installFakeRecognizer({ available } = {}) {
  const starts = [];
  const aborts = [];
  class FakeSpeechRecognition {
    constructor() {
      this.lang = '';
      this.continuous = false;
      this.interimResults = false;
      this.onresult = null;
      this.onerror = null;
      this.onend = null;
      FakeSpeechRecognition.instances.push(this);
    }
    start() { starts.push(this.processLocally === true); }
    stop() {}
    abort() { aborts.push(this); }
  }
  // An interface attribute lives on the prototype, which is what the helper's
  // `in` check finds on an instance that has never assigned it.
  FakeSpeechRecognition.prototype.processLocally = false;
  FakeSpeechRecognition.instances = [];
  if (available) FakeSpeechRecognition.available = available;
  vi.stubGlobal('SpeechRecognition', FakeSpeechRecognition);
  return { starts, aborts, instances: FakeSpeechRecognition.instances };
}

const clickMic = async () => {
  await act(async () => {
    screen.getByRole('button', { name: /dictate this answer/i }).click();
  });
};

describe('DictationButton ownership across the on-device check', () => {
  let DictationButton;

  // The realm gate pins its authority snapshot on first open and compares
  // against a browser epoch captured at module load, and the shared test setup
  // clears web storage after every test — which rotates that epoch and revokes
  // the realm for good. Open it per test from a fresh module graph; see the
  // comment in `src/test/setup.js` and `src/lib/authorityBoundFileDrops.spec.js`.
  beforeEach(async () => {
    vi.resetModules();
    const { openTenantSdkRealm } = await import('@/lib/tenantSdkRealmGate');
    DictationButton = (await import('./DictationButton')).default;
    expect(openTenantSdkRealm('dictation-button-ownership')).toBe(true);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('starts the recognizer it owns once the local check comes back', async () => {
    const fake = installFakeRecognizer({ available: async () => 'available' });
    render(<DictationButton onText={() => {}} />);
    await clickMic();
    expect(fake.starts).toEqual([true]);
  });

  // THE ASSERTION THIS FILE EXISTS FOR.
  it('never starts a recognizer whose button unmounted while the check was pending', async () => {
    let settle;
    const fake = installFakeRecognizer({
      available: () => new Promise((resolve) => { settle = resolve; }),
    });
    const { unmount } = render(<DictationButton onText={() => {}} />);
    await clickMic();
    expect(fake.starts).toEqual([]);

    unmount();
    await act(async () => { settle('available'); });

    // Nothing started, so no microphone is live, and the orphan was aborted
    // rather than left for the garbage collector to maybe reach.
    expect(fake.starts).toEqual([]);
    expect(fake.aborts).toHaveLength(1);
    expect(fake.aborts[0]).toBe(fake.instances[0]);
  });

  it('lets a second tap supersede a pending first one instead of starting both', async () => {
    const settles = [];
    const fake = installFakeRecognizer({
      available: () => new Promise((resolve) => { settles.push(resolve); }),
    });
    render(<DictationButton onText={() => {}} />);
    // `listening` is still false across the await, so the button stays live and
    // a second tap enters the same branch with the same stale render state.
    await clickMic();
    await clickMic();
    expect(fake.instances).toHaveLength(2);

    await act(async () => { settles.forEach((resolve) => resolve('available')); });

    // Only the recognizer the ref still holds may start. The superseded one is
    // disposed by the tap that replaced it.
    expect(fake.starts).toEqual([true]);
    expect(fake.aborts).toContain(fake.instances[0]);
  });
});
