import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: pennsyncProductionAppId — generated, edit base44/_shared/backendHelpers.mjs>>>
const PENNSYNC_PRODUCTION_APP_ID = '694ec16e72e01b60d22f7cbf';
// <<<END SHARED HELPER: pennsyncProductionAppId>>>
// <<<BEGIN SHARED HELPER: base44ClientRequest — generated, edit base44/_shared/backendHelpers.mjs>>>
function pinnedBase44Request(req, expectedAppId, forwardUserCredential) {
  if (typeof expectedAppId !== 'string' || expectedAppId === '') {
    throw new Error('pinned Base44 request requires an expected Base44-App-Id');
  }
  // Read the inbound headers without ever throwing on the SHAPE of req. A production
  // request is always a real Request with a Headers bag; a bare object with no usable
  // headers (a test fixture, a malformed direct call) carries no inbound header, which
  // is the absent case handled below. Only a PRESENT, different app id throws, and that
  // requires a real header an attacker would have to set — so a real Request always
  // reaches this read and the refusal is never skipped by the tolerance.
  const inbound =
    req && req.headers && typeof req.headers.get === 'function' ? req.headers : null;
  const read = (name) => (inbound ? inbound.get(name) : null);
  const received = read('Base44-App-Id');
  // Refuse only an ACTIVE mismatch: a caller presenting a DIFFERENT app id is the
  // tenant-redirect attack, and that is the case the refusal exists for. An ABSENT
  // header is not a mismatch and selects no other tenant — it only means the request
  // did not arrive through the platform, which always injects this header. We SET the
  // pinned constant below either way, so absent falls back to the correct app exactly
  // as the dropped Base44-Api-Url falls back to the default serverUrl. Throwing on
  // absent would turn every anonymous denial into a 500 instead of a clean 403.
  if (received !== null && received !== expectedAppId) {
    throw new Error(
      'Base44-App-Id mismatch: expected ' + expectedAppId + ', received ' + received
    );
  }
  const headers = new Headers();
  // Load-bearing: SET the constant (never forward the inbound value). The SDK reads
  // appId from this header and throws of its own accord when it is absent, so pinning
  // requires setting it here — dropping the inbound header alone would not suffice.
  headers.set('Base44-App-Id', expectedAppId);
  const serviceAuth = read('Base44-Service-Authorization');
  if (serviceAuth !== null) headers.set('Base44-Service-Authorization', serviceAuth);
  if (forwardUserCredential) {
    const authorization = read('Authorization');
    if (authorization !== null) headers.set('Authorization', authorization);
    const dataEnv = read('X-Data-Env');
    if (dataEnv === 'dev' || dataEnv === 'prod') headers.set('X-Data-Env', dataEnv);
  }
  // Cosmetic URL: serverUrl comes from the dropped Base44-Api-Url, not from here.
  // No method: the SDK request factory reads only headers.get(...), never the
  // method, so the request defaults to GET. An explicit POST would be inert for the
  // SDK and would read as an outbound delivery primitive to the inventory scanner
  // once this block is inlined into the fax status pollers.
  return new Request('https://base44.app', { headers });
}
function userScopedClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, true);
}
function serviceRoleClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, false);
}
// <<<END SHARED HELPER: base44ClientRequest>>>
// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>
// <<<BEGIN SHARED HELPER: deepgramTranscribe — generated, edit base44/_shared/backendHelpers.mjs>>>
// Speech-to-text helper: transcribes recorded visit audio with Deepgram's
// prerecorded API (Nova-3 Medical) under the app's own DEEPGRAM_API_KEY
// function secret — the same secret posture as ANTHROPIC_API_KEY beside it
// in the secret inventory. The IntegrationSecret store is not used: it is
// the Telnyx credential store by repo rule, and reading it goes through
// entities, which would reclassify these entity-free functions as waiting
// on the record store in the port queue — the same reasoning that keeps
// the Anthropic key in the environment (migration plan §2.4, D87).
// Contract:
//   deepgramTranscribe({ data, contentType? }, deps?) -> { text, duration }
// data is the audio bytes (Uint8Array or ArrayBuffer); contentType is the
// recorder's container type when the caller knows it — when it is absent,
// generic, or not an audio type, the container is sniffed from the bytes
// instead. Deepgram accepts the recorder containers natively (MP4/M4A,
// WebM, WAV, Ogg, MP3), so no relabeling or transcode stands between the
// upload and the provider. Diarization and smart formatting are on;
// keyterm prompting carries the app's clinical vocabulary
// (DEEPGRAM_KEYTERMS, mirrored from src/components/utils/medicalDictionary.js
// — medications first, then clinical terms — capped at the provider's
// 100-term keyterm limit, enforced again at request build).
// Errors are Errors carrying .status and .code, in the same style as
// directInvokeLLM: TRANSCRIPTION_NOT_CONFIGURED (503) when the secret is
// absent — callers map that one code to the fail-closed refusal the
// frontend renders as its "isn't set up yet" copy — INVALID_AUDIO (400)
// for empty input, AUDIO_TOO_LARGE (413), and TRANSCRIPTION_PROVIDER_ERROR
// (502) for a provider refusal, an unreadable response, or a response with
// no transcript channel. A well-formed response whose transcript is empty
// (a silent recording) resolves with text '' so each caller keeps its own
// empty-transcript behavior. One provenance log line is emitted per
// completed call; the transcript itself is never logged.
const DEEPGRAM_MODEL = 'nova-3-medical';
const DEEPGRAM_MAX_AUDIO_BYTES = 100 * 1024 * 1024;
const DEEPGRAM_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const DEEPGRAM_KEYTERMS = [
  'Metformin', 'Lisinopril', 'Atorvastatin', 'Amlodipine', 'Omeprazole',
  'Levothyroxine', 'Sertraline', 'Ibuprofen', 'Amoxicillin', 'Azithromycin',
  'Prednisone', 'Aspirin', 'Metoprolol', 'Furosemide', 'Insulin', 'Warfarin',
  'Clopidogrel', 'Pantoprazole', 'Ranitidine', 'Gabapentin', 'Tramadol',
  'Hydrocodone', 'Oxycodone', 'Morphine', 'Fentanyl', 'Diltiazem', 'Verapamil',
  'Losartan', 'Valsartan', 'Olmesartan', 'Irbesartan', 'Candesartan',
  'Simvastatin', 'Pravastatin', 'Rosuvastatin', 'Fluoxetine', 'Paroxetine',
  'Citalopram', 'Escitalopram', 'Duloxetine', 'Venlafaxine', 'Fluconazole',
  'Ketoconazole', 'Miconazole', 'Clotrimazole', 'Doxycycline', 'Tetracycline',
  'Ciprofloxacin', 'Levofloxacin', 'Metronidazole', 'Vancomycin', 'Ampicillin',
  'Cephalexin', 'Ceftriaxone', 'Cefdinir', 'Sulfamethoxazole', 'Trimethoprim',
  'Assessment', 'Vitals', 'Blood', 'Pressure', 'Heart', 'Rate', 'Respiration',
  'Respiratory', 'Temperature', 'Oxygen', 'Saturation', 'Pulse', 'Oximetry',
  'Auscultation', 'Percussion', 'Palpation', 'Edema', 'Erythema', 'Ecchymosis',
  'Petechiae', 'Urticaria', 'Rash', 'Wound', 'Laceration', 'Abrasion',
  'Contusion', 'Hematoma', 'Abscess', 'Cellulitis', 'Gangrene', 'Ulcer',
  'Decubitus', 'Sore', 'Eschar', 'Slough', 'Granulation', 'Epithelialization',
  'Hemostasis', 'Hemoptysis', 'Dyspnea',
];
function deepgramFail(status, code) {
  const error = new Error(code);
  error.status = status;
  error.code = code;
  throw error;
}
function deepgramSniffAudioType(bytes) {
  const ascii = (part) => [...part].map((b) => String.fromCharCode(b)).join('');
  if (bytes.length >= 8 && ascii(bytes.subarray(4, 8)) === 'ftyp') return 'audio/mp4';
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'audio/webm';
  if (bytes.length >= 12 && ascii(bytes.subarray(0, 4)) === 'RIFF' && ascii(bytes.subarray(8, 12)) === 'WAVE') return 'audio/wav';
  if (bytes.length >= 4 && ascii(bytes.subarray(0, 4)) === 'OggS') return 'audio/ogg';
  if (bytes.length >= 3 && ascii(bytes.subarray(0, 3)) === 'ID3') return 'audio/mpeg';
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  return 'application/octet-stream';
}
async function deepgramReadBytes(response, maximum) {
  const reader = response.body && typeof response.body.getReader === 'function' ? response.body.getReader() : null;
  if (!reader) deepgramFail(502, 'TRANSCRIPTION_PROVIDER_ERROR');
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) { try { await reader.cancel(); } catch { /* already failing */ } deepgramFail(502, 'TRANSCRIPTION_PROVIDER_ERROR'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
async function deepgramTranscribe(audio, deps) {
  const fetcher = deps && typeof deps.fetcher === 'function' ? deps.fetcher : fetch;
  const apiKey = deps && typeof deps.apiKey === 'string' && deps.apiKey
    ? deps.apiKey
    : (typeof Deno !== 'undefined' ? Deno.env.get('DEEPGRAM_API_KEY') : undefined);
  if (!apiKey) deepgramFail(503, 'TRANSCRIPTION_NOT_CONFIGURED');
  let bytes = null;
  if (audio && audio.data instanceof Uint8Array) bytes = audio.data;
  else if (audio && audio.data instanceof ArrayBuffer) bytes = new Uint8Array(audio.data);
  if (!bytes || !bytes.length) deepgramFail(400, 'INVALID_AUDIO');
  if (bytes.length > DEEPGRAM_MAX_AUDIO_BYTES) deepgramFail(413, 'AUDIO_TOO_LARGE');
  let contentType = audio && typeof audio.contentType === 'string'
    ? audio.contentType.split(';')[0].trim().toLowerCase() : '';
  if (!contentType || contentType === 'application/octet-stream' || !contentType.startsWith('audio/')) {
    contentType = deepgramSniffAudioType(bytes);
  }
  const keytermSource = deps && Array.isArray(deps.keyterms) ? deps.keyterms : DEEPGRAM_KEYTERMS;
  const keyterms = keytermSource.filter((term) => typeof term === 'string' && term.trim()).slice(0, 100);
  const query = new URLSearchParams({
    model: DEEPGRAM_MODEL, language: 'en', diarize: 'true', smart_format: 'true', punctuate: 'true',
  });
  for (const term of keyterms) query.append('keyterm', term);
  const started = Date.now();
  // Redirects are never followed: the Authorization header carries the app's
  // key, and a redirect would carry it to whatever host answered.
  const response = await fetcher('https://api.deepgram.com/v1/listen?' + query.toString(), {
    method: 'POST',
    headers: { Authorization: 'Token ' + apiKey, 'Content-Type': contentType },
    body: bytes, redirect: 'manual', signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) {
    console.error('Deepgram transcription failed with provider status', response.status);
    deepgramFail(502, 'TRANSCRIPTION_PROVIDER_ERROR');
  }
  const responseBytes = await deepgramReadBytes(response, DEEPGRAM_MAX_RESPONSE_BYTES);
  let result;
  try { result = JSON.parse(new TextDecoder().decode(responseBytes)); } catch { deepgramFail(502, 'TRANSCRIPTION_PROVIDER_ERROR'); }
  const channels = result && result.results && Array.isArray(result.results.channels) ? result.results.channels : [];
  const alternative = channels.length && Array.isArray(channels[0].alternatives) ? channels[0].alternatives[0] : undefined;
  if (!alternative || typeof alternative.transcript !== 'string') deepgramFail(502, 'TRANSCRIPTION_PROVIDER_ERROR');
  const duration = result.metadata && typeof result.metadata.duration === 'number' ? result.metadata.duration : null;
  console.log(JSON.stringify({ event: 'deepgram_transcription', model: DEEPGRAM_MODEL, duration_seconds: duration, latency_ms: Date.now() - started }));
  return { text: alternative.transcript, duration };
}
// <<<END SHARED HELPER: deepgramTranscribe>>>


Deno.serve(async (req) => {
  try {
    // Only allow POST
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    // Authenticate user
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse FormData — return a clean 400 (not a 500) when the request isn't
    // multipart/form-data (e.g. JSON body or missing boundary).
    let formData;
    try {
      formData = await req.formData();
    } catch {
      return Response.json({ error: "Request must be multipart/form-data with a 'file' field" }, { status: 400 });
    }
    const audioFile = formData.get("file");

    if (!audioFile) {
      return Response.json({ error: "No audio file provided" }, { status: 400 });
    }

    // Transcribe with Deepgram (R2 of the direct-AI migration, replacing the
    // OpenAI leg R1 removed). The recorded bytes go to the provider as they
    // arrived — Deepgram accepts the recorder containers (WebM, MP4/M4A,
    // WAV) natively, so the old relabel-everything-to-mp3 seam is gone; the
    // upload's own type leads and the helper sniffs the container when it is
    // absent or generic. When the DEEPGRAM_API_KEY secret has not been
    // provisioned yet, the helper's TRANSCRIPTION_NOT_CONFIGURED maps to
    // exactly the fail-closed refusal R1 left here, which the frontend
    // renders as its "isn't set up yet" copy (src/lib/aiFeatureError.js);
    // any other provider failure is a plain 502 and never a fabricated
    // transcript.
    const audioBytes = new Uint8Array(await audioFile.arrayBuffer());
    let transcription;
    try {
      transcription = await deepgramTranscribe({
        data: audioBytes,
        contentType: typeof audioFile.type === "string" ? audioFile.type : undefined,
      });
    } catch (transcribeError) {
      if (transcribeError?.code === "TRANSCRIPTION_NOT_CONFIGURED") {
        return Response.json(
          { error: "Transcription provider not configured" },
          { status: 500 }
        );
      }
      console.error("Deepgram transcription error:", transcribeError);
      const status = [400, 413, 502].includes(transcribeError?.status)
        ? transcribeError.status
        : 502;
      return Response.json(
        { error: "Transcription failed" },
        { status }
      );
    }

    // Log activity (restored with the success path: R1 removed it together
    // with the provider call it recorded, because no transcription occurred).
    try {
      await base44.asServiceRole.entities.UserActivity.create({
        user_email: user.email,
        user_name: user.full_name,
        action: "audio_transcribed",
        details: {
          duration_seconds: typeof transcription.duration === "number"
            ? Math.round(transcription.duration)
            : Math.round((audioBytes.length / 16000) || 1),
          transcription_length: transcription.text?.length || 0,
          timestamp: new Date().toISOString(),
        },
        page: "SmartNoteAssistant",
        user_agent: req.headers.get("user-agent"),
      });
    } catch (logErr) {
      console.error("Activity logging error:", logErr);
    }

    return Response.json({
      text: transcription.text || "",
      duration: typeof transcription.duration === "number" ? transcription.duration : null,
    });
  } catch (error) {
    console.error("Transcription error:", error);
    return Response.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
});
