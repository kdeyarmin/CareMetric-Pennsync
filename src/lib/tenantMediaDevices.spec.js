import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeTenantSdkRealm, openTenantSdkRealm } from './tenantSdkRealmGate';
import {
  getAuthorityBoundUserMedia,
  preferLocalSpeechRecognition,
  SPEECH_LOCALITY,
} from './tenantMediaDevices';

describe('authority-bound media acquisition', () => {
  afterEach(() => {
    closeTenantSdkRealm();
    vi.unstubAllGlobals();
  });

  it('stops a permission result that arrives after the tenant realm closes', async () => {
    openTenantSdkRealm('media-authority');
    let grant;
    const stop = vi.fn();
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn(() => new Promise((resolve) => { grant = resolve; })),
      },
    });

    const pending = getAuthorityBoundUserMedia({ audio: true });
    closeTenantSdkRealm();
    grant({ getTracks: () => [{ stop }] });

    await expect(pending).rejects.toMatchObject({ code: 'STALE_TENANT_SDK_OPERATION' });
    expect(stop).toHaveBeenCalledTimes(1);
  });
});

describe('requiring on-device speech recognition', () => {
  // A recognizer that HAS the flag, as desktop Chrome 139+ does. `processLocally`
  // is an interface attribute, so it lives on the prototype and `in` finds it
  // even while unset — which is what the helper feature-detects on.
  const recognizerWithFlag = () => Object.create({ processLocally: false });
  // Safari, Chrome for Android and every Firefox: no such property at all.
  const recognizerWithoutFlag = () => ({ lang: 'en-US' });

  it('requires local processing when the browser says a local engine is ready', async () => {
    const rec = recognizerWithFlag();
    const available = vi.fn(async () => 'available');
    const status = await preferLocalSpeechRecognition(rec, { available }, 'en-US');
    expect(status).toBe(SPEECH_LOCALITY.LOCAL);
    expect(rec.processLocally).toBe(true);
    // The query must name both the language and the requirement, or it answers
    // about remote availability and every device looks ready.
    expect(available).toHaveBeenCalledWith({ langs: ['en-US'], processLocally: true });
  });

  it('leaves a browser without the flag exactly as it was', async () => {
    const rec = recognizerWithoutFlag();
    const available = vi.fn(async () => 'available');
    const status = await preferLocalSpeechRecognition(rec, { available }, 'en-US');
    expect(status).toBe(SPEECH_LOCALITY.NO_FLAG);
    expect('processLocally' in rec).toBe(false);
    // Nothing is asked of a browser that could not honour the answer.
    expect(available).not.toHaveBeenCalled();
  });

  // The regression this whole shape exists to avoid: setting the flag on a
  // machine whose language pack is absent makes `start()` fire
  // `service-not-allowed`, which would take dictation away from a device that
  // worked yesterday.
  it.each([
    ['downloadable', SPEECH_LOCALITY.NOT_INSTALLED],
    ['downloading', SPEECH_LOCALITY.NOT_INSTALLED],
    ['unavailable', SPEECH_LOCALITY.NO_LOCAL_ENGINE],
  ])('does not set the flag when availability reads %s', async (answer, expected) => {
    const rec = recognizerWithFlag();
    const status = await preferLocalSpeechRecognition(rec, { available: async () => answer }, 'en-US');
    expect(status).toBe(expected);
    expect(rec.processLocally).toBe(false);
  });

  it('does not set the flag blind when there is no way to ask', async () => {
    const rec = recognizerWithFlag();
    const status = await preferLocalSpeechRecognition(rec, {}, 'en-US');
    expect(status).toBe(SPEECH_LOCALITY.UNKNOWN);
    expect(rec.processLocally).toBe(false);
  });

  // `available()` is gated behind the "on-device-speech-recognition"
  // policy-controlled feature, so inside a disallowed frame it rejects rather
  // than answering. A throw must not take dictation down with it.
  it('treats a rejected availability query as unknown rather than failing', async () => {
    const rec = recognizerWithFlag();
    const status = await preferLocalSpeechRecognition(
      rec, { available: async () => { throw new Error('disallowed by permissions policy'); } }, 'en-US',
    );
    expect(status).toBe(SPEECH_LOCALITY.UNKNOWN);
    expect(rec.processLocally).toBe(false);
  });

  it('answers NO_FLAG for a missing recognizer instead of throwing', async () => {
    await expect(preferLocalSpeechRecognition(null, { available: async () => 'available' }, 'en-US'))
      .resolves.toBe(SPEECH_LOCALITY.NO_FLAG);
  });
});
