import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  let user;
  try {
    const base44 = createClientFromRequest(req);
    user = await base44.auth.me();

    if (!user) {
      console.error('[generateDocument] Unauthorized access attempt');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { template, generation_data, custom_text } = body;

    if (!template || !generation_data) {
      console.error('[generateDocument] Missing required fields', { template: !!template, generation_data: !!generation_data });
      return Response.json({ error: 'Missing required fields: template and generation_data' }, { status: 400 });
    }

    if (!template.template_content) {
      console.error('[generateDocument] Template missing template_content');
      return Response.json({ error: 'Template must have template_content' }, { status: 400 });
    }

    console.log('[generateDocument] Generating document for patient:', generation_data.patient_id);

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

    console.log('[generateDocument] Document generated successfully, ID:', generatedDoc.id);

    return Response.json({
      success: true,
      document: generatedDoc,
      content: populatedContent
    });

  } catch (error) {
    console.error('[generateDocument] Error:', {
      message: error.message,
      stack: error.stack,
      userEmail: user?.email
    });
    return Response.json({ 
      error: 'Failed to generate document',
      details: error.message 
    }, { status: 500 });
  }
});