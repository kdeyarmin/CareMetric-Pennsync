// Which container a MediaRecorder should write, and what to call the result.
//
// iOS is the reason this exists. WebKit's MediaRecorder writes `audio/mp4` and,
// before iOS 18.4, refuses `audio/webm` outright — `new MediaRecorder(stream,
// { mimeType: 'audio/webm' })` throws NotSupportedError, which the recorders
// reported as "Microphone access denied" after the user had just granted it.
// And a recorder created with no type writes mp4 there, so a Blob labelled
// `audio/webm` sends mp4 bytes under a webm name and MIME type; the SOAP
// transcription backend derives the file extension from that MIME type.
//
// So: ask the recorder what it supports instead of assuming Chromium, and label
// the recording with what the recorder actually produced.
const RECORDER_CANDIDATES = Object.freeze([
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
]);

/**
 * The first container this MediaRecorder implementation supports, or '' to let
 * the browser choose (an implementation with no `isTypeSupported` at all).
 * @param {{ isTypeSupported?: (type: string) => boolean } | undefined} Recorder
 */
export function pickAudioRecorderMimeType(Recorder = globalThis.MediaRecorder) {
  if (!Recorder || typeof Recorder.isTypeSupported !== 'function') return '';
  for (const type of RECORDER_CANDIDATES) {
    try {
      if (Recorder.isTypeSupported(type)) return type;
    } catch { /* treat a throwing probe as unsupported */ }
  }
  return '';
}

/**
 * Constructor options for `new MediaRecorder(stream, options)`. `undefined`
 * rather than `{ mimeType: '' }` when nothing matched, so the browser default
 * applies instead of an explicit empty type.
 * @param {string} mimeType
 */
export function audioRecorderOptions(mimeType) {
  return mimeType ? { mimeType } : undefined;
}

/**
 * The base MIME type a finished recording should carry: the recorder's own
 * `mimeType` without codec parameters, else `fallback`.
 * @param {{ mimeType?: string } | null | undefined} recorder
 * @param {string} [fallback]
 */
export function recordedAudioType(recorder, fallback = 'audio/webm') {
  const base = String(recorder?.mimeType || '').split(';')[0].trim().toLowerCase();
  return /^audio\/[a-z0-9.+-]+$/.test(base) ? base : fallback;
}

/**
 * A file extension matching an audio MIME type, for the upload's file name.
 * @param {string} type
 */
export function audioFileExtension(type) {
  const subtype = String(type || '').split(';')[0].split('/')[1]?.trim().toLowerCase();
  if (!subtype) return 'webm';
  if (subtype === 'mpeg') return 'mp3';
  if (subtype === 'x-m4a' || subtype === 'aac') return 'm4a';
  return /^[a-z0-9]+$/.test(subtype) ? subtype : 'webm';
}
