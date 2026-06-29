import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { patientId, visitId, carePlanId } = await req.json();

    if (!patientId) {
      return Response.json({ error: 'patientId is required' }, { status: 400 });
    }

    // Get patient via the RLS-scoped client (NOT asServiceRole) so the
    // platform enforces this caller may access this patient, and we avoid
    // loading every patient in the tenant via .list() (IDOR / over-fetch).
    const patientResults = await base44.entities.Patient.filter({ id: patientId });
    const patient = patientResults[0];

    if (!patient) {
      return Response.json({ error: 'Patient not found' }, { status: 404 });
    }

    // Get recent visit if visitId provided (RLS-scoped)
    let visitData = null;
    if (visitId) {
      const visits = await base44.entities.Visit.filter({ id: visitId });
      visitData = visits[0];
    }

    // Get care plans (RLS-scoped)
    const carePlans = await base44.entities.CarePlan.filter({
      patient_id: patientId,
      status: 'active'
    });

    // Use LLM to generate personalized education topics
    const educationPrompt = `You are a healthcare education specialist. Based on the patient's medical information, generate 3-4 personalized educational topics that would benefit this patient.

Patient Information:
- Primary Diagnosis: ${patient.primary_diagnosis || 'Not specified'}
- Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None'}
- Current Medications: ${patient.current_medications?.map(m => m.name).join(', ') || 'None'}
- Allergies: ${patient.allergies || 'NKDA'}
- Functional Status: ${patient.functional_status?.adl_independence || 'Not documented'}
- Fall Risk: ${patient.functional_status?.fall_risk || 'Not documented'}
${visitData?.nurse_notes ? `\nLatest Visit Notes: ${visitData.nurse_notes.substring(0, 500)}` : ''}

Care Plan Goals:
${carePlans.map(cp => `- ${cp.problem}: ${cp.goal}`).join('\n')}

Return JSON: { "topics": [{ "title": "string", "reason": "brief explanation why this education is needed", "key_points": ["point1", "point2", "point3"] }] }`;

    const topicsResult = await base44.integrations.Core.InvokeLLM({
      model: "claude_opus_4_8",
      prompt: educationPrompt,
      response_json_schema: {
        type: 'object',
        properties: {
          topics: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                reason: { type: 'string' },
                key_points: { type: 'array', items: { type: 'string' } }
              }
            }
          }
        }
      }
    });

    // Generate detailed content for each topic
    const educationMaterials = [];

    for (const topic of topicsResult.topics || []) {
      const contentPrompt = `Create patient-friendly educational material on "${topic.title}" for a patient with ${patient.primary_diagnosis || 'chronic health condition'}.

Key Points to Cover:
${topic.key_points?.map(p => `- ${p}`).join('\n') || ''}

Instructions:
1. Use simple, clear language (8th grade reading level)
2. Include practical, actionable steps
3. Format with headings and bullet points
4. Include warning signs to watch for
5. Suggest when to call the doctor
6. Keep to 300-400 words

Do NOT use medical jargon. Make it conversational and supportive.`;

      const contentResult = await base44.integrations.Core.InvokeLLM({
        model: "claude_sonnet_4_6",
        prompt: contentPrompt
      });

      const material = {
        patient_id: patientId,
        topic: topic.title,
        diagnosis_related: patient.primary_diagnosis,
        education_content: contentResult,
        content_type: 'text',
        reading_level: 'basic',
        generated_from_visit_id: visitId || null,
        generated_date: new Date().toISOString(),
        delivery_status: 'pending'
      };

      // Save education material
      const saved = await base44.asServiceRole.entities.PatientEducationDelivery.create(material);
      educationMaterials.push(saved);
    }

    return Response.json({
      success: true,
      patient_id: patientId,
      materials_generated: educationMaterials.length,
      materials: educationMaterials
    });
  } catch (error) {
    console.error('Education generation error:', error);
    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }
});