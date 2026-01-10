import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import OpenAI from 'npm:openai@4.28.0';

const openai = new OpenAI({
  apiKey: Deno.env.get('OPENAI_API_KEY'),
});

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch provider-specific settings
    const providerType = user.provider_type || 'RN';
    const providerSettings = await base44.entities.ProviderSettings.filter({
      provider_type: providerType,
      is_active: true
    });
    const providerConfig = providerSettings[0] || null;

    const { roughNote, patientId, visitType, visitDate, diagnosis, vitalSigns, nurseType } = await req.json();

    if (!roughNote || !visitType || !diagnosis) {
      return Response.json({ 
        success: false, 
        error: 'Missing required fields: roughNote, visitType, diagnosis' 
      }, { status: 400 });
    }

    // Fetch patient data and context
    const patient = (patientId && patientId !== 'anonymous') ? await base44.entities.Patient.filter({ id: patientId }) : [];
    const selectedPatient = patient[0] || null;
    
    const recentVisits = (patientId && patientId !== 'anonymous') ? 
      await base44.entities.Visit.filter({ patient_id: patientId, status: 'completed' }, '-visit_date', 3) : [];
    
    const carePlans = (patientId && patientId !== 'anonymous') ? 
      await base44.entities.CarePlan.filter({ patient_id: patientId }) : [];

    // Build concise patient context
    const patientContext = selectedPatient ? `
    PATIENT: ${selectedPatient.first_name} ${selectedPatient.last_name}
    Dx: ${selectedPatient.primary_diagnosis || diagnosis}
    Meds: ${selectedPatient.current_medications?.slice(0, 3).map(m => m.name).join(', ') || 'None'}
    Allergies: ${selectedPatient.allergies || 'None'}
    ${recentVisits[0] ? `Last visit: ${recentVisits[0].visit_date}` : ''}` : '';

    const isLPN = nurseType === 'LPN';
    const nurseTitle = isLPN ? 'LPN' : 'RN';

    // Build prompt with provider-specific customization
    let basePrompt = `Transform to Medicare-compliant ${nurseTitle} documentation.`;
    if (providerConfig?.ai_note_prompt) {
      basePrompt = providerConfig.ai_note_prompt.replace('{nurseTitle}', nurseTitle);
    }

    // Get optimal AI model configuration
    const modelConfig = await base44.functions.invoke('selectOptimalAIModel', {
      taskType: 'note_enhancement',
      providerType,
      complexity: 'high',
      requiresWebSearch: false,
      patientContext: selectedPatient ? true : false
    });

    const aiConfig = modelConfig.data?.config || { model: 'gpt-4o', temperature: 0.3, max_tokens: 3000 };
    const startTime = Date.now();

    // Use OpenAI ChatGPT for better AI service
    const prompt = `${basePrompt}

${patientContext}
Visit: ${visitType}, ${visitDate}
Dx: ${diagnosis}
Vitals: ${Object.entries(vitalSigns).filter(([k,v]) => v).map(([k,v]) => `${k}: ${v}`).join(', ') || 'None'}

ROUGH NOTE:
${roughNote}

CRITICAL: Only use info from rough note or patient data above. Do NOT invent age, DOB, or demographics.

INCLUDE:
1. Homebound status (mobility limits)
2. Skilled need (why ${nurseTitle} required)
3. Patient response
4. Functional status
5. Safety factors
${isLPN ? '6. RN supervision noted' : '6. Care plan progress'}
${visitType === 'recertification' ? '\nRECERT: Compare baseline, justify continued care' : ''}
${visitType === 'discharge' ? '\nDISCHARGE: Admission vs discharge, improvements, plan' : ''}

Return valid JSON with: rough_compliance_score (0-100), missing_elements (array), enhanced_note (string), enhanced_compliance_score (0-100), quality_score (0-100), compliance_improvement (number), documentation_gaps (array of {element, reason, priority}), time_saved_minutes (number).`;

    const systemPrompt = aiConfig.system_prompt || 
      "You are an expert clinical documentation assistant specializing in Medicare-compliant home health documentation. Always return valid JSON.";

    const completion = await openai.chat.completions.create({
      model: aiConfig.model,
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      temperature: aiConfig.temperature,
      max_tokens: aiConfig.max_tokens
    });

    const processingTime = Date.now() - startTime;

    const result = JSON.parse(completion.choices[0].message.content);

    // Save to patient history
    if (selectedPatient && patientId !== 'anonymous') {
      const currentHistory = selectedPatient.enhanced_notes_history || [];
      await base44.entities.Patient.update(patientId, {
        enhanced_notes_history: [
          ...currentHistory,
          {
            date: new Date().toISOString(),
            visit_type: visitType,
            diagnosis,
            enhanced_note: result.enhanced_note,
            rough_note: roughNote,
            quality_score: result.quality_score,
            nurse_email: user.email,
            vital_signs: vitalSigns
          }
        ].slice(-10)
      });
    }

    // Track metrics
    await base44.entities.NoteConversion.create({
      nurse_email: user.email,
      patient_id: (patientId && patientId !== 'anonymous') ? patientId : null,
      visit_type: visitType,
      diagnosis,
      rough_note_length: roughNote.length,
      enhanced_note_length: result.enhanced_note.length,
      quality_score: result.quality_score,
      rough_note_compliance: result.rough_compliance_score,
      enhanced_note_compliance: result.enhanced_compliance_score,
      compliance_improvement: result.compliance_improvement
    });

    // Record A/B test result if applicable
    if (aiConfig.configuration_id) {
      await base44.functions.invoke('recordAITestResult', {
        configuration_id: aiConfig.configuration_id,
        provider_type: providerType,
        task_type: 'note_enhancement',
        ab_test_group: aiConfig.ab_test_group,
        quality_score: result.quality_score,
        compliance_score: result.enhanced_compliance_score,
        processing_time_ms: processingTime,
        tokens_used: completion.usage?.total_tokens || 0,
        success: true
      });
    }

    return Response.json({
      success: true,
      enhanced_note: result.enhanced_note,
      quality_score: result.quality_score,
      rough_compliance: result.rough_compliance_score,
      enhanced_compliance: result.enhanced_compliance_score,
      compliance_improvement: result.compliance_improvement,
      documentation_gaps: result.documentation_gaps || [],
      time_saved: result.time_saved_minutes || 15
    });

  } catch (error) {
    console.error('Enhancement error:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});