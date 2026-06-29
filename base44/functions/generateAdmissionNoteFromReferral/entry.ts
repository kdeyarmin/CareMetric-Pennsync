import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { referralData, intakeAnalysis, patientData } = await req.json();

    const prompt = `You are an expert home health nurse creating a comprehensive admission note. Generate a well-structured, Medicare-compliant admission note based on this referral data.

REFERRAL DATA:
${JSON.stringify(referralData, null, 2)}

AI INTAKE ANALYSIS:
${JSON.stringify(intakeAnalysis, null, 2)}

PATIENT DATA:
${JSON.stringify(patientData, null, 2)}

Generate a comprehensive admission note with the following sections. Use the referral data to populate each section with specific, detailed information:

1. REASON FOR ADMISSION
2. CHIEF COMPLAINT / PRESENTING PROBLEM
3. MEDICAL HISTORY
4. CURRENT MEDICATIONS
5. ALLERGIES
6. VITAL SIGNS (if available)
7. FUNCTIONAL STATUS / ADL ASSESSMENT
8. COGNITIVE STATUS
9. SAFETY ASSESSMENT (fall risk, infection risk, etc.)
10. HOME ENVIRONMENT
11. SUPPORT SYSTEM / CAREGIVER
12. PATIENT/CAREGIVER GOALS
13. INITIAL NURSING ASSESSMENT

Make the note:
- Professional and detailed
- Use specific data from the referral (dates, medications, diagnoses)
- Include clinical observations from the AI analysis
- Highlight any high-priority concerns or risks
- Use bullet points for clarity where appropriate
- Ready for nurse to review and add visit-specific observations

Return ONLY the formatted note text, no JSON structure.`;

    const noteText = await base44.integrations.Core.InvokeLLM({
      model: "claude_opus_4_8",
      prompt: prompt
    });

    return Response.json({
      success: true,
      admission_note: noteText
    });

  } catch (error) {
    console.error('Admission note generation error:', error);
    return Response.json({ 
      error: 'Failed to generate admission note',
      details: error.message 
    }, { status: 500 });
  }
});