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
        const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }
        if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

        const payload = await req.json();
        const { audio_base64, mime_type, transcript: suppliedTranscript } = payload;

        if (!audio_base64 && !suppliedTranscript) {
             return Response.json({ error: 'No audio provided' }, { status: 400 });
        }

        // 1. Transcription, on Deepgram (R2 of the direct-AI migration,
        // replacing the SDK transcription leg R1 removed when that provider
        // account closed). The base64 audio is decoded and handed to the
        // shared helper with the caller's declared container type (the
        // recorder's real type — audio/mp4 on iOS, audio/webm in Chromium);
        // the helper sniffs the container when the type is absent or
        // generic. Until the DEEPGRAM_API_KEY secret is provisioned, the
        // helper's TRANSCRIPTION_NOT_CONFIGURED maps to exactly the
        // fail-closed refusal R1 left at this step — after auth and payload
        // validation, before any provider call — which the frontend renders
        // as its "isn't set up yet" copy (src/lib/aiFeatureError.js). A
        // caller that already holds a transcript may supply it as
        // `transcript`, and the Anthropic leg below then runs exactly as
        // before, with no transcription call made at all.
        let transcript = typeof suppliedTranscript === 'string' ? suppliedTranscript : '';
        if (!transcript) {
            const binaryString = atob(audio_base64);
            const audioBytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                audioBytes[i] = binaryString.charCodeAt(i);
            }
            try {
                const transcription = await deepgramTranscribe({
                    data: audioBytes,
                    contentType: typeof mime_type === 'string' ? mime_type : undefined,
                });
                transcript = transcription.text;
            } catch (transcribeError) {
                if (transcribeError?.code === 'TRANSCRIPTION_NOT_CONFIGURED') {
                    return Response.json({ error: 'Transcription provider not configured' }, { status: 500 });
                }
                console.error("Deepgram transcription error:", transcribeError);
                const status = [400, 413, 502].includes(transcribeError?.status)
                    ? transcribeError.status
                    : 500;
                return Response.json({ error: 'Transcription failed' }, { status });
            }
        }

        // 2. Generate the SOAP note using Claude — the reasoning step over the
        // transcript. Only this step uses Anthropic (same direct-API pattern
        // as generateFaxCoverPage). The model id MUST be a real Anthropic id:
        // 'automatic' is a Base44 InvokeLLM convention that 404s on the direct
        // Messages API, so every SOAP draft was silently failing to the
        // degrade path below. claude-opus-5-5 runs without thinking when the
        // thinking field is omitted, so the whole max_tokens budget goes to
        // the JSON answer; the Messages API takes no response_format, so the
        // JSON contract is expressed in the prompt and extracted from the text.
        const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
        if (!anthropicKey) {
            return Response.json({ error: 'Anthropic API key not configured' }, { status: 500 });
        }

        const soapApiResponse = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': anthropicKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-opus-5-5',
                max_tokens: 2048,
                system: "You are an expert clinical documentation assistant. Re-organize ONLY the information in the provided transcript into a structured SOAP note (Subjective, Objective, Assessment, Plan). This is a DRAFT for a nurse to verify — it is NOT the final record. Do NOT add, infer, or invent any clinical fact, vital sign, measurement, medication, diagnosis, or finding that is not explicitly stated in the transcript. If something was not said, leave it out. Return ONLY a JSON object with keys: subjective, objective, assessment, plan.",
                messages: [
                    {
                        role: "user",
                        content: `Please generate a SOAP note from the following transcript:\n\n${transcript}`
                    }
                ]
            })
        });

        if (!soapApiResponse.ok) {
            const err = await soapApiResponse.text();
            console.error("Claude API error:", err);
            return Response.json({ error: 'AI generation failed' }, { status: 500 });
        }

        const claudeData = await soapApiResponse.json();
        // Anthropic returns an array of content blocks; concatenate every text
        // block (not just the first) so JSON extraction can't drop later output.
        const soapText = (Array.isArray(claudeData.content) ? claudeData.content : [])
            .filter((block) => block?.type === 'text')
            .map((block) => block.text)
            .join('') || '{}';

        let soapNote;
        try {
           const jsonMatch = soapText.match(/\{[\s\S]*\}/);
           soapNote = JSON.parse(jsonMatch ? jsonMatch[0] : soapText);
        } catch (e) {
           // Degrade to the nurse's actual words, never placeholder junk: the
           // client renders these fields, and "Error parsing response." could
           // otherwise end up pasted into a draft note.
           soapNote = {
             subjective: String(transcript || '').trim() || 'Transcription unavailable — please re-record.',
             objective: "", assessment: "", plan: "", parse_error: true,
           };
        }

        soapNote.raw_transcript = transcript;

        return Response.json({ success: true, data: soapNote });

    } catch (error) {
        console.error("Error in transcribeAndGenerateSOAPNote:", error);
        return Response.json({ error: 'Internal Server Error' }, { status: 500 });
    }
});