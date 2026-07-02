import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Operational debug logs are compiled out in production (the FUNCTIONS_DEBUG
// secret was retired). console.error/warn remain ungated for visibility.
const debugLog = (..._args) => {};

// SSRF guard: only fetch https URLs on the app's own storage/app hosts, never
// internal IPs / metadata. Mirrors analyzeDocument/extractClinicalDocument — any
// function that hands a user-supplied URL to a provider integration must gate it.
const FILE_URL_ALLOWED_HOSTS = ['qtrypzzcjebvfcihiynt.supabase.co', 'base44.app', 'base44.io'];
function isSafeFetchUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (['localhost', '0.0.0.0', '127.0.0.1', '::1', '169.254.169.254'].includes(host)) return false;
  if (host.endsWith('.internal') || host.endsWith('.local')) return false;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
  }
  if (!FILE_URL_ALLOWED_HOSTS.some((h) => host === h || host.endsWith('.' + h))) return false;
  return true;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { audio_url, patient_id, visit_type, diagnosis } = await req.json();

    if (!audio_url || !patient_id || !visit_type) {
      return Response.json(
        { error: 'Missing required fields: audio_url, patient_id, visit_type' },
        { status: 400 }
      );
    }

    if (!isSafeFetchUrl(audio_url)) {
      return Response.json({ error: 'audio_url is not an allowed file URL' }, { status: 400 });
    }

    // Fetch patient via the RLS-scoped client (NOT asServiceRole) so the
    // platform enforces that this caller may access this patient — prevents
    // generating a note against an arbitrary patient_id (IDOR).
    const patient = await base44.entities.Patient.get(patient_id);
    if (!patient) {
      // Patient doesn't exist or the caller isn't authorized for it.
      return Response.json({ error: 'Patient not found' }, { status: 404 });
    }

    // Step 1: Transcribe audio using AI
    debugLog('Transcribing audio...');
    const transcriptionResponse = await base44.asServiceRole.integrations.Core.InvokeLLM({
      model: "gemini_3_flash",
      prompt: `Please transcribe the following audio/video file of a medical visit. Provide a clear, complete transcription of the conversation between the healthcare provider and patient. Preserve medical terminology and patient responses accurately.`,
      file_urls: [audio_url],
      add_context_from_internet: false
    });

    const transcription = typeof transcriptionResponse === 'string' 
      ? transcriptionResponse 
      : transcriptionResponse.transcription || transcriptionResponse.text || '';

    if (!transcription) {
      return Response.json({ error: 'Failed to transcribe audio' }, { status: 400 });
    }

    // Step 2: Generate structured clinical note
    debugLog('Generating clinical note...');
    const notePrompt = `Re-organize ONLY the information in the following visit transcription into a structured clinical note in SOAP format (Subjective, Objective, Assessment, Plan).

This output is a DRAFT that a nurse will verify in a fact-checking step before it reaches the chart — it is NOT the final record.

ABSOLUTE RULE: Use ONLY what is explicitly stated in the transcription. Do NOT add, infer, or invent any clinical fact, vital sign, measurement, medication, diagnosis, or finding that is not in the transcript. If a SOAP section has no supporting content in the transcript, write "Not documented in this recording" rather than fabricating it. The patient header below is for labeling only — do not treat it as clinical findings.

Patient Information (label only):
- Name: ${patient.first_name} ${patient.last_name}
- DOB: ${patient.date_of_birth || 'N/A'}
- Primary Diagnosis: ${diagnosis}
- Visit Type: ${visit_type.replace(/_/g, ' ')}

Transcription:
${transcription}

Organize the stated content into:
1. Subjective: Patient's reported symptoms, concerns, and history AS STATED
2. Objective: Vital signs and physical findings AS STATED (do not invent)
3. Assessment: Clinical impression AS STATED
4. Plan: Treatment/follow-up AS STATED

Format professionally. Add nothing that was not said.`;

    const noteResponse = await base44.asServiceRole.integrations.Core.InvokeLLM({
      model: "claude_opus_4_8",
      prompt: notePrompt,
      add_context_from_internet: false
    });

    const generatedNote = typeof noteResponse === 'string' ? noteResponse : noteResponse.text || '';

    // Step 3: Generate treatment suggestions
    debugLog('Generating treatment suggestions...');
    const treatmentPrompt = `Based on this patient interaction transcript and diagnosis, suggest relevant treatment options:

Diagnosis: ${diagnosis}
Transcription: ${transcription.substring(0, 1000)}...

Provide 3-5 specific treatment suggestions in JSON format:
[
  {
    "treatment": "treatment name",
    "rationale": "why this is recommended based on the patient's condition",
    "category": "medication|therapy|monitoring|education",
    "confidence": 85
  }
]

Only include clinically appropriate suggestions.`;

    // Ask for strict JSON in-prompt and tolerantly parse the text. The platform
    // rejects an array-root response_json_schema (root must be an object), so we
    // avoid the schema entirely here.
    const treatmentResponse = await base44.asServiceRole.integrations.Core.InvokeLLM({
      model: "claude_opus_4_8",
      prompt: `${treatmentPrompt}

Return ONLY a valid JSON object, no prose or code fences, of the form:
{"suggestions":[{"treatment":"","rationale":"","category":"","confidence":0}]}`,
      add_context_from_internet: false
    });

    const parseTreatments = (raw) => {
      if (!raw) return [];
      if (Array.isArray(raw)) return raw;
      if (typeof raw === 'object') return raw.suggestions || [];
      const text = String(raw).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
      const slice = text.slice(text.indexOf('{') === -1 ? 0 : text.indexOf('{'), (text.lastIndexOf('}') + 1) || text.length);
      try {
        const obj = JSON.parse(slice);
        return Array.isArray(obj) ? obj : (obj.suggestions || []);
      } catch {
        return [];
      }
    };

    const treatmentSuggestions = parseTreatments(treatmentResponse);

    return Response.json({
      success: true,
      data: {
        transcription,
        generatedNote,
        treatmentSuggestions,
        metadata: {
          processedAt: new Date().toISOString(),
          patientId: patient_id,
          visitType: visit_type,
          diagnosis
        }
      }
    });

  } catch (error) {
    console.error('Error generating note from recording:', error);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
});