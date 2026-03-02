import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json();
    const {
      roughNote,
      visitType,
      diagnosis,
      nurseType = 'RN',
      contextData = {},
      noteFormat = 'soap',
      formatInstructions = '',
      specialtyContext = null,
      enable_compliance_flagging = false
    } = payload;

    // Build specialty-enhanced prompt
    let specialtyPrompt = '';
    let specialtyCodeGuidance = '';
    
    if (specialtyContext) {
      specialtyPrompt = `\n\nSPECIALTY CONTEXT - ${specialtyContext.specialty}:
${specialtyContext.aiPrompt}

Required Sections: ${specialtyContext.sections.join(', ')}

Focus on specialty-specific assessment and documentation standards.`;

      if (specialtyContext.commonCodes) {
        specialtyCodeGuidance = `\n\nCOMMON CODES FOR THIS SPECIALTY:
ICD-10: ${specialtyContext.commonCodes.icd10?.join(', ') || 'N/A'}
CPT: ${specialtyContext.commonCodes.cpt?.join(', ') || 'N/A'}

Consider these codes when relevant to the documented visit.`;
      }
    }

    const enhancePrompt = `You are an expert medical documentation assistant specializing in ${nurseType} clinical notes.

${formatInstructions}
${specialtyPrompt}

VISIT INFORMATION:
- Visit Type: ${visitType}
- Primary Diagnosis: ${diagnosis}
- Provider Type: ${nurseType}
${contextData?.patient_demographics ? `
PATIENT CONTEXT:
- Age: ${contextData.patient_demographics.age || 'Not specified'}
- Primary Diagnosis: ${contextData.patient_demographics.primary_diagnosis || diagnosis}
${contextData.patient_demographics.secondary_diagnoses?.length > 0 ? `- Secondary Diagnoses: ${contextData.patient_demographics.secondary_diagnoses.join(', ')}\n` : ''}- Allergies: ${contextData.patient_demographics.allergies || 'None documented'}
- Current Medications: ${contextData.patient_demographics.current_medications || 'None documented'}

