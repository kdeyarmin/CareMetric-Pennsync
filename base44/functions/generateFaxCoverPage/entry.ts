import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      patient_id,
      document_id,
      recipient_number,
      recipient_name,
      recipient_organization,
      sender_name,
      sender_number,
      subject,
      notes,
      urgency = 'routine',
      page_count = 1
    } = await req.json();

    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicKey) return Response.json({ error: 'Anthropic API key not configured' }, { status: 500 });

    // Fetch patient + document in parallel.
    // Reads are scoped to the authenticated user (RLS, NOT asServiceRole) so the
    // caller cannot embed another patient's PHI into a cover sheet via a guessed id.
    const [patientResults, documentResults] = await Promise.all([
      patient_id ? base44.entities.Patient.filter({ id: patient_id }) : Promise.resolve([]),
      document_id ? base44.entities.Document.filter({ id: document_id }) : Promise.resolve([])
    ]);

    const patient = patientResults[0] || null;
    const document = documentResults[0] || null;

    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    const prompt = `You are a medical administrative assistant. Generate a HIPAA-compliant professional fax cover sheet as a clean JSON object.

Sender: ${sender_name || user.full_name}
Sender Fax: ${sender_number || 'See letterhead'}
Recipient Name: ${recipient_name || 'To Whom It May Concern'}
Recipient Organization: ${recipient_organization || ''}
Recipient Fax: ${recipient_number || ''}
Date: ${dateStr} at ${timeStr}
Subject: ${subject || (patient ? `RE: Patient ${patient.first_name} ${patient.last_name}` : 'Medical Communication')}
Urgency: ${urgency}
Total Pages (including cover): ${(Number(page_count) || 0) + 1}
Additional Notes: ${notes || ''}

Patient Info (if provided):
  Name: ${patient ? `${patient.first_name} ${patient.last_name}` : 'N/A'}
  DOB: ${patient?.date_of_birth || 'N/A'}
  MRN: ${patient?.medical_record_number || 'N/A'}
  Primary Diagnosis: ${patient?.primary_diagnosis || 'N/A'}

Document: ${document?.title || 'See attached'}
Document Category: ${document?.category || ''}

Generate a professional cover sheet with a HIPAA confidentiality disclaimer. Return only JSON.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: prompt + `\n\nReturn JSON with exactly these fields:
{
  "from_name": string,
  "from_fax": string,
  "to_name": string,
  "to_organization": string,
  "to_fax": string,
  "date": string,
  "time": string,
  "subject": string,
  "urgency": "routine" | "urgent" | "stat",
  "total_pages": number,
  "patient_name": string,
  "patient_dob": string,
  "patient_mrn": string,
  "patient_diagnosis": string,
  "document_title": string,
  "notes": string,
  "confidentiality_notice": string
}`
        }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Claude API error:', err);
      return Response.json({ error: 'AI generation failed' }, { status: 500 });
    }

    const claudeData = await response.json();
    const content = claudeData.content[0]?.text || '{}';

    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    let coverData = {};
    if (jsonMatch) {
      try {
        coverData = JSON.parse(jsonMatch[0]);
      } catch (e) {
        console.error('Failed to parse cover page JSON from AI response:', e);
      }
    }

    return Response.json({ success: true, cover_page_data: coverData });

  } catch (error) {
    console.error('Cover page generation error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});