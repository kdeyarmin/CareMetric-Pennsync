import {
  captureTenantSdkRealmLease,
  getTenantSdkRealmAbortSignal,
  isTenantSdkRealmLeaseCurrent,
  StaleTenantSdkOperationError,
} from '@/lib/tenantSdkRealmGate';

export function stopMediaStream(stream) {
  try {
    for (const track of stream?.getTracks?.() || []) track.stop();
  } catch {
    // Continue teardown if one browser track is already gone.
  }
}

/**
 * `getUserMedia` cannot be cancelled while a browser permission prompt is
 * pending. Capture the tenant lease before prompting and immediately stop all
 * tracks if permission resolves after the realm has closed.
 */
export async function getAuthorityBoundUserMedia(constraints) {
  const realmLease = captureTenantSdkRealmLease();
  const signal = getTenantSdkRealmAbortSignal(realmLease);
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  const stopOnAuthorityClose = () => stopMediaStream(stream);
  signal.addEventListener('abort', stopOnAuthorityClose, { once: true });
  if (!isTenantSdkRealmLeaseCurrent(realmLease)) {
    stopMediaStream(stream);
    throw new StaleTenantSdkOperationError();
  }
  return { realmLease, stream };
}

function detachSpeechRecognition(recognition) {
  if (!recognition) return;
  recognition.onresult = null;
  recognition.onerror = null;
  recognition.onend = null;
  if ('onsoundstart' in recognition) recognition.onsoundstart = null;
  if ('onsoundend' in recognition) recognition.onsoundend = null;
  if ('onaudiostart' in recognition) recognition.onaudiostart = null;
  if ('onaudioend' in recognition) recognition.onaudioend = null;
}

/**
 * Own one Web Speech recognizer inside the current tenant realm. `abort()` is
 * used for authority teardown (rather than graceful `stop()`) so a browser or
 * remote speech service cannot deliver a final clinical transcript afterward.
 */
export function createAuthorityBoundSpeechRecognition(SpeechRecognition) {
  if (typeof SpeechRecognition !== 'function') {
    throw new TypeError('A SpeechRecognition constructor is required');
  }
  const realmLease = captureTenantSdkRealmLease();
  const signal = getTenantSdkRealmAbortSignal(realmLease);
  const recognition = new SpeechRecognition();
  let disposed = false;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    signal.removeEventListener('abort', dispose);
    detachSpeechRecognition(recognition);
    try { recognition.abort(); } catch { /* already stopped or unsupported */ }
  };
  signal.addEventListener('abort', dispose, { once: true });
  if (!isTenantSdkRealmLeaseCurrent(realmLease)) {
    dispose();
    throw new StaleTenantSdkOperationError();
  }

  return Object.freeze({
    dispose,
    isCurrent: () => !disposed && isTenantSdkRealmLeaseCurrent(realmLease),
    realmLease,
    recognition,
  });
}

/**
 * How a recognizer ended up being configured, so a caller can tell a refusal it
 * asked for from one it did not.
 */
export const SPEECH_LOCALITY = Object.freeze({
  /** `processLocally` was set: the browser may not send this audio anywhere. */
  LOCAL: 'local',
  /** No `processLocally` on this browser. Left as it was. */
  NO_FLAG: 'flag-unsupported',
  /** Has the flag, language pack not installed. Left as it was. */
  NOT_INSTALLED: 'pack-not-installed',
  /** Has the flag, no local engine for this language. Left as it was. */
  NO_LOCAL_ENGINE: 'no-local-engine',
  /** Has the flag and no way to ask whether local works. Left as it was. */
  UNKNOWN: 'availability-unknown',
});

/**
 * What to tell a nurse when a recognizer we required to stay local refuses to
 * start. Only say this when `preferLocalSpeechRecognition` returned `LOCAL`:
 * `service-not-allowed` also covers a user agent declining the requested
 * service for its own reasons, and that is not this sentence.
 */
export const LOCAL_SPEECH_REFUSED_MESSAGE =
  "Dictation stopped: this device can't transcribe on its own, and your audio isn't sent anywhere else. Please type this note instead.";

/**
 * Require on-device speech recognition where the browser can actually do it.
 *
 * The Web Speech API's `processLocally` defaults to FALSE, and the specification
 * says that at the default "the user agent can choose between local and remote
 * processing" — so every recognizer here has been letting the browser ship a
 * clinical conversation to Apple's or Google's speech service. Apple's own
 * privacy page for the engine Safari uses says "your audio is sent to and
 * processed on Apple servers", and Mozilla says of Chrome that "your audio is
 * sent to a web service for recognition processing". Setting this flag is the
 * only thing in the API that forbids it.
 *
 * It is a PREFERENCE and not a requirement, because the flag does not exist
 * everywhere: `processLocally`, `available()` and `install()` are desktop Chrome
 * and Edge 139+ only — not Chrome for Android, and not Safari on macOS, iOS or
 * iPadOS, which is the bedside device. Taking dictation away from those devices
 * is a product decision and is not this function's to make, so where the flag
 * cannot be honoured the recognizer is left exactly as it was.
 *
 * `available()` is asked BEFORE starting rather than letting `start()` refuse,
 * and that ordering is the whole reason this is not a one-line change. A browser
 * that HAS the flag but no language pack fires `service-not-allowed` and aborts,
 * so setting the flag blind would take dictation away from a machine that worked
 * yesterday. Asking first keeps that machine working and leaves the refusal path
 * for the case it is actually diagnostic of.
 *
 * `install()` is deliberately NOT called. It downloads a language pack and the
 * specification notes the user agent may prompt for permission, so offering that
 * to a nurse mid-visit is a product decision rather than a safety fix.
 */
export async function preferLocalSpeechRecognition(recognition, SpeechRecognitionCtor, lang) {
  if (!recognition || !('processLocally' in recognition)) return SPEECH_LOCALITY.NO_FLAG;
  const available = SpeechRecognitionCtor?.available;
  if (typeof available !== 'function') return SPEECH_LOCALITY.UNKNOWN;
  let status;
  try {
    // Gated behind the "on-device-speech-recognition" policy-controlled feature,
    // so this rejects rather than answers inside a disallowed frame.
    status = await available.call(SpeechRecognitionCtor, { langs: [lang], processLocally: true });
  } catch {
    return SPEECH_LOCALITY.UNKNOWN;
  }
  if (status === 'available') {
    recognition.processLocally = true;
    return SPEECH_LOCALITY.LOCAL;
  }
  if (status === 'downloadable' || status === 'downloading') return SPEECH_LOCALITY.NOT_INSTALLED;
  return SPEECH_LOCALITY.NO_LOCAL_ENGINE;
}
