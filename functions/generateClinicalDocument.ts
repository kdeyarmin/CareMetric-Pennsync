import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const {
      patientId,
      patientName,
      patientAge,
      diagnosis,
      visitType,
      roughNotes,
      templateId,
      vitalSigns = {},
      assessmentData = {},
    } = await req.json();

    if (!patientId || !visitType || !roughNotes) {
      return Response.json(
        { error: 'Missing required fields: patientId, visitType, roughNotes' },
        { status: 400 }
      );
    }

    // Fetch patient history for context
    const patients = await base44.asServiceRole.entities.Patient.filter({
      id: patientId,
    });
    const patient = patients[0] || {};

    // Fetch template if provided
    let templateContent = '';
    if (templateId) {
      const templates = await base44.asServiceRole.entities.DocumentTemplate.filter({
        id: templateId,
      });
      if (templates[0]) {
        templateContent = templates[0].content;
      }
    }

    // Build AI prompt for document generation
    const prompt = `You are an expert clinical documentation assistant. Generate a professional ${visitType} clinical document based on the provided information.

Patient Information:
- Name: ${patientName}
- Age: ${patientAge}
- Diagnosis: ${diagnosis}
- Visit Type: ${visitType}

Vital Signs: ${JSON.stringify(vitalSigns)}

Assessment Data: ${JSON.stringify(assessmentData)}

Rough Notes/Input:
${roughNotes}

${templateContent ? `Use this template structure as reference:\n${templateContent}` : ''}

Requirements:
1. Create a well-structured, professional clinical note
2. Include all necessary sections: Assessment, Interventions, Patient Response, Plan, Follow-up
3. Use proper medical terminology
4. Ensure clinical accuracy and completeness
5. Maintain HIPAA compliance
6. Format for easy reading and compliance review

Generate the complete clinical document:`;

    const response = await base44.integrations.Core.InvokeLLM({
      prompt,
      add_context_from_internet: false,
    });

    // Validate generated document for compliance
    const complianceCheckPrompt = `Review this clinical document and identify any missing elements or compliance issues:

${response}

Check for:
- Clear assessment
- Documented interventions
- Patient response/tolerance
- Clear plan and next steps
- Proper medical terminology
- No PHI outside proper context

Provide a JSON response with: { issues: [string], score: number (0-100), recommendations: [string] }`;

    const complianceResult = await base44.integrations.Core.InvokeLLM({
      prompt: complianceCheckPrompt,
      response_json_schema: {
        type: 'object',
        properties: {
          issues: { type: 'array', items: { type: 'string' } },
          score: { type: 'number' },
          recommendations: { type: 'array', items: { type: 'string' } },
        },
      },
    });

    return Response.json({
      document: response,
      compliance: complianceResult,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Document generation error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});