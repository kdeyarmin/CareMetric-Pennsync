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

    // Convert file to buffer
    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    // Call OpenAI transcription API (gpt-4o-transcribe)
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiApiKey) {
      return Response.json({ error: "OpenAI API key not configured" }, { status: 500 });
    }

    // Create FormData for OpenAI transcription (gpt-4o-transcribe)
    const whisperFormData = new FormData();
    whisperFormData.append("file", new Blob([buffer], { type: "audio/mp3" }), "audio.mp3");
    whisperFormData.append("model", "gpt-4o-transcribe");
    whisperFormData.append("language", "en");

    const transcribeResponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiApiKey}`,
      },
      body: whisperFormData,
    });

    if (!transcribeResponse.ok) {
      const error = await transcribeResponse.json();
      console.error("Whisper API error:", error);
      return Response.json(
        { error: error.error?.message || "Transcription failed" },
        { status: transcribeResponse.status }
      );
    }

    const result = await transcribeResponse.json();

    // Log activity
    try {
      await base44.asServiceRole.entities.UserActivity.create({
        user_email: user.email,
        user_name: user.full_name,
        action: "audio_transcribed",
        details: {
          duration_seconds: Math.round((buffer.length / 16000) || 1),
          transcription_length: result.text?.length || 0,
          timestamp: new Date().toISOString(),
        },
        page: "SmartNoteAssistant",
        user_agent: req.headers.get("user-agent"),
      });
    } catch (logErr) {
      console.error("Activity logging error:", logErr);
    }

    return Response.json({
      text: result.text || "",
      duration: result.duration || null,
    });
  } catch (error) {
    console.error("Transcription error:", error);
    return Response.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
});
