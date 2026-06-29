import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// SSRF guard: only fetch https URLs on public hosts, never internal IPs /
// metadata. Set FILE_URL_ALLOWED_HOSTS (comma-separated) to restrict to your
// storage host(s).
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
  const allow = Deno.env.get('FILE_URL_ALLOWED_HOSTS');
  if (allow) {
    const hosts = allow.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
    if (!hosts.some((h) => host === h || host.endsWith('.' + h))) return false;
  }
  return true;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { document_id } = await req.json();

    if (!document_id) {
      return Response.json({ error: 'Missing document_id' }, { status: 400 });
    }

    // Get the document
    const documents = await base44.entities.Document.filter({ id: document_id });
    if (documents.length === 0) {
      return Response.json({ error: 'Document not found' }, { status: 404 });
    }

    const document = documents[0];

    // Fetch document content
    if (!isSafeFetchUrl(document.file_url)) {
      return Response.json({ error: 'Document has an invalid or disallowed file URL' }, { status: 400 });
    }
    const docResponse = await fetch(document.file_url);
    const docText = await docResponse.text();

    // Analyze with AI
    const analysisPrompt = `Analyze this medical document and provide:

1. A concise summary (2-3 sentences)
2. Extracted key data points (lab values, diagnoses, medications, vital signs, dates)
3. A more specific category (choose from: lab_results, imaging_report, pathology, consent_form, insurance_card, prior_auth, referral_letter, progress_note, admission_note, discharge_summary, medication_list, prescription, physician_orders, wound_care, vital_signs, assessment, care_plan, other)
4. Critical findings that need immediate attention (severity: critical/high/medium/low)
5. Confidence score (0-100)

Document title: ${document.title}
Current category: ${document.category}
Content:
${docText.substring(0, 50000)}

Return a JSON object with this structure:
{
  "summary": "brief summary",
  "extracted_data": {
    "lab_values": [],
    "diagnoses": [],
    "medications": [],
    "vital_signs": {},
    "key_dates": [],
    "other_findings": []
  },
  "suggested_category": "specific_category",
  "critical_flags": [
    {
      "severity": "critical|high|medium|low",
      "finding": "what was found",
      "details": "explanation"
    }
  ],
  "confidence_score": 85
}`;

    const aiResponse = await base44.integrations.Core.InvokeLLM({
      model: "claude_opus_4_8",
      prompt: analysisPrompt,
      response_json_schema: {
        type: "object",
        properties: {
          summary: { type: "string" },
          extracted_data: { type: "object" },
          suggested_category: { type: "string" },
          critical_flags: {
            type: "array",
            items: {
              type: "object",
              properties: {
                severity: { type: "string" },
                finding: { type: "string" },
                details: { type: "string" }
              }
            }
          },
          confidence_score: { type: "number" }
        }
      }
    });

    // Update document with AI analysis
    await base44.entities.Document.update(document_id, {
      ai_analysis: {
        analyzed: true,
        summary: aiResponse.summary,
        extracted_data: aiResponse.extracted_data,
        suggested_category: aiResponse.suggested_category,
        critical_flags: aiResponse.critical_flags || [],
        confidence_score: aiResponse.confidence_score,
        analyzed_date: new Date().toISOString()
      }
    });

    return Response.json({
      success: true,
      analysis: aiResponse
    });

  } catch (error) {
    console.error('Document analysis error:', error);
    return Response.json({ 
      error: error.message 
    }, { status: 500 });
  }
});