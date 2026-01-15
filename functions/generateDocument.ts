import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { template, generation_data, custom_text } = await req.json();

    if (!template || !generation_data) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Use InvokeLLM to populate template with patient data
    const populatedContent = await base44.integrations.Core.InvokeLLM({
      prompt: `You are a medical document generator. Populate the following template with the provided patient data. Replace all {{placeholders}} with actual values. Keep the formatting professional and HIPAA-compliant. Do not add any personal notes or commentary outside the template.

Template:
${template.template_content}

Patient Data:
${JSON.stringify(generation_data, null, 2)}

${custom_text ? `Additional Instructions: ${custom_text}` : ''}

Return ONLY the populated HTML document, no explanations.`,
      add_context_from_internet: false
    });

    // Create record in GeneratedDocument entity for audit trail
    const generatedDoc = await base44.entities.GeneratedDocument.create({
      document_name: generation_data.document_name || template.template_name,
      template_id: template.id,
      template_type: template.template_type,
      patient_id: generation_data.patient_id,
      patient_name: generation_data.patient_name,
      patient_email: generation_data.patient_email,
      generated_content: populatedContent,
      generation_data: generation_data,
      custom_text: custom_text,
      status: 'draft',
      hipaa_audit: {
        created_by: user.email,
        created_at: new Date().toISOString(),
        access_count: 1
      }
    });

    return Response.json({
      success: true,
      document: generatedDoc,
      content: populatedContent
    });

  } catch (error) {
    console.error('Error generating document:', error);
    return Response.json({ 
      error: 'Failed to generate document',
      details: error.message 
    }, { status: 500 });
  }
});