${contextData.previous_notes_summary?.length > 0 ? `PREVIOUS VISIT NOTES (Use to show patient progression):
${contextData.previous_notes_summary.map((note, i) => `${i + 1}. ${new Date(note.date).toLocaleDateString()} - ${note.visit_type}: ${note.excerpt}...`).join('\n')}
` : ''}
${contextData.active_care_plans?.length > 0 ? `ACTIVE CARE PLAN GOALS (Document progress toward these):
${contextData.active_care_plans.map((cp, i) => `${i + 1}. ${cp.problem} - Goal: ${cp.goal}`).join('\n')}
` : ''}
${contextData.recent_visits?.length > 0 ? `RECENT VISITS:
${contextData.recent_visits.map((v, i) => `${i + 1}. ${v.date} (${v.type}): ${v.summary || 'No summary'}...`).join('\n')}
` : ''}` : ''}

ROUGH NOTES FROM PROVIDER:
${roughNote}

${specialtyCodeGuidance}

TASK: Transform the rough notes into a professional, comprehensive clinical note following ${noteFormat.toUpperCase()} format.

Requirements:
1. Use proper medical terminology and grammar
2. Follow ${noteFormat.toUpperCase()} structure strictly
3. Include all relevant clinical details from the rough notes
4. Reference relevant changes from previous visits when applicable
5. Document progress toward active care plan goals when present
6. Add medical necessity justification where appropriate
7. Ensure Medicare/insurance compliance
${specialtyContext ? `8. Include specialty-specific assessments and recommendations
9. Structure according to the ${specialtyContext.templateName} template` : ''}
${enable_compliance_flagging ? `
CRITICAL: Flag potential compliance issues including:
- Missing skilled service documentation
- Vague or non-specific language
- Missing medical necessity justification
- Homebound status documentation gaps
- Required elements missing for this visit type` : ''}

Output the enhanced clinical note only, properly formatted.`;

    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');

    // Helper: call GPT-4o for text completion
    async function callGPT4o(prompt, maxTokens = 4096) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiApiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o',
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`GPT-4o error: ${res.status} - ${err}`);
      }
      const data = await res.json();
      return data.choices?.[0]?.message?.content || '';
    }

    // Helper: call GPT-4o for structured JSON output
    async function callGPT4oJSON(prompt, maxTokens = 2048) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiApiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o',
          max_tokens: maxTokens,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: prompt }]
        })
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`GPT-4o JSON error: ${res.status} - ${err}`);
      }
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '{}';
      return JSON.parse(text);
    }

    if (!openaiApiKey) {
      console.error('[enhanceNoteOptimized] OPENAI_API_KEY not configured');
      throw new Error('OPENAI_API_KEY not configured');
    }

    console.log('[enhanceNoteOptimized] Calling GPT-4o for note enhancement');
    const enhancedNote = await callGPT4o(enhancePrompt, 4096);
    console.log('[enhanceNoteOptimized] Enhanced note generated:', {
      length: enhancedNote.length
    });

    // Generate compliance flags if enabled
    let complianceFlags = [];
    if (enable_compliance_flagging) {
      const complianceCheckPrompt = `Analyze this clinical note for potential compliance issues and documentation gaps:

Clinical Note:
${enhancedNote}

Visit Type: ${visitType}
Diagnosis: ${diagnosis}

Identify:
1. Missing required elements (skilled services, medical necessity, etc.)
2. Vague or non-specific language that could trigger audits
3. Missing homebound justification (if applicable)
4. Documentation gaps that reduce reimbursement or compliance
5. Potential Medicare/insurance red flags

Format as specific, actionable findings.`;

      try {
        const complianceResult = await callGPT4oJSON(
          complianceCheckPrompt + '\n\nReturn JSON: { "compliance_flags": [ { "issue": string, "severity": "critical"|"high"|"medium"|"low", "category": string, "remediation": string } ] }',
          2048
        );
        complianceFlags = complianceResult.compliance_flags || [];
      } catch (error) {
        console.error('[enhanceNoteOptimized] Compliance check error:', error.message);
      }
      }

    // Generate specialty-specific differential diagnoses and code suggestions
    let differentialDiagnoses = [];
    let suggestedCodes = { icd10: [], cpt: [] };

    if (specialtyContext || (nurseType === 'MD' || nurseType === 'DO' || nurseType === 'NP')) {
      const diagnosticPrompt = `Based on this clinical note, provide specialty-specific differential diagnoses and billing codes:

Clinical Note:
${enhancedNote}

Primary Diagnosis: ${diagnosis}
${specialtyContext ? `Specialty: ${specialtyContext.specialty}` : `Provider Type: ${nurseType}`}

Provide:
1. Top 3-5 differential diagnoses to consider
2. Appropriate ICD-10 codes with descriptions
3. Recommended CPT codes for documented services`;

      const diagnosticResult = await callGPT4oJSON(
        diagnosticPrompt + '\n\nReturn JSON: { "differential_diagnoses": [ { "diagnosis": string, "reasoning": string, "probability": "high"|"moderate"|"low" } ], "icd10_codes": [ { "code": string, "description": string, "relevance": string } ], "cpt_codes": [ { "code": string, "description": string, "documentation_basis": string } ] }',
        2048
      );
      differentialDiagnoses = diagnosticResult.differential_diagnoses || [];
      suggestedCodes = {
        icd10: diagnosticResult.icd10_codes || [],
        cpt: diagnosticResult.cpt_codes || []
      };
    }

    // Generate quality analysis
    let qualityAnalysis = null;
    if (enable_compliance_flagging) {
      const qualityPrompt = `Analyze this clinical note for documentation quality:

${enhancedNote}

Visit Type: ${visitType}
Provider: ${nurseType}

Rate the note on:
1. Clarity (readability, logical flow, medical terminology usage)
2. Completeness (all required elements, comprehensive assessment)
3. Clinical Reasoning (evidence-based decisions, clinical judgment)
4. Overall Quality

Provide scores (0-100) and specific feedback.`;

      try {
        qualityAnalysis = await callGPT4oJSON(
          qualityPrompt + '\n\nReturn JSON: { "overall_quality_score": number, "clarity_score": number, "completeness_score": number, "clinical_reasoning_score": number, "strengths": [string], "areas_for_improvement": [ { "issue": string, "suggestion": string, "severity": "high"|"medium"|"low" } ], "missing_elements": [string] }',
          2048
        );
      } catch (error) {
        console.error('[enhanceNoteOptimized] Quality analysis error:', error.message);
      }
      }

    return Response.json({
      success: true,
      enhanced_note: enhancedNote,
      differential_diagnoses: differentialDiagnoses,
      suggested_codes: suggestedCodes,
      specialty_applied: specialtyContext?.specialty || null,
      compliance_flags: complianceFlags,
      quality_analysis: qualityAnalysis
    });

  } catch (error) {
    console.error('[enhanceNoteOptimized] Fatal error:', {
      message: error.message,
      stack: error.stack,
      userEmail: user?.email
    });
    return Response.json({
      success: false,
      error: error.message,
      type: error.name
    }, { status: 500 });
  }
});