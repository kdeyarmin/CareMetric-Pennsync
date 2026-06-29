import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Require authentication: previously unauthenticated, so anyone could read
    // any FaxLog's extracted OCR PHI by id, OCR an arbitrary document_url, and
    // overwrite FaxLog records.
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { fax_log_id, document_url, use_advanced_ocr = true } = await req.json();

    if (!fax_log_id || !document_url) {
      return Response.json({ 
        error: 'Missing fax_log_id or document_url' 
      }, { status: 400 });
    }

    // Check if already processed
    const existingFax = await base44.asServiceRole.entities.FaxLog.get(fax_log_id);
    if (!existingFax) {
      return Response.json({ error: 'Fax not found' }, { status: 404 });
    }
    // Only the sender (or an admin) may OCR/read a fax's PHI. Mirrors
    // analyzeFaxContent / retryFailedFax; the prior code had no ownership check.
    if (user.role !== 'admin' && existingFax.sent_by && existingFax.sent_by !== user.email) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
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

Document URL: ${document_url}

Return JSON with extracted text and confidence score.`;
    } else {
      ocrPrompt = `Extract all text content from this document. 
Return the complete text in a clean, readable format.
Preserve structure where possible (paragraphs, lists, etc.).
If you cannot read the text clearly, indicate sections with [UNCLEAR].

Document URL: ${document_url}

Return JSON: {"text": "extracted text", "confidence": 0-100}`;
    }

    let ocrResult;
    try {
      ocrResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
        model: "claude_opus_4_8",
        prompt: ocrPrompt,
        file_urls: [document_url],
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
      
      // Mark as processed but failed
      await base44.asServiceRole.entities.FaxLog.update(fax_log_id, {
        ocr_processed: true,
        ocr_text: '[OCR FAILED: ' + error.message + ']',
        ocr_confidence: 0
      });

      return Response.json({
        success: false,
        error: error.message
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
      ocr_confidence: Math.round(adjustedConfidence)
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
    return Response.json({ error: error.message }, { status: 500 });
  }
});