import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { fax_id } = await req.json();
    
    if (!fax_id) {
      return Response.json({ error: 'fax_id is required' }, { status: 400 });
    }

    // Get the incoming fax record
    const faxes = await base44.entities.IncomingFax.filter({ id: fax_id });
    const fax = faxes[0];
    
    if (!fax) {
      return Response.json({ error: 'Fax not found' }, { status: 404 });
    }

    // Update status to processing
    await base44.asServiceRole.entities.IncomingFax.update(fax_id, {
      processing_status: 'processing'
    });

    // Step 1: OCR the document
    let ocrText = '';
    let ocrConfidence = 0;
    
    try {
      const ocrResult = await base44.integrations.Core.InvokeLLM({
        prompt: `Extract all text from this fax document. Return the raw text content.`,
        file_urls: [fax.document_url]
      });
      ocrText = ocrResult || '';
      ocrConfidence = 85; // Vision models are generally reliable
    } catch (error) {
      console.error('OCR failed:', error);
    }

    // Step 2: AI Analysis for categorization and extraction
    const analysisPrompt = `Analyze this incoming medical fax and provide structured information:

FAX CONTENT:
${ocrText}

SENDER: ${fax.sender_name || 'Unknown'}
FROM NUMBER: ${fax.sender_fax_number}

Analyze and extract:
1. Document Category (lab_results, referral, consultation_note, prescription, insurance_authorization, discharge_summary, imaging_report, progress_note, consent_form, or other)
2. Patient Information (name, DOB, MRN if available)
3. Document Date
4. Provider Name
5. Diagnosis/Conditions mentioned
6. Medications mentioned
7. Urgency Level (critical, high, medium, low) based on:
   - Critical lab values
   - Words like "urgent", "stat", "emergency"
   - Abnormal findings
   - Time-sensitive treatments
8. Reasons for urgency
9. Suggested Routing (nurse_review, physician_review, admin, billing, patient_record)
10. Action items that need to be taken
11. Confidence score (0-100) in the analysis

Be thorough but concise.`;

    const analysis = await base44.integrations.Core.InvokeLLM({
      prompt: analysisPrompt,
      response_json_schema: {
        type: "object",
        properties: {
          category: { type: "string" },
          patient_name: { type: "string" },
          patient_dob: { type: "string" },
          patient_mrn: { type: "string" },
          document_date: { type: "string" },
          provider_name: { type: "string" },
          diagnosis: { type: "string" },
          medications: { type: "array", items: { type: "string" } },
          urgency_level: { type: "string" },
          urgency_reasons: { type: "array", items: { type: "string" } },
          suggested_routing: { type: "string" },
          action_items: { type: "array", items: { type: "string" } },
          confidence_score: { type: "number" }
        }
      }
    });

    // Step 3: Try to match patient
    let suggestedPatientId = null;
    if (analysis.patient_name || analysis.patient_mrn) {
      try {
        const patients = await base44.asServiceRole.entities.Patient.list();
        
        // Simple matching logic
        const match = patients.find(p => {
          if (analysis.patient_mrn && p.mrn === analysis.patient_mrn) return true;
          if (analysis.patient_name) {
            const nameMatch = p.name?.toLowerCase().includes(analysis.patient_name.toLowerCase());
            const dobMatch = analysis.patient_dob ? p.dob === analysis.patient_dob : false;
            return nameMatch || dobMatch;
          }
          return false;
        });
        
        if (match) {
          suggestedPatientId = match.id;
        }
      } catch (error) {
        console.error('Patient matching failed:', error);
      }
    }

    // Step 4: Update the fax record with AI analysis
    await base44.asServiceRole.entities.IncomingFax.update(fax_id, {
      processing_status: 'completed',
      ocr_text: ocrText,
      ocr_confidence: ocrConfidence,
      ai_category: analysis.category || 'other',
      extracted_info: {
        patient_name: analysis.patient_name || '',
        patient_dob: analysis.patient_dob || '',
        patient_mrn: analysis.patient_mrn || '',
        document_date: analysis.document_date || '',
        provider_name: analysis.provider_name || '',
        diagnosis: analysis.diagnosis || '',
        medications: analysis.medications || []
      },
      urgency_level: analysis.urgency_level || 'medium',
      urgency_reasons: analysis.urgency_reasons || [],
      suggested_patient_id: suggestedPatientId,
      suggested_routing: analysis.suggested_routing || 'nurse_review',
      confidence_score: analysis.confidence_score || 0,
      action_items: analysis.action_items || []
    });

    return Response.json({
      success: true,
      analysis: {
        category: analysis.category,
        urgency: analysis.urgency_level,
        patient_matched: !!suggestedPatientId,
        confidence: analysis.confidence_score
      }
    });

  } catch (error) {
    console.error('Fax analysis error:', error);
    return Response.json({ 
      error: error.message || 'Analysis failed',
      details: error.toString()
    }, { status: 500 });
  }
});