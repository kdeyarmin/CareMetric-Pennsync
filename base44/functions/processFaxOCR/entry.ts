import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// <<<BEGIN SHARED HELPER: isAdminLike — generated, edit base44/_shared/backendHelpers.mjs>>>
const isAdminLike = (u) => !!u && (
  u.role === 'admin' || u.account_type === 'agency_admin' ||
  u.account_type === 'super_admin'
);
// <<<END SHARED HELPER: isAdminLike>>>



// SSRF guard: only fetch https URLs on the app's own storage/app hosts, never
// internal IPs / metadata. Mirrors analyzeDocument.
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

    // Require authentication: previously unauthenticated, so anyone could read
    // any FaxLog's extracted OCR PHI by id, OCR an arbitrary document_url, and
    // overwrite FaxLog records.
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { fax_log_id, document_url, use_advanced_ocr = true } = await req.json();

    if (!fax_log_id) {
      return Response.json({
        error: 'Missing fax_log_id'
      }, { status: 400 });
    }

    // Check if already processed
    const existingFax = await base44.asServiceRole.entities.FaxLog.get(fax_log_id);
    if (!existingFax) {
      return Response.json({ error: 'Fax not found' }, { status: 404 });
    }
    // Only the sender (or an admin) may OCR/read a fax's PHI. Mirrors
    // analyzeFaxContent / retryFailedFax.
    const isSuperAdmin = user.account_type === 'super_admin';
    const isAgencyScopedAdmin =
      user.account_type === 'agency_admin'
      || (user.role === 'admin' && !!user.agency_name && !isSuperAdmin);
    const isPlatformAdmin = isSuperAdmin || (user.role === 'admin' && !user.agency_name);
    if (!isPlatformAdmin && !isAgencyScopedAdmin && existingFax.sent_by !== user.email) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (isAgencyScopedAdmin && existingFax.sent_by !== user.email) {
      if (!user.agency_name || !existingFax.sent_by) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
      const senders = await base44.asServiceRole.entities.User
        .filter({ email: existingFax.sent_by }, undefined, 5)
        .catch(() => []);
      if (!senders?.[0] || senders[0].agency_name !== user.agency_name) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    // OCR the fax's OWN stored document, never an arbitrary caller-supplied URL:
    // trusting the body's `document_url` let any caller feed unrelated content
    // (or an attacker-hosted document) into this fax's permanent ocr_text, and
    // point the service-role fetcher at any URL. Only fall back to the body URL
    // for legacy faxes that have no stored document_url, and validate either way.
    const ocrSourceUrl = existingFax.document_url || document_url;
    if (!isSafeFetchUrl(ocrSourceUrl)) {
      return Response.json({ error: 'Fax has no valid document URL to OCR' }, { status: 400 });
    }
    if (existingFax?.ocr_processed && existingFax?.ocr_text) {
      return Response.json({
        success: true,
        already_processed: true,
        text: existingFax.ocr_text,
        confidence: existingFax.ocr_confidence || 0
      });
    }

    // Use advanced AI-powered OCR with medical document expertise
    let ocrPrompt;
    if (use_advanced_ocr) {
      ocrPrompt = `You are an advanced medical document OCR system with expertise in healthcare documents. 
Extract ALL text from this faxed document with maximum accuracy.

CRITICAL INSTRUCTIONS:
- This is a medical document - pay special attention to:
  * Patient names, dates of birth, medical record numbers
  * Diagnoses, ICD codes, procedure codes
  * Medications, dosages, frequencies
  * Lab values and vital signs
  * Provider names, signatures, credentials
  * Dates and timestamps
- Preserve the original formatting and structure
- Maintain headers, sections, and paragraphs
- Include any handwritten notes or annotations
- For unclear text, use format: [UNCLEAR: best_guess]
- For completely illegible text, use: [ILLEGIBLE]
- Return a confidence score (0-100) based on clarity

Document URL: ${ocrSourceUrl}

Return JSON with extracted text and confidence score.`;
    } else {
      ocrPrompt = `Extract all text content from this document. 
Return the complete text in a clean, readable format.
Preserve structure where possible (paragraphs, lists, etc.).
If you cannot read the text clearly, indicate sections with [UNCLEAR].

Document URL: ${ocrSourceUrl}

Return JSON: {"text": "extracted text", "confidence": 0-100}`;
    }

    let ocrResult;
    try {
      ocrResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
        model: "automatic",
        prompt: ocrPrompt,
        file_urls: [ocrSourceUrl],
        response_json_schema: {
          type: "object",
          properties: {
            text: { type: "string" },
            confidence: { type: "number" }
          }
        }
      });
    } catch (error) {
      console.error('OCR processing failed:', error);

      // Do NOT set ocr_processed:true here. The LLM call can fail transiently
      // (provider 5xx/timeout), and marking the row processed with a
      // "[OCR FAILED]" marker made the already-processed guard above return that
      // marker as the document's text on every future call — one outage
      // permanently poisoned the fax's OCR with no redrive path. Record the
      // reason in the DEDICATED ocr_failure_reason field, leaving the row
      // un-processed so a later attempt can re-run OCR. Not failure_reason: that
      // field records fax SEND/delivery failures (sendFax / autoRetryFailedFaxes)
      // that retry/polling/UI read, and an OCR transient must not overwrite it.
      await base44.asServiceRole.entities.FaxLog.update(fax_log_id, {
        ocr_failure_reason: 'OCR failed: ' + (error?.message || 'unknown error'),
      }).catch(() => {});

      return Response.json({
        success: false,
        error: 'Internal server error'
      }, { status: 500 });
    }

    // Calculate adjusted confidence based on unclear markers
    let adjustedConfidence = ocrResult.confidence || 75;
    const extractedText = ocrResult.text || '';
    
    if (extractedText) {
      const unclearCount = (extractedText.match(/\[UNCLEAR:/gi) || []).length;
      const illegibleCount = (extractedText.match(/\[ILLEGIBLE\]/gi) || []).length;
      const totalWords = extractedText.split(/\s+/).length;
      
      if (totalWords > 0) {
        const issueRate = (unclearCount + illegibleCount) / totalWords;
        adjustedConfidence = Math.max(0, adjustedConfidence - (issueRate * 100));
      }
    }

    // Update fax log with OCR results
    await base44.asServiceRole.entities.FaxLog.update(fax_log_id, {
      ocr_text: extractedText,
      ocr_processed: true,
      ocr_confidence: Math.round(adjustedConfidence),
      // Clear any reason left by a prior transient OCR failure now that OCR
      // succeeded, so it doesn't linger on the row.
      ocr_failure_reason: null
    });

    return Response.json({
      success: true,
      text: extractedText,
      confidence: Math.round(adjustedConfidence),
      characters: extractedText.length,
      method: use_advanced_ocr ? 'advanced_medical' : 'basic'
    });

  } catch (error) {
    console.error('Process fax OCR error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});