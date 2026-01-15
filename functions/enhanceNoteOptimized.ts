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

    const { roughNote, patientId, visitType, visitDate, diagnosis, vitalSigns, nurseType } = await req.json();

    if (!roughNote || !visitType || !diagnosis) {
      return Response.json({ 
        success: false, 
        error: 'Missing required fields: roughNote, visitType, diagnosis' 
      }, { status: 400 });
    }

    const providerType = user.credential_type || user.provider_type || 'RN';
    const isAnonymous = !patientId || patientId === 'anonymous';

    // Parallel fetch: provider settings, patient data, and Medicare compliance rules
    const [providerSettings, patientData, medicareRules, complianceRules] = await Promise.all([
      base44.entities.ProviderSettings.filter({
        provider_type: providerType,
        is_active: true
      }),
      !isAnonymous ? base44.entities.Patient.filter({ id: patientId }) : Promise.resolve([]),
      base44.entities.MedicareComplianceRule.filter({ is_active: true }),
      base44.entities.ComplianceRule.filter({ is_active: true })
    ]);

    const providerConfig = providerSettings[0] || null;
    const selectedPatient = patientData[0] || null;
    
    // Parallel fetch related patient data
    const [recentVisits, carePlans] = !isAnonymous ? 
      await Promise.all([
        base44.entities.Visit.filter({ patient_id: patientId, status: 'completed' }, '-visit_date', 3),
        base44.entities.CarePlan.filter({ patient_id: patientId })
      ]) : [[], []];

    // Build concise patient context
    const patientContext = selectedPatient ? `
    PATIENT: ${selectedPatient.first_name} ${selectedPatient.last_name}
    Dx: ${selectedPatient.primary_diagnosis || diagnosis}
    Meds: ${selectedPatient.current_medications?.slice(0, 3).map(m => m.name).join(', ') || 'None'}
    Allergies: ${selectedPatient.allergies || 'None'}
    ${recentVisits[0] ? `Last visit: ${recentVisits[0].visit_date}` : ''}` : '';

    const isLPN = nurseType === 'LPN';
    const nurseTitle = isLPN ? 'LPN' : 'RN';

    // Build comprehensive Medicare compliance requirements
    const relevantMedicareRules = medicareRules.filter(rule => 
      !rule.applies_to_visit_types || 
      rule.applies_to_visit_types.length === 0 || 
      rule.applies_to_visit_types.includes(visitType)
    );

    const medicareRequirements = relevantMedicareRules.map(rule => 
      `- ${rule.category}: ${rule.required_elements?.join(', ')}`
    ).join('\n');

    const relevantComplianceRules = complianceRules.filter(rule =>
      (!rule.applies_to_visit_types || rule.applies_to_visit_types.includes(visitType)) &&
      (!rule.applies_to_care_type || rule.applies_to_care_type === 'both' || rule.applies_to_care_type === 'home_health')
    );

    const complianceRequirements = relevantComplianceRules
      .slice(0, 10)
      .map(rule => `- ${rule.rule_name}: ${rule.description}`)
      .join('\n');

    // Build prompt with provider-specific customization
    let basePrompt = `Transform to Medicare-compliant ${nurseTitle} documentation with STRICT adherence to regulatory requirements.`;
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

MEDICARE COMPLIANCE REQUIREMENTS:
${medicareRequirements}

REGULATORY COMPLIANCE CHECKS:
${complianceRequirements}

MANDATORY DOCUMENTATION ELEMENTS:
1. HOMEBOUND STATUS - Specific mobility restrictions, cannot leave home without considerable/taxing effort
2. SKILLED NEED - Why ${nurseTitle} skilled services are medically necessary (cannot be performed by non-skilled personnel)
3. PATIENT RESPONSE - Observable patient response to skilled interventions
4. FUNCTIONAL STATUS - ADL/IADL capabilities, limitations, safety concerns
5. SAFETY ASSESSMENT - Fall risk, medication safety, environmental hazards
6. CARE COORDINATION - Physician orders, care plan alignment, family education
${isLPN ? '7. RN SUPERVISION - Document RN oversight and supervisory visit schedule' : '7. CARE PLAN PROGRESS - Progress toward goals, barriers, interventions effectiveness'}
8. VITAL SIGNS - Document all vitals with context and clinical significance
9. SKILLED INTERVENTION - Specific skilled activities performed (assessment, teaching, wound care, etc.)
10. PLAN OF CARE - Next visit plan, ongoing interventions, physician communication needs
${visitType === 'recertification' ? '\n\nRECERTIFICATION REQUIREMENTS:\n- Compare baseline functional status vs current\n- Justify continued need for skilled services\n- Document progress toward goals or reasons for lack of progress\n- Update homebound status\n- Recertify skilled need with new clinical findings' : ''}
${visitType === 'admission' ? '\n\nADMISSION REQUIREMENTS:\n- Complete baseline assessment\n- Establish homebound criteria\n- Document all medications with reconciliation\n- Initial safety assessment\n- Baseline vital signs and functional status' : ''}
${visitType === 'discharge' ? '\n\nDISCHARGE REQUIREMENTS:\n- Compare admission vs discharge status\n- Document goal achievement\n- Patient/caregiver education provided\n- Discharge instructions and follow-up plan\n- Reason for discharge (goals met, hospitalization, etc.)' : ''}

