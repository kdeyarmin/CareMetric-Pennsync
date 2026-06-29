import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    // Only allow POST
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    // Authenticate user
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse FormData
    const formData = await req.formData();
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
      await base44.entities.UserActivity.create({
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
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
});