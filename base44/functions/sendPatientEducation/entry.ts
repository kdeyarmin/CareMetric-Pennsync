import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { patient_id, material_id, patient_email } = await req.json();

    if (!patient_email) {
      return Response.json({ error: 'Patient email is required' }, { status: 400 });
    }

    // Fetch the education material
    const material = await base44.asServiceRole.entities.PatientEducationMaterial.get(material_id);
    
    if (!material) {
      return Response.json({ error: 'Education material not found' }, { status: 404 });
    }

    // Fetch patient for personalization
    const patient = await base44.asServiceRole.entities.Patient.get(patient_id);

    // Build email content
    let emailBody = `
      <h2>${material.title}</h2>
      <p><strong>Dear ${patient?.first_name || 'Patient'},</strong></p>
      <p>Your healthcare provider has shared the following educational material with you:</p>
    `;

    if (material.content_text) {
      emailBody += `<div style="margin: 20px 0; padding: 15px; background-color: #f9f9f9; border-left: 4px solid #4CAF50;">
        ${material.content_text}
      </div>`;
    }

    if (material.pdf_url || material.document_url) {
      emailBody += `<p><a href="${material.pdf_url || material.document_url}" style="display: inline-block; padding: 10px 20px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 5px;">View Document</a></p>`;
    }

    if (material.video_url) {
      emailBody += `<p><a href="${material.video_url}" style="display: inline-block; padding: 10px 20px; background-color: #2196F3; color: white; text-decoration: none; border-radius: 5px;">Watch Video</a></p>`;
    }

    if (material.external_link) {
      emailBody += `<p><a href="${material.external_link}">Additional Resources</a></p>`;
    }

    emailBody += `
      <p style="margin-top: 30px; color: #666; font-size: 12px;">
        If you have any questions about this material, please contact your healthcare provider.
      </p>
    `;

    // Send email
    await base44.asServiceRole.integrations.Core.SendEmail({
      to: patient_email,
      subject: `Patient Education: ${material.title}`,
      body: emailBody
    });

    console.log(`Education material "${material.title}" sent to ${patient_email}`);

    return Response.json({
      success: true,
      message: 'Education material sent successfully'
    });

  } catch (error) {
    console.error('Error sending patient education:', error);
    return Response.json({ 
      success: false,
      error: error.message 
    }, { status: 500 });
  }
});