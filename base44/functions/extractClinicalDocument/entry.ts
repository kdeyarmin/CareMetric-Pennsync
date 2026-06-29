import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: isSafeFetchUrl — generated, edit base44/_shared/backendHelpers.mjs>>>
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
// <<<END SHARED HELPER: isSafeFetchUrl>>>

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { file_url } = await req.json();
    if (!file_url) {
      return Response.json({ error: 'file_url required' }, { status: 400 });
    }

    if (!isSafeFetchUrl(file_url)) {
      return Response.json({ error: 'Invalid or disallowed file_url' }, { status: 400 });
    }

    const extractedData = await base44.integrations.Core.InvokeLLM({
      model: "claude_opus_4_8",
      prompt: `Extract clinical information from this medical document. Return structured JSON with the following fields (use empty string if not found):

{
  "patient": {
    "first_name": "string",
    "last_name": "string",
    "date_of_birth": "YYYY-MM-DD",
    "medical_record_number": "string",
    "phone": "string",
    "address": "string",
    "email": "string"
  },
  "vitals": {
    "blood_pressure_systolic": "number or null",
    "blood_pressure_diastolic": "number or null",
    "heart_rate": "number or null",
    "respiratory_rate": "number or null",
    "temperature": "number or null",
    "oxygen_saturation": "number or null",
    "weight": "number or null",
    "pain_level": "number or null"
  },
  "clinical": {
    "primary_diagnosis": "string",
    "secondary_diagnoses": ["string"],
    "allergies": "string",
    "current_medications": [
      {
        "name": "string",
        "dosage": "string",
        "frequency": "string"
      }
    ],
    "chief_complaint": "string",
    "assessment": "string",
    "visit_type": "routine_visit|admission|discharge|prn|recertification"
  },
  "document_info": {
    "document_type": "fax|pdf|medical_record|lab_result|imaging",
    "document_date": "YYYY-MM-DD",
    "source_facility": "string",
    "confidence_score": "number (0-100)"
  },
  "extraction_notes": "Any important notes about incomplete or ambiguous data"
}`,
      file_urls: [file_url],
      response_json_schema: {
        type: "object",
        properties: {
          patient: {
            type: "object",
            properties: {
              first_name: { type: "string" },
              last_name: { type: "string" },
              date_of_birth: { type: "string" },
              medical_record_number: { type: "string" },
              phone: { type: "string" },
              address: { type: "string" },
              email: { type: "string" }
            }
          },
          vitals: {
            type: "object",
            properties: {
              blood_pressure_systolic: { type: ["number", "null"] },
              blood_pressure_diastolic: { type: ["number", "null"] },
              heart_rate: { type: ["number", "null"] },
              respiratory_rate: { type: ["number", "null"] },
              temperature: { type: ["number", "null"] },
              oxygen_saturation: { type: ["number", "null"] },
              weight: { type: ["number", "null"] },
              pain_level: { type: ["number", "null"] }
            }
          },
          clinical: {
            type: "object",
            properties: {
              primary_diagnosis: { type: "string" },
              secondary_diagnoses: { type: "array", items: { type: "string" } },
              allergies: { type: "string" },
              current_medications: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    dosage: { type: "string" },
                    frequency: { type: "string" }
                  }
                }
              },
              chief_complaint: { type: "string" },
              assessment: { type: "string" },
              visit_type: { type: "string" }
            }
          },
          document_info: {
            type: "object",
            properties: {
              document_type: { type: "string" },
              document_date: { type: "string" },
              source_facility: { type: "string" },
              confidence_score: { type: "number" }
            }
          },
          extraction_notes: { type: "string" }
        }
      }
    });

    return Response.json({
      success: true,
      extracted_data: extractedData,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Document extraction error:', error);
    return Response.json(
      { error: error.message || 'Extraction failed' },
      { status: 500 }
    );
  }
});