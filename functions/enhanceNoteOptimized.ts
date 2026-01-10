import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

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

    // SINGLE AI CALL - Does everything at once
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `Transform to Medicare-compliant ${nurseTitle} documentation.

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

Return JSON:`,
      response_json_schema: {
        type: "object",
        properties: {
          rough_compliance_score: { type: "number" },
          missing_elements: { type: "array", items: { type: "string" } },
          enhanced_note: { type: "string" },
          enhanced_compliance_score: { type: "number" },
          quality_score: { type: "number" },
          compliance_improvement: { type: "number" },
          documentation_gaps: { 
            type: "array",
            items: {
              type: "object",
              properties: {
                element: { type: "string" },
                reason: { type: "string" },
                priority: { type: "string" }
              }
            }
          },
          time_saved_minutes: { type: "number" }
        }
      }
    });

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