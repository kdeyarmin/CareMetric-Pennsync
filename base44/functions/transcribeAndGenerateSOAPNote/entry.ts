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
import OpenAI from 'npm:openai@4.104.0';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }
        if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

        // Construct the OpenAI client inside the handler — module-level init
        // crashes boot if the secret is missing (no try/catch reached, no logs).
        const openai = new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY") });

        const payload = await req.json();
        const { audio_base64, mime_type } = payload;
        
        if (!audio_base64) {
             return Response.json({ error: 'No audio provided' }, { status: 400 });
        }

        // Convert base64 to File object for OpenAI
        const binaryString = atob(audio_base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        
        // determine extension
        let ext = "webm";
        if (mime_type && mime_type.includes("mp4")) ext = "mp4";
        if (mime_type && mime_type.includes("wav")) ext = "wav";

        const file = new File([bytes], `audio.${ext}`, { type: mime_type || "audio/webm" });

        // 1. Transcribe audio using gpt-4o-transcribe
        const transcriptionResponse = await openai.audio.transcriptions.create({
            file: file,
            model: "gpt-4o-transcribe",
            response_format: "text",
        });

        const transcript = transcriptionResponse;

        // 2. Generate the SOAP note using Claude — the reasoning step over the
        // transcript. Transcription stays on OpenAI's gpt-4o-transcribe above;
        // only this step uses Anthropic (same direct-API pattern as
        // generateFaxCoverPage). The model id MUST be a real Anthropic id:
        // 'automatic' is a Base44 InvokeLLM convention that 404s on the direct
        // Messages API, so every SOAP draft was silently failing to the
        // degrade path below. claude-opus-4-8 runs without thinking when the
        // thinking field is omitted, so the whole max_tokens budget goes to the
        // JSON answer; it does not take an OpenAI-style response_format, so the
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
                model: 'claude-opus-4-8',
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