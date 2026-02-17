import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const body = await req.json();
    const { fax_log_id, document_url, use_advanced_ocr = false } = body;

    if (!fax_log_id) {
      return Response.json({ error: 'fax_log_id is required' }, { status: 400 });
    }

    // Fetch fax record
    const faxRecords = await base44.asServiceRole.entities.FaxHistory.filter({ id: fax_log_id });
    const fax = faxRecords?.[0];

    if (!fax) {
      return Response.json({ error: 'Fax record not found' }, { status: 404 });
    }

    // Prevent duplicate processing
    if (fax.ocr_text && fax.ocr_confidence > 0) {
      console.log(`[processFaxOCR] Fax ${fax_log_id} already has OCR text, skipping`);
      return Response.json({
        success: true,
        skipped: true,
        message: 'OCR already processed',
        confidence: fax.ocr_confidence
      });
    }

    const docUrl = document_url || fax.document_urls?.[0];
    if (!docUrl) {
      return Response.json({ error: 'No document URL available' }, { status: 400 });
    }

    console.log(`[processFaxOCR] Processing fax ${fax_log_id}, advanced: ${use_advanced_ocr}`);

    let extractedText = '';
    let confidence = 0;

    // Use ExtractDataFromUploadedFile for OCR
    const ocrPrompt = use_advanced_ocr
      ? `Extract ALL text from this medical document with high accuracy. Pay special attention to:
- Patient names, DOB, MRN
- Medication names and dosages
- Diagnoses and ICD-10 codes
- Lab values and vital signs
- Provider signatures and dates
- Phone numbers and fax numbers
Preserve the document structure and formatting as much as possible.`
      : `Extract the text content from this document. Preserve structure and formatting.`;

    const extractResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: ocrPrompt,
      file_urls: [docUrl],
      response_json_schema: {
        type: "object",
        properties: {
          extracted_text: { type: "string" },
          confidence_score: { type: "number" },
          document_type: { type: "string" },
          contains_phi: { type: "boolean" },
          key_medical_terms: {
            type: "array",
            items: { type: "string" }
          }
        }
      }
    });

    extractedText = extractResult.extracted_text || '';
    confidence = extractResult.confidence_score || 70;

    if (!extractedText || extractedText.length < 10) {
      console.warn(`[processFaxOCR] Low-quality OCR result for fax ${fax_log_id}`);
      await base44.asServiceRole.entities.FaxHistory.update(fax_log_id, {
        ocr_text: extractedText || 'OCR extraction failed - document may be image-based or illegible',
        ocr_confidence: Math.min(confidence, 20)
      });

      return Response.json({
        success: false,
        message: 'OCR extraction yielded minimal text',
        confidence,
        text_length: extractedText.length
      });
    }

    // Update fax record with OCR results
    await base44.asServiceRole.entities.FaxHistory.update(fax_log_id, {
      ocr_text: extractedText,
      ocr_confidence: confidence
    });

    console.log(`[processFaxOCR] Success: ${extractedText.length} chars, confidence: ${confidence}%`);

    return Response.json({
      success: true,
      text_length: extractedText.length,
      confidence,
      document_type: extractResult.document_type || 'unknown',
      contains_phi: extractResult.contains_phi || false,
      key_terms_count: (extractResult.key_medical_terms || []).length
    });

  } catch (error) {
    console.error('[processFaxOCR] Error:', error.message, error.stack);
    return Response.json({ error: error.message }, { status: 500 });
  }
});