QUALITY STANDARDS:
- Use objective, measurable terms
- Avoid vague language like "tolerated well" without specifics
- Include direct patient quotes where relevant
- Document clinical reasoning for interventions
- Link all activities to physician orders
- Use proper medical terminology
- Maintain professional, clinical tone

Return valid JSON with: 
- rough_compliance_score (0-100)
- missing_elements (array of strings)
- enhanced_note (string)
- enhanced_compliance_score (0-100, must be 85+ to meet Medicare standards)
- quality_score (0-100)
- compliance_improvement (number)
- documentation_gaps (array of {element, reason, priority, regulatory_reference})
- medicare_violations (array of {violation, severity, cop_reference, remediation})
- time_saved_minutes (number)
- regulatory_warnings (array of strings for potential audit flags)`;

    const systemPrompt = aiConfig.system_prompt || 
      `You are an expert clinical documentation specialist with deep knowledge of:
- Medicare Conditions of Participation (42 CFR Part 484)
- OASIS-E documentation requirements
- CMS compliance standards for home health
- State-specific regulations and requirements
- Clinical best practices and evidence-based care

Your role is to transform rough clinical notes into comprehensive, Medicare-compliant documentation that will withstand audits and ensure proper reimbursement. Every note must meet or exceed 85% compliance threshold.

CRITICAL COMPLIANCE REQUIREMENTS:
1. Homebound status MUST be specific and measurable
2. Skilled need MUST justify why skilled nursing is medically necessary
3. Patient response MUST be observable and objective
4. All interventions MUST tie to physician orders and care plan
5. Safety assessment MUST be comprehensive
6. Documentation MUST support medical necessity

Always return valid JSON with all required fields.`;

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

    // Parallel operations: update patient history, track metrics, record A/B test
    const updatePromises = [];

    if (selectedPatient && !isAnonymous) {
      const currentHistory = selectedPatient.enhanced_notes_history || [];
      updatePromises.push(
        base44.entities.Patient.update(patientId, {
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
        })
      );
    }

    updatePromises.push(
      base44.entities.NoteConversion.create({
        nurse_email: user.email,
        patient_id: !isAnonymous ? patientId : null,
        visit_type: visitType,
        diagnosis,
        rough_note_length: roughNote.length,
        enhanced_note_length: result.enhanced_note.length,
        quality_score: result.quality_score,
        rough_note_compliance: result.rough_compliance_score,
        enhanced_note_compliance: result.enhanced_compliance_score,
        compliance_improvement: result.compliance_improvement
      })
    );

    if (aiConfig.configuration_id) {
      updatePromises.push(
        base44.functions.invoke('recordAITestResult', {
          configuration_id: aiConfig.configuration_id,
          provider_type: providerType,
          task_type: 'note_enhancement',
          ab_test_group: aiConfig.ab_test_group,
          quality_score: result.quality_score,
          compliance_score: result.enhanced_compliance_score,
          processing_time_ms: processingTime,
          tokens_used: completion.usage?.total_tokens || 0,
          success: true
        })
      );
    }

    // Execute all updates in parallel
    await Promise.all(updatePromises);

    return Response.json({
      success: true,
      enhanced_note: result.enhanced_note,
      quality_score: result.quality_score,
      rough_compliance: result.rough_compliance_score,
      enhanced_compliance: result.enhanced_compliance_score,
      compliance_improvement: result.compliance_improvement,
      documentation_gaps: result.documentation_gaps || [],
      medicare_violations: result.medicare_violations || [],
      regulatory_warnings: result.regulatory_warnings || [],
      time_saved: result.time_saved_minutes || 15,
      compliance_threshold_met: result.enhanced_compliance_score >= 85
    });

  } catch (error) {
    console.error('Enhancement error:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});