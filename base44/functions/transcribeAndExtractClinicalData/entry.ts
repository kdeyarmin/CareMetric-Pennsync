import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { audio_url, audio_blob, patient_id, language, customTerminology } = await req.json();

    if (!audio_url && !audio_blob) {
      return Response.json({ error: 'audio_url or audio_blob is required' }, { status: 400 });
    }

    const audioSource = audio_url || audio_blob;

    // Get patient context if available
    let patientContext = '';
    let patientMedTerms = [];
    if (patient_id && patient_id !== 'anonymous') {
      try {
        const patient = await base44.asServiceRole.entities.Patient.filter({ id: patient_id });
        if (patient.length > 0) {
          const p = patient[0];
          patientContext = `Patient: ${p.first_name} ${p.last_name}, DOB: ${p.date_of_birth}, Primary Diagnosis: ${p.primary_diagnosis || 'None'}, Medications: ${(p.current_medications || []).map(m => m.name).join(', ')}`;
          // Extract medical terms from patient record for correction context
          if (p.primary_diagnosis) patientMedTerms.push(p.primary_diagnosis);
          if (p.secondary_diagnoses) patientMedTerms.push(...p.secondary_diagnoses);
          if (p.current_medications) patientMedTerms.push(...p.current_medications.map(m => m.name));
          if (p.allergies) patientMedTerms.push(p.allergies);
        }
      } catch (e) {
        console.error('Error fetching patient context:', e);
      }
    }

    // Build custom terminology boost list
    const terminologyBoost = [];
    if (customTerminology && Array.isArray(customTerminology)) {
      terminologyBoost.push(...customTerminology.map(t => t.term || t.original_term || t));
    }
    terminologyBoost.push(...patientMedTerms.filter(Boolean));

    // Step 1: Transcribe audio with advanced speaker diarization
    const diarizationPrompt = `You are an expert medical transcriptionist with advanced speaker diarization capabilities.

Transcribe this medical audio with the following requirements:

1. SPEAKER DIARIZATION: Identify ALL distinct speakers in the conversation. Label them as:
   - [CLINICIAN_1], [CLINICIAN_2], etc. for healthcare providers (doctors, nurses, therapists)
   - [PATIENT] for the patient
   - [FAMILY] for family members or caregivers
   - [OTHER] for any other speakers

2. SPEAKER IDENTIFICATION CUES: Use these cues to distinguish speakers:
   - Voice pitch, tone, and speaking patterns
   - Clinical language usage (providers use medical terminology)
   - Questions about symptoms vs reporting symptoms
   - Authoritative instructions vs acknowledgments

3. MEDICAL TERM ACCURACY: Pay special attention to accurately transcribing:
   - Drug names and dosages (e.g., "metoprolol 25mg" not "metropolol 25 mg")
   - Medical conditions (e.g., "atrial fibrillation" not "a trial fibrillation")
   - Vital sign values (e.g., "BP 140/90" not "BP one forty over ninety")
   - Medical abbreviations (CHF, COPD, DM2, HTN, etc.)
   - Lab values and measurements

${terminologyBoost.length > 0 ? `4. KNOWN MEDICAL TERMS for this patient (use these exact spellings):
${terminologyBoost.join(', ')}` : ''}

${patientContext ? `5. PATIENT CONTEXT: ${patientContext}` : ''}

${language && language !== 'en' ? `6. PRIMARY LANGUAGE: ${language} - Transcribe in the spoken language but keep medical terms in standard English where appropriate.` : ''}

Format each line as:
[SPEAKER_LABEL] Spoken text here...

Include timestamps at natural conversation breaks as [MM:SS].
Preserve verbal pauses, corrections, and emphasis where clinically relevant.`;

    const transcriptionResponse = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: diarizationPrompt,
      file_urls: typeof audioSource === 'string' ? [audioSource] : [audioSource]
    });

    const fullTranscript = transcriptionResponse;

    // Step 2: Parse speaker segments with detailed metadata
    const speakerSegments = [];
    const speakerMap = new Map();
    const lines = fullTranscript.split('\n');
    let currentTimestamp = '00:00';
    
    for (const line of lines) {
      const timestampMatch = line.match(/\[(\d{1,2}:\d{2})\]/);
      if (timestampMatch) {
        currentTimestamp = timestampMatch[1];
      }
      
      const speakerMatch = line.match(/\[(CLINICIAN_\d+|PATIENT|FAMILY|PROVIDER|OTHER)\]\s*(.+)/i);
      if (speakerMatch) {
        const speakerLabel = speakerMatch[1].toUpperCase();
        const text = speakerMatch[2].trim();
        
        // Normalize PROVIDER to CLINICIAN_1 for consistency
        const normalizedLabel = speakerLabel === 'PROVIDER' ? 'CLINICIAN_1' : speakerLabel;
        
        if (!speakerMap.has(normalizedLabel)) {
          speakerMap.set(normalizedLabel, {
            label: normalizedLabel,
            role: normalizedLabel.startsWith('CLINICIAN') ? 'provider' : normalizedLabel.toLowerCase(),
            segmentCount: 0,
            wordCount: 0
          });
        }
        
        const speakerInfo = speakerMap.get(normalizedLabel);
        speakerInfo.segmentCount++;
        speakerInfo.wordCount += text.split(/\s+/).length;
        
        speakerSegments.push({
          speaker: normalizedLabel,
          role: normalizedLabel.startsWith('CLINICIAN') ? 'provider' : normalizedLabel.toLowerCase(),
          text,
          timestamp: currentTimestamp,
          index: speakerSegments.length
        });
      }
    }

    const speakers = Array.from(speakerMap.values());

    // Step 3: Context-aware medical term correction
    const termCorrectionPrompt = `You are a medical terminology expert. Review this transcription and identify any potential medical term errors.

Transcription:
${fullTranscript}

${patientContext ? `Patient Context: ${patientContext}` : ''}

${terminologyBoost.length > 0 ? `Known terms for this patient: ${terminologyBoost.join(', ')}` : ''}

For each potential error, provide:
1. The incorrect term as transcribed
2. The correct medical term
3. Confidence level (high/medium/low)
4. Category (medication, diagnosis, procedure, anatomy, vital_sign, abbreviation)
5. Context explanation

Also identify any:
- Medication names that may be confused with similar-sounding drugs (sound-alike/look-alike)
- Dosage values that seem clinically unusual
- Abbreviations that could be ambiguous

Return corrections and a corrected version of the full transcript.`;

    const termCorrections = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: termCorrectionPrompt,
      response_json_schema: {
        type: 'object',
        properties: {
          corrections: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                original: { type: 'string' },
                corrected: { type: 'string' },
                confidence: { type: 'string' },
                category: { type: 'string' },
                context: { type: 'string' },
                is_safety_concern: { type: 'boolean' }
              }
            }
          },
          corrected_transcript: { type: 'string' },
          safety_alerts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                alert_type: { type: 'string' },
                description: { type: 'string' },
                severity: { type: 'string' }
              }
            }
          },
          accuracy_score: { type: 'number' },
          term_confidence_summary: {
            type: 'object',
            properties: {
              high_confidence: { type: 'number' },
              medium_confidence: { type: 'number' },
              low_confidence: { type: 'number' }
            }
          }
        }
      }
    });

    // Step 4: Auto-categorize conversation sections
    const categorizationPrompt = `Analyze this medical conversation transcript and categorize it into clinical sections.

Transcript:
${termCorrections.corrected_transcript || fullTranscript}

Categorize the conversation into the following sections (include only sections with content):
- Chief Complaint: Main reason for visit
- History of Present Illness: Details about current condition
- Review of Systems: Body systems review
- Physical Examination: Objective findings
- Medications: Medication discussion and reconciliation
- Assessment: Clinical impressions
- Plan: Treatment plan and follow-up
- Patient Education: Teaching provided
- Care Coordination: Referrals, consultations discussed

Return only sections that have actual content from the conversation.`;

    const categorizedSections = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: categorizationPrompt,
      response_json_schema: {
        type: 'object',
        properties: {
          sections: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                category: { type: 'string' },
                content: { type: 'string' },
                speaker_attribution: { type: 'string' }
              }
            }
          }
        }
      }
    });

    // Step 5: Extract structured clinical data
    const extractionPrompt = `You are a medical scribe assistant. Analyze the following patient-provider conversation transcript and extract structured clinical information.

${patientContext ? `Patient Context: ${patientContext}\n\n` : ''}Transcript:
${termCorrections.corrected_transcript || fullTranscript}

Extract and structure the following information:
1. Chief Complaint
2. History of Present Illness (HPI)
3. Vital Signs mentioned
4. Assessment (diagnoses discussed)
5. Current Medications mentioned
6. New/Changed Medications
7. Allergies mentioned
8. Plan/Treatment recommendations
9. Patient Education topics
10. Follow-up instructions
11. Action Items for provider
12. Symptoms reported

Be specific and use medical terminology where appropriate. If information is not mentioned, indicate "Not discussed".`;

    const structuredData = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: extractionPrompt,
      response_json_schema: {
        type: 'object',
        properties: {
          chief_complaint: { type: 'string' },
          hpi: { type: 'string' },
          vital_signs: {
            type: 'object',
            properties: {
              blood_pressure: { type: 'string' },
              heart_rate: { type: 'string' },
              temperature: { type: 'string' },
              respiratory_rate: { type: 'string' },
              oxygen_saturation: { type: 'string' },
              weight: { type: 'string' },
              pain_level: { type: 'string' }
            }
          },
          assessment: { type: 'array', items: { type: 'string' } },
          current_medications: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                dosage: { type: 'string' },
                frequency: { type: 'string' }
              }
            }
          },
          new_medications: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                dosage: { type: 'string' },
                frequency: { type: 'string' },
                instructions: { type: 'string' }
              }
            }
          },
          allergies: { type: 'array', items: { type: 'string' } },
          plan: { type: 'string' },
          patient_education: { type: 'array', items: { type: 'string' } },
          follow_up: { type: 'string' },
          action_items: { type: 'array', items: { type: 'string' } },
          symptoms: { type: 'array', items: { type: 'string' } }
        }
      }
    });

    // Step 6: Generate Medicare-compliant clinical narrative
    const narrativePrompt = `Based on the following structured clinical data, generate a comprehensive, Medicare-compliant clinical narrative suitable for home health visit documentation.

Data:
${JSON.stringify(structuredData, null, 2)}

Generate a professional narrative that includes:
- Homebound status justification
- Skilled nursing needs
- Patient response to care
- Clinical observations
- Teaching provided
- Care plan progress

Format it as a cohesive, professional clinical note.`;

    const clinicalNarrative = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: narrativePrompt
    });

    // Log the transcription
    try {
      await base44.asServiceRole.entities.SystemLog.create({
        job_name: 'Medical Scribe Transcription',
        job_type: 'other',
        status: 'success',
        message: `Transcribed and extracted clinical data from audio`,
        details: {
          user_email: user.email,
          patient_id,
          transcript_length: fullTranscript.length,
          speakers_detected: speakers.length,
          corrections_made: (termCorrections.corrections || []).length,
          accuracy_score: termCorrections.accuracy_score
        }
      });
    } catch (logErr) {
      console.error('Failed to log:', logErr);
    }

    return Response.json({
      success: true,
      transcript: fullTranscript,
      corrected_transcript: termCorrections.corrected_transcript || fullTranscript,
      speaker_segments: speakerSegments,
      speakers,
      term_corrections: termCorrections.corrections || [],
      safety_alerts: termCorrections.safety_alerts || [],
      accuracy_score: termCorrections.accuracy_score || null,
      term_confidence_summary: termCorrections.term_confidence_summary || null,
      categorized_sections: categorizedSections.sections || [],
      structured_data: structuredData,
      clinical_narrative: clinicalNarrative
    });

  } catch (error) {
    console.error('Error in medical scribe:', error);
    
    try {
      const base44 = createClientFromRequest(req);
      await base44.asServiceRole.entities.SystemLog.create({
        job_name: 'Medical Scribe Error',
        job_type: 'other',
        status: 'error',
        message: 'Failed to transcribe and extract clinical data',
        error_stack: error.stack,
        details: { error: error.message }
      });
    } catch (logErr) {
      console.error('Failed to log error:', logErr);
    }

    return Response.json({ 
      success: false,
      error: error.message,
      details: error.stack 
    }, { status: 500 });
  }
});