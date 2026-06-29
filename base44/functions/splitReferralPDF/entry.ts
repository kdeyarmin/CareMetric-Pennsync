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

    const body = await req.json();
    const { fileUrl } = body;

    if (!fileUrl) {
      return Response.json({ error: 'Missing fileUrl' }, { status: 400 });
    }

    if (!isSafeFetchUrl(fileUrl)) {
      return Response.json({ error: 'Invalid or disallowed fileUrl' }, { status: 400 });
    }

    // Use AI to analyze the PDF and detect if it contains multiple referrals
    const analysisResult = await base44.integrations.Core.InvokeLLM({
      model: "claude_opus_4_8",
      prompt: `Analyze this PDF document to determine if it contains multiple separate referral documents/packets.

Please analyze and respond with:
1. Is this a single referral or multiple referrals? 
2. How many distinct referral documents/packets are in this PDF?
3. Estimated page ranges for each referral (if multiple)
4. Key identifiers for each referral (patient names, dates, etc.)

Be thorough - look for:
- Page breaks between documents
- Different letterheads or sources
- Different patient names
- Different referral dates
- Document headers or titles indicating new referrals
- Section breaks or dividers

Return structured data so we can split and process each referral separately.`,
      file_urls: [fileUrl],
      response_json_schema: {
        type: "object",
        properties: {
          is_multiple_referrals: {
            type: "boolean",
            description: "Whether this contains multiple referrals"
          },
          referral_count: {
            type: "number",
            description: "Number of referrals detected"
          },
          referrals: {
            type: "array",
            items: {
              type: "object",
              properties: {
                index: { type: "number", description: "Referral number (1-based)" },
                patient_name: { type: "string", description: "Patient name if available" },
                referral_source: { type: "string", description: "Source/facility" },
                referral_date: { type: "string", description: "Date if available" },
                estimated_start_page: { type: "number", description: "Estimated starting page" },
                estimated_end_page: { type: "number", description: "Estimated ending page" },
                confidence: { type: "number", description: "Confidence score 0-100" },
                key_identifiers: {
                  type: "array",
                  items: { type: "string" },
                  description: "Unique identifiers for this referral"
                }
              }
            },
            description: "List of detected referrals with page info"
          },
          notes: {
            type: "string",
            description: "Any additional notes about document structure"
          }
        }
      }
    });

    return Response.json({
      analysis: analysisResult,
      success: true
    });
  } catch (error) {
    console.error('Error analyzing PDF:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});