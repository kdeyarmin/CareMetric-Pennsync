import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import OpenAI from 'npm:openai';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

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

        // 2. Generate the SOAP note using Claude (claude-opus-4-8) — the most
        // capable model, the best fit for clinical reasoning over the transcript.
        // Transcription stays on OpenAI's gpt-4o-transcribe above; only this
        // reasoning step uses Anthropic (same direct-API pattern as
        // generateFaxCoverPage). claude-opus-4-8 rejects temperature/top_p and
        // does not take an OpenAI-style response_format, so the JSON contract is
        // expressed in the prompt and extracted from the response text.
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
                system: "You are an expert clinical documentation assistant. Extract information from the provided transcript and generate a structured SOAP note (Subjective, Objective, Assessment, Plan). Return ONLY a JSON object with keys: subjective, objective, assessment, plan.",
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
           soapNote = { subjective: "Error parsing response.", objective: "", assessment: "", plan: "" };
        }

        soapNote.raw_transcript = transcript;

        return Response.json({ success: true, data: soapNote });

    } catch (error) {
        console.error("Error in transcribeAndGenerateSOAPNote:", error);
        return Response.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
});