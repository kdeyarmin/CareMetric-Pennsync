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
